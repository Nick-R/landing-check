import { describe, expect, it } from "vitest";
import { parseReport } from "@/lib/llm/schema";

const fix = (over: Record<string, unknown> = {}) => ({
  severity: "important",
  place: "Главный заголовок",
  problem: "В заголовке нет слов объявления.",
  why: "Человек не узнаёт, что попал туда, куда шёл.",
  current: "Научим рисовать с нуля",
  replacement: "Первое занятие по рисованию - бесплатно",
  ...over,
});
const report = (over: Record<string, unknown> = {}) => ({
  ad_promise: "Бесплатное первое занятие",
  score: 55,
  verdict: "Страница не подтверждает бесплатное занятие",
  summary: "Тема совпадает, обещание не подтверждено.",
  fixes: [fix(), fix(), fix(), fix(), fix()],
  ...over,
});

describe("parseReport", () => {
  it("принимает ответ по схеме", () => {
    const r = parseReport(JSON.stringify(report()));
    expect(r.ok).toBe(true);
  });

  it("достаёт JSON из обёртки ```json и текста вокруг", () => {
    const r = parseReport("Вот отчёт:\n```json\n" + JSON.stringify(report()) + "\n```\nГотово.");
    expect(r.ok).toBe(true);
  });

  it("ставит критичные правки первыми, порядок внутри важности не меняет", () => {
    const fixes = [
      fix({ severity: "minor", place: "m1" }),
      fix({ severity: "critical", place: "c1" }),
      fix({ severity: "important", place: "i1" }),
      fix({ severity: "critical", place: "c2" }),
      fix({ severity: "important", place: "i2" }),
    ];
    const r = parseReport(JSON.stringify(report({ fixes })));
    expect(r.ok && r.report.fixes.map((f) => f.place)).toEqual(["c1", "c2", "i1", "i2", "m1"]);
  });

  it("разрешает пустую цитату и чистит пробелы", () => {
    const r = parseReport(JSON.stringify(report({ fixes: [fix({ current: "", place: "  Блок \n цен " }), fix(), fix(), fix(), fix()] })));
    expect(r.ok && r.report.fixes[0].place).toBe("Блок цен");
    expect(r.ok && r.report.fixes[0].current).toBe("");
  });

  it("отбрасывает лишние поля", () => {
    const r = parseReport(JSON.stringify(report({ html: "<script>alert(1)</script>" })));
    expect(r.ok && "html" in r.report).toBe(false);
  });

  it.each([
    ["меньше 3 правок", report({ fixes: [fix(), fix()] })],
    ["больше 7 правок", report({ fixes: Array.from({ length: 8 }, () => fix()) })],
    ["оценка вне диапазона", report({ score: 140 })],
    ["дробная оценка", report({ score: 55.5 })],
    ["неизвестная важность", report({ fixes: [fix({ severity: "blocker" }), fix(), fix(), fix(), fix()] })],
    ["пустая формулировка", report({ fixes: [fix({ replacement: "  " }), fix(), fix(), fix(), fix()] })],
    ["нет поля", report({ verdict: undefined })],
    ["слишком длинное поле", report({ verdict: "а".repeat(500) })],
  ])("отклоняет: %s", (_name, data) => {
    const r = parseReport(JSON.stringify(data));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it.each(["", "Не могу помочь с этим запросом.", "{ не json }", "[1,2,3]"])("отклоняет не-JSON: %s", (raw) => {
    expect(parseReport(raw).ok).toBe(false);
  });
});
