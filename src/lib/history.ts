// "Мои проверки": список хранится в браузере, без аккаунтов. Хранилище может быть недоступно - тогда молча обходимся без него.
export type HistoryItem = { id: string; host: string; headline: string; score: number; at: string };

const KEY = "sverka:history";

export function readHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? (data as HistoryItem[]).filter((i) => i && typeof i.id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberCheck(item: HistoryItem): void {
  try {
    const rest = readHistory().filter((i) => i.id !== item.id);
    window.localStorage.setItem(KEY, JSON.stringify([item, ...rest].slice(0, 20)));
  } catch {
    // нет доступа к хранилищу - история просто не ведётся
  }
}

// Для useSyncExternalStore: снимок должен быть одним и тем же объектом, пока данные не менялись.
let cacheRaw: string | null = null;
let cacheItems: HistoryItem[] = [];
const EMPTY: HistoryItem[] = [];

export function historySnapshot(): HistoryItem[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheItems = readHistory();
  }
  return cacheItems;
}

export const historyServerSnapshot = (): HistoryItem[] => EMPTY;

export function subscribeHistory(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
