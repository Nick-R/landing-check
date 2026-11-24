// Загрузка чужой страницы: только http/https, без внутренних адресов,
// перенаправления проверяются по одному, есть предел размера и времени.
import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { config } from "../env";
import { assertPublicAddresses, assertSafeUrl, UnsafeUrlError, type LookupAddress } from "./ssrf";

export class FetchPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchPageError";
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;

// Проверка IP в момент соединения: даже если DNS между проверкой и запросом сменит адрес,
// соединение пойдёт только на публичный IP.
function guardedLookup(hostname: string, options: { all?: boolean }, cb: LookupCb) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err);
    try {
      const safe = assertPublicAddresses(hostname, addresses);
      if (options.all) cb(null, safe);
      else cb(null, safe[0].address, safe[0].family);
    } catch (e) {
      cb(e as NodeJS.ErrnoException);
    }
  });
}

let agent: Agent | undefined;
function guardedAgent(): Agent {
  agent ??= new Agent({
    connect: { lookup: guardedLookup as never, timeout: 5_000 },
    headersTimeout: 8_000,
    bodyTimeout: 8_000,
  });
  return agent;
}

export type FetchLike = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string>; dispatcher?: unknown },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
}>;

export type FetchedPage = { finalUrl: string; html: string; truncated: boolean };

// Язык, на котором просим страницу. Сайты с несколькими языками отдают версию по этому заголовку,
// а проверять надо ту, что видит аудитория объявления: объявление на кириллице - русская, иначе английская.
export function acceptLanguageFor(adText: string): string {
  return /[\u0400-\u04FF]/.test(adText) ? "ru,en;q=0.8" : "en-US,en;q=0.9";
}

export async function fetchPage(
  rawUrl: string,
  opts: { fetchImpl?: FetchLike; maxBytes?: number; timeoutMs?: number; acceptLanguage?: string } = {},
): Promise<FetchedPage> {
  const fetchImpl = opts.fetchImpl ?? (undiciFetch as unknown as FetchLike);
  const maxBytes = opts.maxBytes ?? config.fetch.maxBytes;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? config.fetch.timeoutMs);

  let current = assertSafeUrl(rawUrl);

  // Только для сквозного теста: страница-образец с диска. На Vercel не действует.
  const fixtureDir = process.env.E2E_FIXTURE_DIR;
  if (fixtureDir && !process.env.VERCEL && current.hostname === "fixture.example") {
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(`${fixtureDir}/landing.html`, "utf8");
    return { finalUrl: current.toString(), html, truncated: false };
  }
  try {
    for (let hop = 0; hop <= config.fetch.maxRedirects; hop++) {
      const res = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; SverkaBot/1.0; landing page check)",
          accept: "text/html,application/xhtml+xml",
          "accept-language": opts.acceptLanguage ?? "en-US,en;q=0.9",
        },
        dispatcher: opts.fetchImpl ? undefined : guardedAgent(),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new FetchPageError("Не удалось открыть страницу");
        // Каждое перенаправление проверяется заново: так нельзя увести запрос во внутреннюю сеть.
        current = assertSafeUrl(new URL(location, current).toString());
        continue;
      }
      if (res.status >= 400) throw new FetchPageError(`Сайт не открыл страницу (ошибка ${res.status})`);

      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (type && !type.includes("text/html") && !type.includes("application/xhtml")) {
        throw new FetchPageError("По ссылке файл, а не страница");
      }
      const { bytes, truncated } = await readCapped(res.body, maxBytes);
      return { finalUrl: current.toString(), html: decode(bytes, type), truncated };
    }
    throw new FetchPageError("Слишком много перенаправлений");
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof FetchPageError) throw e;
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof UnsafeUrlError) throw cause;
    if (signal.aborted) throw new FetchPageError("Страница не ответила за 10 секунд");
    throw new FetchPageError("Не удалось открыть страницу");
  }
}

async function readCapped(body: AsyncIterable<Uint8Array> | null, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  if (body) {
    for await (const chunk of body) {
      if (size + chunk.length > maxBytes) {
        chunks.push(chunk.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        break; // выход из цикла закрывает поток - лишнее не скачивается
      }
      chunks.push(chunk);
      size += chunk.length;
    }
  }
  return { bytes: Buffer.concat(chunks, size), truncated };
}

function decode(bytes: Buffer, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/.exec(contentType)?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString("latin1"))?.[1];
  for (const label of [fromHeader, fromMeta, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // неизвестная кодировка - пробуем следующую
    }
  }
  return bytes.toString("utf8");
}
