// Вызов языковой модели через OpenAI-совместимый API с ответом по схеме.
import { config } from "../env";
import type { PageSnapshot } from "../page/extract";
import { buildUserPrompt, SYSTEM_PROMPT, type Ad } from "./prompt";
import { parseReport, reportJsonSchema, type Report } from "./schema";

export class LlmError extends Error {
  /** Сколько стоили вызовы, которые успели пройти до ошибки: их тоже надо списать. */
  constructor(
    message: string,
    readonly costRub = 0,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type LlmResult = { report: Report; model: string; tokensIn: number; tokensOut: number; costRub: number };

type Message = { role: "system" | "user" | "assistant"; content: string };
type ChatResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};
export type HttpPost = (url: string, init: RequestInit) => Promise<Response>;

export function costRub(tokensIn: number, tokensOut: number): number {
  return (tokensIn * config.llm.priceInPerM + tokensOut * config.llm.priceOutPerM) / 1_000_000;
}

async function chat(messages: Message[], structured: boolean, post: HttpPost, timeoutMs: number) {
  const res = await post(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: config.llm.model,
      messages,
      temperature: 0.2,
      max_tokens: 3000,
      ...(structured
        ? { response_format: { type: "json_schema", json_schema: { name: "landing_report", strict: true, schema: reportJsonSchema } } }
        : {}),
    }),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const data = (await res.json()) as ChatResponse;
  return {
    ok: true as const,
    content: data.choices?.[0]?.message?.content ?? "",
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}

export async function analyze(
  ad: Ad,
  page: PageSnapshot,
  finalUrl: string,
  post: HttpPost = fetch,
  deadline = Date.now() + config.llm.totalMs,
): Promise<LlmResult> {
  if (config.llm.mock) return mockResult(ad, page);
  if (!config.llm.apiKey) throw new LlmError("Не задан ключ модели");

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(ad, page, finalUrl) },
  ];
  let tokensIn = 0;
  let tokensOut = 0;
  let structured = true;
  let lastError = "";

  // До трёх вызовов: обычный, без response_format (если шлюз его не принял), и одна попытка исправить ответ.
  // Все вызовы укладываются в общий срок: функцию на Vercel обрывают на 60-й секунде,
  // и тогда бронь расходов не снимается.
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = deadline - Date.now();
    if (left < 3000) throw new LlmError("Модель не успела ответить", costRub(tokensIn, tokensOut));
    let res;
    try {
      res = await chat(messages, structured, post, Math.min(config.llm.timeoutMs, left));
    } catch {
      throw new LlmError("Модель не ответила вовремя", costRub(tokensIn, tokensOut));
    }
    if (!res.ok) {
      if (structured && (res.status === 400 || res.status === 422)) {
        structured = false; // шлюз или модель не поддерживает структурный вывод - схема остаётся в инструкции
        continue;
      }
      throw new LlmError(`Модель ответила ошибкой ${res.status}`, costRub(tokensIn, tokensOut));
    }
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;
    const parsed = parseReport(res.content);
    if (parsed.ok) {
      return { report: parsed.report, model: config.llm.model, tokensIn, tokensOut, costRub: costRub(tokensIn, tokensOut) };
    }
    lastError = parsed.error;
    messages.push(
      { role: "assistant", content: res.content.slice(0, 6000) },
      { role: "user", content: `Ответ не прошёл проверку схемы: ${parsed.error}. Верни исправленный JSON целиком, без текста вокруг.` },
    );
  }
  throw new LlmError(`Модель не дала ответ по схеме: ${lastError}`, costRub(tokensIn, tokensOut));
}

/** Ответ без модели - для тестов и локальной разработки (LLM_MOCK=1). */
function mockResult(ad: Ad, page: PageSnapshot): LlmResult {
  const h1 = page.h1[0] ?? page.title ?? "";
  const button = page.buttons[0] ?? "";
  const fix = (n: number, severity: Report["fixes"][number]["severity"], place: string, current: string) => ({
    severity,
    place,
    problem: `Тестовая правка ${n}: в блоке нет слов объявления "${ad.headline}".`,
    why: "Человек ищет глазами то, что прочитал в объявлении, и не находит.",
    current,
    replacement: `${ad.headline} - тестовая формулировка ${n}`,
  });
  return {
    report: {
      ad_promise: `Объявление обещает: ${ad.headline}`,
      score: 42,
      verdict: "Тестовый отчёт: страница отвечает на объявление частично",
      summary: "Это ответ заглушки вместо модели. Он нужен, чтобы проверить путь от ввода до отчёта.",
      fixes: [
        fix(1, "critical", "Главный заголовок", h1),
        fix(2, "critical", "Кнопка первого экрана", button),
        fix(3, "important", "Подзаголовок", page.headings[0] ?? ""),
        fix(4, "important", "Блок доказательств", ""),
        fix(5, "minor", "Заголовок вкладки", page.title),
      ],
    },
    model: "mock",
    tokensIn: 0,
    tokensOut: 0,
    costRub: 0,
  };
}
