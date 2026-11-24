// Логика "принять / отклонить". Чистые функции: их использует и сервер, и интерфейс, и тесты.
import type { Severity } from "./llm/schema";

export type Decision = "accepted" | "rejected";

export type FixView = {
  id: number;
  position: number;
  severity: Severity;
  place: string;
  problem: string;
  why: string;
  current: string;
  quoteVerified: boolean;
  replacement: string;
  decision: Decision | null;
};

export function parseDecision(value: unknown): Decision | null | undefined {
  if (value === null) return null; // null - снять решение
  if (value === "accepted" || value === "rejected") return value;
  return undefined; // недопустимое значение
}

export function applyDecision(fixes: FixView[], fixId: number, decision: Decision | null): FixView[] {
  return fixes.map((f) => (f.id === fixId ? { ...f, decision } : f));
}

export function progress(fixes: FixView[]) {
  const accepted = fixes.filter((f) => f.decision === "accepted").length;
  const rejected = fixes.filter((f) => f.decision === "rejected").length;
  return { accepted, rejected, pending: fixes.length - accepted - rejected, total: fixes.length };
}

/** Список правок: только принятые правки, в порядке важности, готовый к копированию. */
export function implementationList(fixes: FixView[], pageUrl: string): string {
  const accepted = fixes.filter((f) => f.decision === "accepted").sort((a, b) => a.position - b.position);
  if (accepted.length === 0) return "";
  const items = accepted.map((f, i) => {
    const lines = [`${i + 1}. ${f.place}`];
    if (f.current && f.quoteVerified) lines.push(`   Сейчас: ${f.current}`);
    lines.push(`   ${f.current && f.quoteVerified ? "Заменить на" : "Добавить"}: ${f.replacement}`);
    return lines.join("\n");
  });
  return [`Правки для страницы: ${pageUrl}`, "", ...items].join("\n");
}
