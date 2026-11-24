// Главный путь: ввод -> загрузка страницы -> разбор -> модель -> сохранение.
import { z } from "zod";
import { saveCheck } from "./checks";
import { analyze, LlmError } from "./llm/client";
import { reserveBudget, settleBudget, takeAttempt } from "./limits";
import { acceptLanguageFor, fetchPage, FetchPageError } from "./net/safeFetch";
import { UnsafeUrlError } from "./net/ssrf";
import { extractPage } from "./page/extract";

export const inputSchema = z.object({
  url: z.string().trim().min(4, "Вставьте ссылку на страницу").max(2000, "Ссылка слишком длинная"),
  headline: z.string().trim().min(3, "Добавьте заголовок объявления").max(150, "Заголовок длиннее 150 знаков"),
  description: z.string().trim().max(500, "Описание длиннее 500 знаков").default(""),
});

export type RunResult = { ok: true; id: string } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): RunResult => ({ ok: false, status, error });

export async function runCheck(body: unknown, ipHash: string): Promise<RunResult> {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Проверьте поля");
  const { headline, description } = parsed.data;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(parsed.data.url) ? parsed.data.url : `https://${parsed.data.url}`;

  const rate = await takeAttempt(ipHash);
  if (!rate.ok) {
    return fail(429, rate.retry === "hour" ? "Слишком много проверок подряд. Попробуйте через час." : "На сегодня проверки закончились. Приходите завтра.");
  }

  let fetched;
  try {
    fetched = await fetchPage(url, { acceptLanguage: acceptLanguageFor(`${headline} ${description}`) });
  } catch (e) {
    if (e instanceof UnsafeUrlError || e instanceof FetchPageError) return fail(422, e.message);
    throw e;
  }
  const page = extractPage(fetched.html);
  if (page.text.length < 200) {
    return fail(422, "На странице почти нет текста. Скорее всего, она загружается только в браузере - такие страницы сервис пока не читает.");
  }

  if (!(await reserveBudget())) {
    return fail(503, "На сегодня проверки закончились. Приходите завтра.");
  }
  let result;
  try {
    result = await analyze({ headline, description }, page, fetched.finalUrl);
  } catch (e) {
    await settleBudget(e instanceof LlmError ? e.costRub : 0);
    if (e instanceof LlmError) console.warn("llm failed:", e.message.slice(0, 300));
    if (e instanceof LlmError) return fail(502, "Модель не успела ответить. Попробуйте ещё раз через минуту.");
    throw e;
  }
  await settleBudget(result.costRub);

  const id = await saveCheck({ url, finalUrl: fetched.finalUrl, headline, description, page, result, ipHash });
  return { ok: true, id };
}
