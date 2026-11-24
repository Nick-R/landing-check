// Схема ответа модели. Одна и та же схема уходит модели (структурный вывод)
// и проверяет ответ на сервере: ответу модели на слово не верим.
import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

export const SEVERITIES = ["critical", "important", "minor"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const fixSchema = z.object({
  severity: z.enum(SEVERITIES),
  place: text(120),
  problem: text(300),
  why: text(400),
  current: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(400)),
  replacement: text(600),
});

export const reportSchema = z.object({
  ad_promise: text(300),
  score: z.number().int().min(0).max(100),
  verdict: text(140),
  summary: text(600),
  fixes: z.array(fixSchema).min(3).max(7),
});

export type Report = z.infer<typeof reportSchema>;
export type ReportFix = z.infer<typeof fixSchema>;

// JSON Schema для структурного вывода. Без ограничений длины: строгий режим их не принимает,
// длины и количество проверяет reportSchema.
const str = { type: "string" } as const;
export const reportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ad_promise", "score", "verdict", "summary", "fixes"],
  properties: {
    ad_promise: str,
    score: { type: "integer" },
    verdict: str,
    summary: str,
    fixes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "place", "problem", "why", "current", "replacement"],
        properties: {
          severity: { type: "string", enum: [...SEVERITIES] },
          place: str,
          problem: str,
          why: str,
          current: str,
          replacement: str,
        },
      },
    },
  },
} as const;

/** Достаёт JSON из ответа модели: модель может обернуть его в ```json или добавить текст вокруг. */
export function parseReport(raw: string): { ok: true; report: Report } | { ok: false; error: string } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "в ответе нет JSON-объекта" };
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: `JSON не разбирается: ${(e as Error).message}` };
  }
  const parsed = reportSchema.safeParse(data);
  if (!parsed.success) {
    const error = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "корень"}: ${i.message}`)
      .join("; ");
    return { ok: false, error };
  }
  const order: Record<Severity, number> = { critical: 0, important: 1, minor: 2 };
  // Сортировка устойчивая: внутри одной важности остаётся порядок модели.
  const fixes = [...parsed.data.fixes].sort((a, b) => order[a.severity] - order[b.severity]);
  return { ok: true, report: { ...parsed.data, fixes } };
}
