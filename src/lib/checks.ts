// Хранение проверок, правок и решений.
import { randomBytes } from "node:crypto";
import { pool, tx } from "./db";
import type { Decision, FixView } from "./decisions";
import type { LlmResult } from "./llm/client";
import type { Severity } from "./llm/schema";
import { quoteOnPage, type PageSnapshot } from "./page/extract";

export type CheckView = {
  id: string;
  url: string;
  finalUrl: string;
  adHeadline: string;
  adDescription: string;
  pageTitle: string;
  score: number;
  verdict: string;
  summary: string;
  adPromise: string;
  createdAt: string;
  fixes: FixView[];
};

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function newId(): string {
  return Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join("");
}
export const isCheckId = (s: string) => /^[a-z2-9]{12}$/.test(s);

export async function saveCheck(input: {
  url: string;
  finalUrl: string;
  headline: string;
  description: string;
  page: PageSnapshot;
  result: LlmResult;
  ipHash: string;
}): Promise<string> {
  const id = newId();
  const { report } = input.result;
  await tx(async (c) => {
    await c.query(
      `insert into checks (id, url, final_url, ad_headline, ad_description, page_title, score, verdict, summary,
                           ad_promise, model, tokens_in, tokens_out, cost_rub, ip_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, input.url, input.finalUrl, input.headline, input.description, input.page.title, report.score,
        report.verdict, report.summary, report.ad_promise, input.result.model, input.result.tokensIn,
        input.result.tokensOut, input.result.costRub, input.ipHash,
      ],
    );
    for (const [i, f] of report.fixes.entries()) {
      await c.query(
        `insert into fixes (check_id, position, severity, place, problem, why, current_text, quote_verified, replacement)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        // Цитату модели сверяем со страницей: непроверенная цитата показывается с пометкой.
        [id, i + 1, f.severity, f.place, f.problem, f.why, f.current, f.current ? quoteOnPage(f.current, input.page) : false, f.replacement],
      );
    }
  });
  return id;
}

export async function getCheck(id: string): Promise<CheckView | null> {
  if (!isCheckId(id)) return null;
  const db = pool();
  const check = await db.query(
    `select id, url, final_url, ad_headline, ad_description, page_title, score, verdict, summary, ad_promise, created_at
     from checks where id = $1`,
    [id],
  );
  const row = check.rows[0];
  if (!row) return null;
  const fixes = await db.query(
    `select f.id, f.position, f.severity, f.place, f.problem, f.why, f.current_text, f.quote_verified, f.replacement,
            d.decision
     from fixes f left join decisions d on d.fix_id = f.id
     where f.check_id = $1 order by f.position`,
    [id],
  );
  return {
    id: row.id,
    url: row.url,
    finalUrl: row.final_url,
    adHeadline: row.ad_headline,
    adDescription: row.ad_description,
    pageTitle: row.page_title,
    score: row.score,
    verdict: row.verdict,
    summary: row.summary,
    adPromise: row.ad_promise,
    createdAt: (row.created_at as Date).toISOString(),
    fixes: fixes.rows.map((f) => ({
      id: Number(f.id),
      position: f.position,
      severity: f.severity as Severity,
      place: f.place,
      problem: f.problem,
      why: f.why,
      current: f.current_text,
      quoteVerified: f.quote_verified,
      replacement: f.replacement,
      decision: (f.decision as Decision | null) ?? null,
    })),
  };
}

/** Ставит или снимает решение. false - такой правки в этой проверке нет. */
export async function setDecision(checkId: string, fixId: number, decision: Decision | null): Promise<boolean> {
  if (!isCheckId(checkId) || !Number.isSafeInteger(fixId)) return false;
  const db = pool();
  const owns = await db.query("select 1 from fixes where id = $1 and check_id = $2", [fixId, checkId]);
  if (owns.rowCount === 0) return false;
  if (decision === null) {
    await db.query("delete from decisions where fix_id = $1", [fixId]);
  } else {
    await db.query(
      `insert into decisions (fix_id, decision) values ($1, $2)
       on conflict (fix_id) do update set decision = excluded.decision, decided_at = now()`,
      [fixId, decision],
    );
  }
  return true;
}
