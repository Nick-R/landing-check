import { describe, expect, it } from "vitest";
import { applyDecision, implementationList, parseDecision, progress, type FixView } from "@/lib/decisions";

const fix = (id: number, over: Partial<FixView> = {}): FixView => ({
  id, position: id, severity: "important", place: `Место ${id}`, problem: "п", why: "п",
  current: `старый текст ${id}`, quoteVerified: true, replacement: `новый текст ${id}`, decision: null, ...over,
});
const fixes = [fix(1), fix(2), fix(3)];

describe("parseDecision", () => {
  it("принимает только два решения и null", () => {
    expect(parseDecision("accepted")).toBe("accepted");
    expect(parseDecision("rejected")).toBe("rejected");
    expect(parseDecision(null)).toBeNull();
  });
  it.each([undefined, "", "maybe", 1, {}, "ACCEPTED"])("отклоняет %s", (v) => expect(parseDecision(v)).toBeUndefined());
});

describe("applyDecision", () => {
  it("меняет одну правку и не трогает исходный список", () => {
    const next = applyDecision(fixes, 2, "accepted");
    expect(next.map((f) => f.decision)).toEqual([null, "accepted", null]);
    expect(fixes[1].decision).toBeNull();
  });
  it("решение можно сменить и снять", () => {
    let next = applyDecision(fixes, 1, "accepted");
    next = applyDecision(next, 1, "rejected");
    expect(next[0].decision).toBe("rejected");
    next = applyDecision(next, 1, null);
    expect(next[0].decision).toBeNull();
  });
  it("неизвестная правка ничего не меняет", () => {
    expect(applyDecision(fixes, 99, "accepted")).toEqual(fixes);
  });
});

describe("progress", () => {
  it("считает принятые, отклонённые и нерешённые", () => {
    const next = applyDecision(applyDecision(fixes, 1, "accepted"), 3, "rejected");
    expect(progress(next)).toEqual({ accepted: 1, rejected: 1, pending: 1, total: 3 });
  });
});

describe("implementationList", () => {
  it("пустой, пока ничего не принято", () => {
    expect(implementationList(applyDecision(fixes, 1, "rejected"), "https://a.example/")).toBe("");
  });
  it("включает только принятые, по важности, с нумерацией заново", () => {
    const next = applyDecision(applyDecision(applyDecision(fixes, 3, "accepted"), 1, "accepted"), 2, "rejected");
    const text = implementationList(next, "https://a.example/");
    expect(text).toContain("https://a.example/");
    expect(text).toContain("1. Место 1");
    expect(text).toContain("2. Место 3");
    expect(text).not.toContain("Место 2");
    expect(text.indexOf("Место 1")).toBeLessThan(text.indexOf("Место 3"));
  });
  it("без цитаты или с неподтверждённой цитатой пишет 'Добавить' и не показывает 'Сейчас'", () => {
    const list = [fix(1, { current: "", decision: "accepted" }), fix(2, { quoteVerified: false, decision: "accepted" })];
    const text = implementationList(list, "https://a.example/");
    expect(text).not.toContain("Сейчас:");
    expect(text.match(/Добавить:/g)).toHaveLength(2);
  });
});
