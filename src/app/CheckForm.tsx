"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EXAMPLES } from "@/lib/examples";
import { historyServerSnapshot, historySnapshot, subscribeHistory } from "@/lib/history";

const STAGES = ["Открываем страницу", "Читаем текст", "Сверяем с объявлением", "Собираем правки"];

export function CheckForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const history = useSyncExternalStore(subscribeHistory, historySnapshot, historyServerSnapshot);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setStage(0);
    // Этапы на экране - ориентир для человека: сервер отвечает одним запросом.
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 4500);
    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, headline, description }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? "Не получилось. Попробуйте ещё раз.");
        setBusy(false);
        return;
      }
      router.push(`/c/${data.id}`);
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз.");
      setBusy(false);
    } finally {
      if (timer.current) clearInterval(timer.current);
    }
  }

  return (
    <section className="form-col">
      <form className="card form" onSubmit={submit} aria-busy={busy}>
        <label>
          <span>Ссылка на страницу</span>
          <input
            name="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://example.com/offer"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={2000}
            required
            disabled={busy}
          />
        </label>
        <label>
          <span>Заголовок объявления</span>
          <input
            name="headline"
            placeholder="Как в объявлении, слово в слово"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={150}
            required
            disabled={busy}
          />
        </label>
        <label>
          <span>
            Описание объявления <i>необязательно</i>
          </span>
          <textarea
            name="description"
            rows={3}
            placeholder="Текст под заголовком: цена, условия, сроки"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            disabled={busy}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy ? (
          <div className="stages" role="status">
            {STAGES.map((s, i) => (
              <span key={s} className={i < stage ? "done" : i === stage ? "now" : ""}>
                {s}
              </span>
            ))}
          </div>
        ) : (
          <button className="primary" type="submit">
            Проверить
          </button>
        )}
        <div className="examples">
          <span>Подставить пример:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              disabled={busy}
              onClick={() => {
                setUrl(ex.url);
                setHeadline(ex.headline);
                setDescription(ex.description);
                setError("");
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </form>
      {history.length > 0 && (
        <div className="history">
          <h2>Мои проверки</h2>
          <ul>
            {history.slice(0, 4).map((h) => (
              <li key={h.id}>
                <Link href={`/c/${h.id}`}>
                  <b className="mono">{h.score}</b>
                  <span className="h-host">{h.host}</span>
                  <span className="h-head">{h.headline}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
