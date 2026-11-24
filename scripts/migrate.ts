// Применяет migrations/*.sql по порядку. Каждая миграция - в своей транзакции.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

async function main() {
  // Для миграций нужно прямое соединение: блокировка не работает через пул соединений Neon.
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL не задан - миграции пропущены");
    process.exit(process.env.MIGRATE_OPTIONAL ? 0 : 1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    // Одна сборка за раз: параллельные выкладки не применят миграцию дважды.
    await client.query("select pg_advisory_lock(727001)");
    const dir = path.join(process.cwd(), "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set(
      (await client.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log("применена", file);
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
