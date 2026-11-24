"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CheckView } from "@/lib/checks";
import { applyDecision, implementationList, progress, type Decision, type FixView } from "@/lib/decisions";
import { rememberCheck } from "@/lib/history";

const SEVERITY_LABEL = { critical: "Критично", important: "Важно", minor: "Желательно" } as const;

function scoreTone(score: number) {
  return score >= 75 ? "good" : score >= 50 ? "mid" : "bad";
}

const TONE_LABEL = { good: "высокое", mid: "среднее", bad: "низкое" } as const;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function Report({ check, host }: { check: CheckView; host: string }) {
  const [fixes, setFixes] = useState<FixView[]>(check.fixes);
  const [openId, setOpenId] = useState<number | null>(
    () => (check.fixes.find((f) => f.decision === null) ?? check.fixes[0])?.id ?? null,
  );
  const [copied, setCopied] = useState<"" | "list" | "link" | "fix">("");
  // Где на экране была строка, по которой нажали: после раскрытия она остаётся на том же месте,
  // даже если выше свернулась другая правка.
  const anchor = useRef<{ id: number; top: number } | null>(null);
  const firstRender = useRef(true);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    rememberCheck({ id: check.id, host, headline: check.adHeadline, score: check.score, at: check.createdAt });
  }, [check, host]);

  const stats = useMemo(() => progress(fixes), [fixes]);
  const listText = useMemo(() => implementationList(fixes, check.finalUrl), [fixes, check.finalUrl]);
  const accepted = fixes.filter((f) => f.decision === "accepted");

  const decide = useCallback(
    async (fix: FixView, decision: Decision | null) => {
      const before = fixes;
      const next = applyDecision(fixes, fix.id, decision);
      setFixes(next); // сначала показываем, потом сохраняем; при ошибке откатываем
      setSaveError("");
      if (decision !== null) {
        const pending = next.find((f) => f.decision === null && f.position > fix.position) ?? next.find((f) => f.decision === null);
        if (pending) setOpenId(pending.id);
      }
      try {
        const res = await fetch(`/api/checks/${check.id}/fixes/${fix.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setFixes(before);
        setOpenId(fix.id);
        setSaveError("Решение не сохранилось. Попробуйте ещё раз.");
      }
    },
    [fixes, check.id],
  );

  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (openId === null) return;
    const row = document.querySelector<HTMLElement>(`[data-fix-id="${openId}"] > .fix-row`);
    if (!row) return;
    const section = row.closest<HTMLElement>(".fixes");
    const inner = section && getComputedStyle(section).overflowY === "auto" ? section : null;
    const a = anchor.current;
    anchor.current = null;
    if (a && a.id === openId) {
      const delta = row.getBoundingClientRect().top - a.top;
      if (Math.abs(delta) < 1) return;
      if (inner) inner.scrollTop += delta;
      else window.scrollBy(0, delta);
      return;
    }
    // Правка открылась сама (после решения или с клавиатуры): показать её начало, если оно не на экране.
    const top = row.getBoundingClientRect().top;
    const limitTop = inner ? inner.getBoundingClientRect().top : 0;
    const limitBottom = inner ? inner.getBoundingClientRect().bottom : window.innerHeight;
    if (top < limitTop || top > limitBottom - 120) row.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [openId]);

  // Клавиши: стрелки или J/K - выбор правки, A - принять, R - отклонить.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const idx = fixes.findIndex((f) => f.id === openId);
      const key = e.key.toLowerCase();
      if (key === "arrowdown" || key === "j" || key === "о") {
        e.preventDefault();
        setOpenId(fixes[Math.min(idx + 1, fixes.length - 1)]?.id ?? openId);
      } else if (key === "arrowup" || key === "k" || key === "л") {
        e.preventDefault();
        setOpenId(fixes[Math.max(idx - 1, 0)]?.id ?? openId);
      } else if ((key === "a" || key === "ф") && idx >= 0) {
        void decide(fixes[idx], "accepted");
      } else if ((key === "r" || key === "к") && idx >= 0) {
        void decide(fixes[idx], "rejected");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fixes, openId, decide]);

  function flash(kind: "list" | "link" | "fix") {
    setCopied(kind);
    setTimeout(() => setCopied(""), 1600);
  }

  const circumference = 2 * Math.PI * 52;

  return (
    <div className="report">
      <header className="top">
        <Link className="mark" href="/">
          Сверка
        </Link>
        <a className="top-url" href={check.finalUrl} target="_blank" rel="noopener noreferrer nofollow">
          {host}
        </a>
        <div className="top-actions">
          <button
            type="button"
            className="ghost"
            onClick={async () => (await copyText(window.location.href)) && flash("link")}
          >
            {copied === "link" ? "Ссылка скопирована" : "Ссылка на отчёт"}
          </button>
          <Link className="ghost" href="/">
            Новая проверка
          </Link>
        </div>
      </header>

      <main className="report-grid">
        <aside className="summary">
          <dl className="ad">
            <dt>Объявление</dt>
            <dd>
              <b>{check.adHeadline}</b>
              {check.adDescription && <span>{check.adDescription}</span>}
            </dd>
            <dt>Ведёт на страницу</dt>
            <dd>
              <a className="ad-url" href={check.finalUrl} target="_blank" rel="noopener noreferrer nofollow">
                {pageLabel(check.finalUrl)}
              </a>
            </dd>
            <dt>Обещание объявления</dt>
            <dd>{check.adPromise}</dd>
          </dl>
          <div className="score-wrap">
          <div className={`score ${scoreTone(check.score)}`}>
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" className="track" />
              <circle
                cx="60"
                cy="60"
                r="52"
                className="arc"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - check.score / 100)}
              />
            </svg>
            <div className="score-num">
              <b data-testid="score">{check.score}</b>
              <span>из 100</span>
            </div>
          </div>
          <p className={`score-caption ${scoreTone(check.score)}`}>
            Соответствие объявлению
            <b>{TONE_LABEL[scoreTone(check.score)]}</b>
          </p>
          </div>
          <h1 className="verdict">{check.verdict}</h1>
          <p className="summary-text">{check.summary}</p>
        </aside>

        <section className="fixes" aria-label="Правки">
          <div className="col-head">
            <h2>Правки, сначала важные</h2>
            <span className="keys">
              <kbd>↑</kbd>
              <kbd>↓</kbd> выбрать <kbd>A</kbd> принять <kbd>R</kbd> отклонить
            </span>
          </div>
          <ol className="fix-list">
            {fixes.map((f) => {
              const open = f.id === openId;
              return (
                <li key={f.id} data-fix-id={f.id} className={`fix ${f.severity} ${f.decision ?? "pending"} ${open ? "open" : ""}`} data-testid="fix">
                  <button type="button" className="fix-row" aria-expanded={open} onClick={(e) => {
                      anchor.current = { id: f.id, top: e.currentTarget.getBoundingClientRect().top };
                      setOpenId(open ? null : f.id);
                    }}>
                    <span className="num mono">{f.position}</span>
                    <span className="sev">{SEVERITY_LABEL[f.severity]}</span>
                    <span className="place">{f.place}</span>
                    <span className="brief">{f.problem}</span>
                    <span className="state" data-testid="fix-state">
                      {f.decision === "accepted" ? "Принята" : f.decision === "rejected" ? "Отклонена" : ""}
                    </span>
                  </button>
                  {open && (
                    <div className="fix-body">
                      <div className="fix-text">
                        <p>
                          <b>Что не так.</b> {f.problem}
                        </p>
                        <p>
                          <b>Почему это важно.</b> {f.why}
                        </p>
                      </div>
                      <div className="swap">
                        {f.current && (
                          <div className="was">
                            <span>
                              Сейчас на странице{!f.quoteVerified && <i> · точной фразы на странице нет</i>}
                            </span>
                            <q>{f.current}</q>
                          </div>
                        )}
                        <div className="now">
                          <span>{f.current ? "Заменить на" : "Добавить"}</span>
                          <p>{f.replacement}</p>
                          <button
                            type="button"
                            className="copy"
                            onClick={async () => (await copyText(f.replacement)) && flash("fix")}
                          >
                            {copied === "fix" ? "Скопировано" : "Скопировать"}
                          </button>
                        </div>
                      </div>
                      <div className="fix-actions">
                        <button
                          type="button"
                          className={`accept ${f.decision === "accepted" ? "on" : ""}`}
                          onClick={() => decide(f, f.decision === "accepted" ? null : "accepted")}
                        >
                          {f.decision === "accepted" ? "Принята" : "Принять"}
                        </button>
                        <button
                          type="button"
                          className={`reject ${f.decision === "rejected" ? "on" : ""}`}
                          onClick={() => decide(f, f.decision === "rejected" ? null : "rejected")}
                        >
                          {f.decision === "rejected" ? "Отклонена" : "Отклонить"}
                        </button>
                        {saveError && (
                          <span className="error" role="alert">
                            {saveError}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="todo" aria-label="Принятые правки">
          <div className="col-head">
            <h2>Принятые правки</h2>
            <span className="count mono" data-testid="progress">
              принято {stats.accepted} из {stats.total}
            </span>
          </div>
          <div className="bar" aria-hidden="true">
            <i className="acc" style={{ width: `${(stats.accepted / stats.total) * 100}%` }} />
            <i className="rej" style={{ width: `${(stats.rejected / stats.total) * 100}%` }} />
          </div>
          {accepted.length === 0 ? (
            <p className="todo-empty">
              Здесь появятся принятые правки. Список можно скопировать и отправить тому, кто редактирует страницу.
            </p>
          ) : (
            <ol className="todo-list" data-testid="todo">
              {accepted.map((f) => (
                <li key={f.id}>
                  <b>{f.place}</b>
                  <span>{f.replacement}</span>
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            className="primary copy-list"
            disabled={accepted.length === 0}
            onClick={async () => (await copyText(listText)) && flash("list")}
          >
            {copied === "list" ? "Список скопирован" : "Скопировать список"}
          </button>
          {stats.pending > 0 && accepted.length > 0 && <p className="todo-note">Осталось решить: {stats.pending}</p>}
        </aside>
      </main>
      <footer className="foot report-foot">
        <Link className="mark" href="/">
          Сверка
        </Link>
        <Link href="/">Новая проверка</Link>
      </footer>
    </div>
  );
}

// Адрес страницы без схемы и "www.", чтобы его было легко узнать.
function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return url;
  }
}
