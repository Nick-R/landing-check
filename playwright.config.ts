import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 3211;
const db = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5433/sverka_test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 800 } },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: db,
      LLM_MOCK: "1",
      // Страница-образец с диска вместо сети. На Vercel эта переменная не действует.
      E2E_FIXTURE_DIR: path.join(__dirname, "tests/fixtures"),
      RATE_PER_IP_HOUR: "1000",
      RATE_PER_IP_DAY: "1000",
    },
  },
});
