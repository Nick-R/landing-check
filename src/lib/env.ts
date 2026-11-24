// Все настройки - из переменных окружения. Ключи в код и репозиторий не попадают.
function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  llm: {
    get baseUrl() {
      return (process.env.LLM_BASE_URL ?? "https://api.zveno.ai/v1").replace(/\/$/, "");
    },
    get apiKey() {
      return process.env.LLM_API_KEY ?? "";
    },
    get model() {
      return process.env.LLM_MODEL ?? "anthropic/claude-sonnet-5.5";
    },
    get mock() {
      return process.env.LLM_MOCK === "1";
    },
    // Цена за миллион токенов, руб. Нужна для дневного потолка.
    get priceInPerM() {
      return num("LLM_PRICE_IN_RUB_PER_M", 390);
    },
    get priceOutPerM() {
      return num("LLM_PRICE_OUT_RUB_PER_M", 1940);
    },
    get timeoutMs() {
      return num("LLM_TIMEOUT_MS", 45_000);
    },
    // Общий срок на все вызовы модели в одной проверке. Вместе с загрузкой страницы (до 10 с)
    // укладывается в 60 секунд функции на Vercel.
    get totalMs() {
      return num("LLM_TOTAL_MS", 44_000);
    },
  },
  limits: {
    get dailyBudgetRub() {
      return num("DAILY_BUDGET_RUB", 300);
    },
    // Бронь под один запрос: списывается до вызова модели, потом заменяется фактом.
    get reserveRub() {
      return num("RESERVE_PER_CHECK_RUB", 15);
    },
    get perIpHour() {
      return num("RATE_PER_IP_HOUR", 6);
    },
    get perIpDay() {
      return num("RATE_PER_IP_DAY", 20);
    },
  },
  fetch: {
    get timeoutMs() {
      return num("FETCH_TIMEOUT_MS", 10_000);
    },
    get maxBytes() {
      return num("FETCH_MAX_BYTES", 1_500_000);
    },
    maxRedirects: 4,
  },
  get ipSalt() {
    return process.env.IP_SALT ?? "sverka-dev-salt";
  },
};
