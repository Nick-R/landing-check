import pg from "pg";
import { config } from "./env";

// Один пул на процесс. В dev модуль перезагружается, поэтому пул хранится в globalThis.
const g = globalThis as unknown as { __pool?: pg.Pool };

export function pool(): pg.Pool {
  if (!g.__pool) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL не задан");
    g.__pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
  }
  return g.__pool;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
