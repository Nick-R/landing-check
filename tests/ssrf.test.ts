import { describe, expect, it } from "vitest";
import { acceptLanguageFor, fetchPage, FetchPageError, type FetchLike } from "@/lib/net/safeFetch";
import { assertPublicAddresses, assertSafeUrl, isPublicIp, UnsafeUrlError } from "@/lib/net/ssrf";

describe("isPublicIp", () => {
  it.each([
    "127.0.0.1", "10.0.0.5", "172.16.3.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1",
    "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "224.0.0.1", "не адрес",
  ])("закрыт: %s", (ip) => expect(isPublicIp(ip)).toBe(false));

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("открыт: %s", (ip) =>
    expect(isPublicIp(ip)).toBe(true),
  );
});

describe("assertSafeUrl", () => {
  it.each([
    "ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "http://localhost/", "http://127.0.0.1/",
    "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/", "http://app.internal/", "http://printer.local/", "http://intranet/", "https://user:pass@example.com/",
    "https://example.com:8080/", "http://[::ffff:127.0.0.1]/", "совсем не ссылка",
  ])("отклоняет %s", (url) => expect(() => assertSafeUrl(url)).toThrow(UnsafeUrlError));

  it("пропускает обычные ссылки", () => {
    expect(assertSafeUrl("https://example.com/landing?utm=1").hostname).toBe("example.com");
    expect(assertSafeUrl("http://8.8.8.8/").hostname).toBe("8.8.8.8");
  });
});

describe("assertPublicAddresses", () => {
  it("отклоняет имя, которое ведёт на внутренний адрес", () => {
    expect(() => assertPublicAddresses("evil.example", [{ address: "10.0.0.1", family: 4 }])).toThrow(UnsafeUrlError);
  });
  it("отклоняет, если хотя бы один из адресов внутренний", () => {
    expect(() =>
      assertPublicAddresses("evil.example", [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]),
    ).toThrow(UnsafeUrlError);
  });
  it("пропускает публичные", () => {
    expect(assertPublicAddresses("ok.example", [{ address: "8.8.8.8", family: 4 }])).toHaveLength(1);
  });
});

async function* chunks(parts: string[]) {
  for (const p of parts) yield new TextEncoder().encode(p);
}

function fake(routes: Record<string, { status?: number; location?: string; type?: string; body?: string[] }>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`нет маршрута ${url}`);
    const headers = new Map<string, string>();
    if (r.location) headers.set("location", r.location);
    headers.set("content-type", r.type ?? "text/html; charset=utf-8");
    return { status: r.status ?? 200, headers: { get: (n) => headers.get(n.toLowerCase()) ?? null }, body: chunks(r.body ?? ["<html></html>"]) };
  };
  return Object.assign(fn, { calls });
}

describe("fetchPage", () => {
  it("идёт по перенаправлению на публичный адрес", async () => {
    const f = fake({
      "http://a.example/": { status: 301, location: "https://a.example/new" },
      "https://a.example/new": { body: ["<h1>ok</h1>"] },
    });
    const page = await fetchPage("http://a.example/", { fetchImpl: f });
    expect(page.finalUrl).toBe("https://a.example/new");
    expect(page.html).toContain("ok");
  });

  it("не идёт по перенаправлению на внутренний адрес", async () => {
    const f = fake({ "https://a.example/": { status: 302, location: "http://169.254.169.254/latest/meta-data/" } });
    await expect(fetchPage("https://a.example/", { fetchImpl: f })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(f.calls).toEqual(["https://a.example/"]); // второй запрос не ушёл
  });

  it("не идёт по перенаправлению на другую схему", async () => {
    const f = fake({ "https://a.example/": { status: 302, location: "file:///etc/passwd" } });
    await expect(fetchPage("https://a.example/", { fetchImpl: f })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("обрывает цепочку перенаправлений", async () => {
    const f = fake({ "https://a.example/": { status: 302, location: "/" } });
    await expect(fetchPage("https://a.example/", { fetchImpl: f })).rejects.toThrow("Слишком много перенаправлений");
    expect(f.calls.length).toBe(5);
  });

  it("обрезает слишком большой ответ", async () => {
    const f = fake({ "https://a.example/": { body: ["a".repeat(600), "b".repeat(600), "c".repeat(600)] } });
    const page = await fetchPage("https://a.example/", { fetchImpl: f, maxBytes: 1000 });
    expect(page.truncated).toBe(true);
    expect(page.html.length).toBe(1000);
    expect(page.html).not.toContain("c");
  });

  it("отклоняет не-страницы и ошибки сервера", async () => {
    const f = fake({
      "https://a.example/file.pdf": { type: "application/pdf" },
      "https://a.example/404": { status: 404 },
    });
    await expect(fetchPage("https://a.example/file.pdf", { fetchImpl: f })).rejects.toBeInstanceOf(FetchPageError);
    await expect(fetchPage("https://a.example/404", { fetchImpl: f })).rejects.toThrow("404");
  });

  it("обрывает по времени", async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(fetchPage("https://a.example/", { fetchImpl: slow, timeoutMs: 30 })).rejects.toThrow("не ответила");
  });

  it("настоящая загрузка: внутренний адрес отклоняется до соединения", async () => {
    await expect(fetchPage("http://127.0.0.1:80/")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(fetchPage("http://localhost/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("язык запроса страницы", () => {
  it("по языку объявления: кириллица - русский, иначе английский", () => {
    expect(acceptLanguageFor("Сайт за вечер без программиста")).toBe("ru,en;q=0.8");
    expect(acceptLanguageFor("Give every task an owner with Todoist")).toBe("en-US,en;q=0.9");
  });

  it("передаёт заголовок сайту", async () => {
    const seen: string[] = [];
    const f: FetchLike = async (_url, init) => {
      seen.push(init.headers["accept-language"]);
      return { status: 200, headers: { get: (n) => (n === "content-type" ? "text/html" : null) }, body: (async function* () { yield new TextEncoder().encode("<h1>ok</h1>"); })() };
    };
    await fetchPage("https://a.example/", { fetchImpl: f, acceptLanguage: "en-US,en;q=0.9" });
    await fetchPage("https://a.example/", { fetchImpl: f });
    expect(seen).toEqual(["en-US,en;q=0.9", "en-US,en;q=0.9"]);
  });
});
