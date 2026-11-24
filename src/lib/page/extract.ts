// Разбор страницы: достаём то, что видит посетитель и что важно для сверки с объявлением.
import * as cheerio from "cheerio";

export type PageSnapshot = {
  title: string;
  metaDescription: string;
  h1: string[];
  headings: string[];
  buttons: string[];
  forms: number;
  text: string;
  lang: string;
};

const DROP = "script,style,noscript,template,svg,iframe,canvas,video,audio,object,embed,link,meta,head";
// Скрытое от посетителя не читаем: его не видит человек, и там удобно прятать указания для модели.
const HIDDEN =
  '[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"],[style*="visibility:hidden"],[style*="visibility: hidden"],[style*="font-size:0"]';
// Прозрачный блок скрыт, только если он не анимируется. Первый экран часто приходит с opacity:0
// и transform: так сайты делают появление при загрузке, посетитель этот текст видит.
const TRANSPARENT = /(^|;)\s*opacity\s*:\s*0(\.0+)?\s*(;|$)/i;
const ANIMATED = /transform|transition|animation/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function uniq(items: string[], max: number, maxLen = 160): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = clean(raw);
    if (!item || item.length > maxLen) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export function extractPage(html: string, maxText = 7000): PageSnapshot {
  const $ = cheerio.load(html);
  const title = clean($("title").first().text()).slice(0, 300);
  const metaDescription = clean(
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "",
  ).slice(0, 500);
  const lang = clean($("html").attr("lang") ?? "").slice(0, 12);

  $("body").find(DROP).remove();
  $("body").find(HIDDEN).remove();
  $("body")
    .find("[style]")
    .filter((_, el) => {
      const style = $(el).attr("style") ?? "";
      return TRANSPARENT.test(style) && !ANIMATED.test(style);
    })
    .remove();
  $("body")
    .find("*")
    .contents()
    .filter((_, n) => n.type === "comment")
    .remove();

  // Перенос строки внутри заголовка не должен склеивать слова: "your<br/>ads" -> "your ads".
  $("body br").replaceWith("\n");

  const h1 = uniq($("h1").map((_, el) => $(el).text()).get(), 3, 300);
  const headings = uniq($("h2,h3").map((_, el) => $(el).text()).get(), 25);
  const buttons = uniq(
    $('button,a[class*="btn" i],a[class*="button" i],a[role="button"],input[type="submit"],[class*="cta" i]')
      .map((_, el) => $(el).text() || $(el).attr("value") || "")
      .get(),
    12,
    60,
  );
  const forms = $("form").length;

  // Блочные элементы разделяем переводами строк, чтобы текст не слипался.
  $("body")
    .find("p,div,section,article,li,h1,h2,h3,h4,h5,h6,br,tr,header,footer,main,nav,button,a")
    .each((_, el) => {
      $(el).append("\n");
    });
  const text = $("body")
    .text()
    .split("\n")
    .map(clean)
    .filter(Boolean)
    .filter((line, i, all) => line !== all[i - 1])
    .join("\n")
    .slice(0, maxText);

  return { title, metaDescription, h1, headings, buttons, forms, text, lang };
}

/** Текст страницы в виде, который уходит модели. */
export function snapshotToPrompt(p: PageSnapshot): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "(нет)");
  return [
    `Заголовок вкладки: ${p.title || "(нет)"}`,
    `Описание для поиска: ${p.metaDescription || "(нет)"}`,
    `Язык страницы (атрибут lang): ${p.lang || "(не указан)"}`,
    `Главный заголовок (h1):\n${list(p.h1)}`,
    `Подзаголовки:\n${list(p.headings)}`,
    `Кнопки и призывы:\n${list(p.buttons)}`,
    `Форм на странице: ${p.forms}`,
    `Текст страницы по порядку:\n${p.text}`,
  ].join("\n\n");
}

/** Есть ли цитата на странице. Сравнение без учёта регистра, пробелов и вида кавычек. */
export function quoteOnPage(quote: string, p: PageSnapshot): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[«»“”„"'’`]/g, "")
      .replace(/[‐-―]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  const q = norm(quote);
  if (q.length < 3) return false;
  const hay = norm([p.title, p.metaDescription, ...p.h1, ...p.headings, ...p.buttons, p.text].join(" \n "));
  return hay.includes(q);
}
