// Проверки с настоящим Postgres: лимиты, потолок расходов, хранение решений.
// Запускаются, когда задан DATABASE_URL_TEST (локально и в CI).
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getCheck, saveCheck, setDecision } from "@/lib/checks";
import { pool } from "@/lib/db";
import { reserveBudget, settleBudget, takeAttempt } from "@/lib/limits";
import { extractPage } from "@/lib/page/extract";

const url = process.env.DATABASE_URL_TEST;
const d = url ? describe : describe.skip;

const page = extractPage("<html><title>Т</title><body><h1>Научим рисовать с нуля</h1><p>Текст</p></body></html>");
const result = {
  model: "test", tokensIn: 10, tokensOut: 20, costRub: 1.5,
  report: {
    ad_promise: "п", score: 61, verdict: "в", summary: "с",
    fixes: [
      { severity: "critical" as const, place: "Заголовок", problem: "п", why: "п", current: "Научим рисовать с нуля", replacement: "н1" },
      { severity: "minor" as const, place: "Кнопка", problem: "п", why: "п", current: "Купить сейчас", replacement: "н2" },
    ],
  },
};
const save = () =>
  saveCheck({ url: "https://a.example/", finalUrl: "https://a.example/", headline: "з", description: "", page, result, ipHash: "ip" });

d("база", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = url;
    execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  });
  beforeEach(async () => {
    await pool().query("truncate checks, fixes, decisions, attempts, usage_daily restart identity cascade");
    process.env.RATE_PER_IP_HOUR = "3";
    process.env.RATE_PER_IP_DAY = "5";
    process.env.DAILY_BUDGET_RUB = "40";
    process.env.RESERVE_PER_CHECK_RUB = "15";
  });
  afterAll(async () => {
    await pool().end();
  });

  it("ограничивает число проверок с одного адреса в час", async () => {
    for (let i = 0; i < 3; i++) expect(await takeAttempt("a")).toEqual({ ok: true });
    expect(await takeAttempt("a")).toEqual({ ok: false, retry: "hour" });
    expect(await takeAttempt("b")).toEqual({ ok: true }); // другой адрес не задет
  });

  it("ограничивает число проверок с одного адреса в сутки", async () => {
    await pool().query("insert into attempts (ip_hash, created_at) select 'a', now() - interval '2 hours' from generate_series(1,5)");
    expect(await takeAttempt("a")).toEqual({ ok: false, retry: "day" });
  });

  it("старые попытки не считаются", async () => {
    await pool().query("insert into attempts (ip_hash, created_at) select 'a', now() - interval '25 hours' from generate_series(1,9)");
    expect(await takeAttempt("a")).toEqual({ ok: true });
  });

  it("дневной потолок: бронь не даёт уйти выше лимита даже при одновременных запросах", async () => {
    const got = await Promise.all([reserveBudget(), reserveBudget(), reserveBudget(), reserveBudget()]);
    expect(got.filter(Boolean)).toHaveLength(2); // 40 руб / 15 руб брони = 2 вызова
  });

  it("после расчёта бронь заменяется фактическим расходом", async () => {
    expect(await reserveBudget()).toBe(true);
    await settleBudget(2.5);
    const row = (await pool().query("select spent_rub, reserved_rub, calls from usage_daily")).rows[0];
    expect(Number(row.spent_rub)).toBe(2.5);
    expect(Number(row.reserved_rub)).toBe(0);
    expect(row.calls).toBe(1);
    await pool().query("update usage_daily set spent_rub = 39");
    expect(await reserveBudget()).toBe(false);
  });

  it("сохраняет проверку и сверяет цитаты со страницей", async () => {
    const id = await save();
    const check = await getCheck(id);
    expect(check?.score).toBe(61);
    expect(check?.fixes.map((f) => f.quoteVerified)).toEqual([true, false]);
    expect(check?.fixes.every((f) => f.decision === null)).toBe(true);
  });

  it("решение ставится, меняется, снимается и переживает перечитывание", async () => {
    const id = await save();
    const [f1, f2] = (await getCheck(id))!.fixes;
    expect(await setDecision(id, f1.id, "accepted")).toBe(true);
    expect(await setDecision(id, f2.id, "rejected")).toBe(true);
    expect((await getCheck(id))!.fixes.map((f) => f.decision)).toEqual(["accepted", "rejected"]);
    await setDecision(id, f1.id, "rejected");
    await setDecision(id, f2.id, null);
    expect((await getCheck(id))!.fixes.map((f) => f.decision)).toEqual(["rejected", null]);
  });

  it("нельзя решить правку из чужой проверки", async () => {
    const a = await save();
    const b = await save();
    const foreign = (await getCheck(b))!.fixes[0];
    expect(await setDecision(a, foreign.id, "accepted")).toBe(false);
    expect((await getCheck(b))!.fixes[0].decision).toBeNull();
  });

  it("неизвестный или кривой номер проверки - пусто", async () => {
    expect(await getCheck("нет")).toBeNull();
    expect(await getCheck("aaaaaaaaaaaa")).toBeNull();
    expect(await getCheck("'; drop table checks; --")).toBeNull();
  });
});
