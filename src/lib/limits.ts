// Ограничения открытого сервиса: число проверок с одного адреса и дневной потолок расходов на модель.
import { createHash } from "node:crypto";
import { pool } from "./db";
import { config } from "./env";

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${config.ipSalt}:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(headers: Headers): string {
  // На Vercel эти заголовки ставит сама платформа, клиент их подменить не может.
  const real = headers.get("x-real-ip")?.trim();
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return real || fwd || "unknown";
}

export type RateVerdict = { ok: true } | { ok: false; retry: "hour" | "day" };

/** Записывает попытку, если лимиты не превышены. Проверка и запись - одним запросом. */
export async function takeAttempt(ipHash: string): Promise<RateVerdict> {
  const { perIpHour, perIpDay } = config.limits;
  const res = await pool().query<{ hour: string; day: string; inserted: boolean }>(
    `with c as (
       select count(*) filter (where created_at > now() - interval '1 hour') as hour,
              count(*) as day
       from attempts where ip_hash = $1 and created_at > now() - interval '1 day'
     ), ins as (
       insert into attempts (ip_hash)
       select $1 from c where c.hour < $2 and c.day < $3
       returning 1
     )
     select c.hour, c.day, exists(select 1 from ins) as inserted from c`,
    [ipHash, perIpHour, perIpDay],
  );
  const row = res.rows[0];
  if (row.inserted) return { ok: true };
  return { ok: false, retry: Number(row.day) >= perIpDay ? "day" : "hour" };
}

/** Бронирует деньги под один вызов модели. false - дневной потолок исчерпан. */
export async function reserveBudget(): Promise<boolean> {
  const { dailyBudgetRub, reserveRub } = config.limits;
  const db = pool();
  await db.query(
    "insert into usage_daily (day) values ((now() at time zone 'utc')::date) on conflict (day) do nothing",
  );
  const res = await db.query(
    `update usage_daily set reserved_rub = reserved_rub + $1
     where day = (now() at time zone 'utc')::date and spent_rub + reserved_rub + $1 <= $2
     returning day`,
    [reserveRub, dailyBudgetRub],
  );
  return res.rowCount === 1;
}

/** Снимает бронь и записывает фактический расход (0, если вызов не состоялся). */
export async function settleBudget(actualRub: number): Promise<void> {
  await pool().query(
    `update usage_daily
     set reserved_rub = greatest(reserved_rub - $1, 0), spent_rub = spent_rub + $2, calls = calls + $3
     where day = (now() at time zone 'utc')::date`,
    [config.limits.reserveRub, actualRub, actualRub > 0 ? 1 : 0],
  );
}
