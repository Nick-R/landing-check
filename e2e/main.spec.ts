import { expect, test } from "@playwright/test";

test("главный путь: ввод - отчёт - решения - список к внедрению", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Ссылка на страницу").fill("https://fixture.example/landing");
  await page.getByLabel("Заголовок объявления").fill("Первое занятие по рисованию - бесплатно");
  await page.getByLabel(/Описание объявления/).fill("Группы до 8 человек. Запись онлайн.");
  await page.getByRole("button", { name: "Проверить" }).click();

  // Отчёт открывается по своей ссылке
  await page.waitForURL(/\/c\/[a-z2-9]{12}$/);
  await expect(page.getByTestId("score")).toHaveText("42");
  await expect(page.getByTestId("fix")).toHaveCount(5);
  await expect(page.getByTestId("progress")).toHaveText("принято 0 из 5");
  await expect(page.getByRole("button", { name: "Скопировать список" })).toBeHidden();

  // Отчёт помещается на экран ноутбука без прокрутки страницы
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
  expect(scrollable).toBe(false);

  // Принять первую, отклонить вторую (открывается сама), третью принять с клавиатуры
  await page.getByRole("button", { name: "Принять", exact: true }).click();
  await page.getByRole("button", { name: "Отклонить", exact: true }).click();
  await page.keyboard.press("a");
  await expect(page.getByTestId("progress")).toHaveText("принято 2 из 5");
  await expect(page.getByTestId("fix-state")).toHaveText(["Принята", "Отклонена", "Принята", "", ""]);
  await expect(page.getByTestId("todo").locator("li")).toHaveCount(2);

  // Список копируется и содержит только принятые
  await page.getByRole("button", { name: "Скопировать список" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("1. Главный заголовок");
  expect(copied).toContain("2. Подзаголовок");
  expect(copied).not.toContain("Кнопка первого экрана");

  // Решения сохранены: после перезагрузки всё на месте
  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText("принято 2 из 5");
  await expect(page.getByTestId("fix-state")).toHaveText(["Принята", "Отклонена", "Принята", "", ""]);

  // Проверка попала в историю на главной
  await page.getByRole("link", { name: "Новая проверка" }).click();
  await expect(page.getByRole("heading", { name: "Мои проверки" })).toBeVisible();
  await expect(page.locator(".history li")).toHaveCount(1);
});

test("защита: внутренние адреса, чужие схемы и пустой ввод отклоняются", async ({ request }) => {
  const post = (data: unknown) => request.post("/api/checks", { data });
  for (const url of ["http://127.0.0.1/", "http://localhost:3000/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "http://[::1]/"]) {
    const res = await post({ url, headline: "Заголовок объявления" });
    expect(res.status(), url).toBe(422);
  }
  expect((await post({ url: "https://fixture.example/", headline: "" })).status()).toBe(400);
  expect((await post({ url: "https://fixture.example/", headline: "а".repeat(151) })).status()).toBe(400);
  expect((await request.post("/api/checks", { data: "не json", headers: { "content-type": "application/json" } })).status()).toBe(400);
});

test("решения: чужая правка и недопустимое значение отклоняются, неизвестная проверка - 404", async ({ request, page }) => {
  const res = await request.post("/api/checks", { data: { url: "https://fixture.example/", headline: "Заголовок объявления" } });
  const { id } = (await res.json()) as { id: string };
  expect((await request.put(`/api/checks/${id}/fixes/999999`, { data: { decision: "accepted" } })).status()).toBe(404);
  expect((await request.put(`/api/checks/${id}/fixes/1`, { data: { decision: "maybe" } })).status()).toBe(400);
  const missing = await page.goto("/c/aaaaaaaaaaaa");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Такой проверки нет" })).toBeVisible();
});

test("телефон: главная и отчёт помещаются по ширине, объявление и страница видны сверху", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  await page.goto("/");
  expect(await fits()).toBe(true);
  await page.getByLabel("Ссылка на страницу").fill("https://fixture.example/landing");
  await page.getByLabel("Заголовок объявления").fill(
    "Первое занятие по рисованию - бесплатно, Supercalifragilisticexpialidocious-очень-длинное-слово-без-пробелов",
  );
  await page.getByRole("button", { name: "Проверить" }).click();
  await page.waitForURL(/\/c\/[a-z2-9]{12}$/);
  await expect(page.getByTestId("score")).toBeVisible();
  expect(await fits()).toBe(true);

  // Объявление и адрес страницы - выше оценки
  const adTop = (await page.locator(".ad").boundingBox())!.y;
  const scoreTop = (await page.getByTestId("score").boundingBox())!.y;
  expect(adTop).toBeLessThan(scoreTop);
  await expect(page.locator(".ad-url")).toHaveText("fixture.example/landing");
});
