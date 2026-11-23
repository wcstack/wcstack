// The counts and percentages, the pager's page numbers, the editor's validation, the FAQ counts.
import { describe, expect, test } from "vitest";
import { allStatuses, countStatuses, familyName, isInUse, matchesFilter, usagePercent } from "../public/parts/lib/counts.js";
import { editable, fieldErrors, isDirty, personOf, validateTenant } from "../public/parts/lib/tenant-rules.js";
import { countMatches, countQuestions, normalizeQuery, questionMatches, textMatches, walk } from "../public/parts/lib/faq.js";
import { makeData } from "../data.js";
import { partState, stateOf } from "./helpers.js";

describe("counts and percentages", () => {
  test("countStatuses", () => {
    expect(countStatuses(["free", "used", "renewal", "paused", "used", "free"]))
      .toEqual({ total: 6, free: 2, used: 2, renewal: 1, paused: 1, inUse: 3 });
    expect(countStatuses([])).toEqual({ total: 0, free: 0, used: 0, renewal: 0, paused: 0, inUse: 0 });
    expect(countStatuses(undefined).total).toBe(0);
    expect(countStatuses(["weird"]).total).toBe(1);
  });
  test("in use = used + renewal", () => {
    expect([isInUse("used"), isInUse("renewal"), isInUse("paused"), isInUse("free")]).toEqual([true, true, false, false]);
  });
  test("usagePercent rounds and survives zero", () => {
    expect(usagePercent(60, 78)).toBe(77);
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(2, 3)).toBe(67);
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(5, 5)).toBe(100);
  });
  test("matchesFilter", () => {
    expect(matchesFilter("free", "all")).toBe(true);
    expect(matchesFilter("free", undefined)).toBe(true);
    expect(matchesFilter("free", "free")).toBe(true);
    expect(matchesFilter("used", "free")).toBe(false);
  });
  test("allStatuses walks gardens → areas → plots", () => {
    expect(allStatuses([{ areas: [{ plots: [{ status: "free" }, { status: "used" }] }, { plots: [] }] }, { areas: [] }])).toEqual(["free", "used"]);
  });
  test("familyName", () => {
    expect(familyName("佐藤 太郎")).toBe("佐藤");
    expect(familyName("佐藤　太郎")).toBe("佐藤");
    expect(familyName("")).toBe("");
    expect(familyName(null)).toBe("");
  });
  test("the whole data set: 298 plots; the gardens add up to the city", () => {
    const { gardens } = makeData();
    const c = countStatuses(allStatuses(gardens));
    expect(c.total).toBe(298);
    expect(c.free + c.used + c.renewal + c.paused).toBe(298);
    expect(gardens.map((g) => countStatuses(allStatuses([g])).free).reduce((a, b) => a + b, 0)).toBe(c.free);
  });
});

describe("the pager's page numbers (parts/midori-pager.html's own state)", async () => {
  const def = await partState("midori-pager");
  // (the numbers are data the part builds: when it connects, and when the page writes total, per or page)
  const built = (total, per, page) => { const s = stateOf(def, { total, per, page }); s.build(); return s.items; };
  const numbers = (total, per, page) => built(total, per, page).map((i) => (i.gap ? "…" : i.n));
  test("first page of six", () => expect(numbers(120, 20, 1)).toEqual([1, 2, "…", 6]));
  test("a gap of one number shows the number", () => expect(numbers(120, 20, 3)).toEqual([1, 2, 3, 4, 5, 6]));
  test("the middle of many", () => expect(numbers(400, 20, 10)).toEqual([1, "…", 9, 10, 11, "…", 20]));
  test("the last page", () => expect(numbers(400, 20, 20)).toEqual([1, "…", 19, 20]));
  test("one page, no items, a page past the end, nonsense", () => {
    expect(numbers(5, 20, 1)).toEqual([1]);
    expect(numbers(0, 20, 1)).toEqual([1]);
    expect(numbers(30, 20, 9)).toEqual([1, 2]);
    expect(numbers(30, 0, "x")).toEqual([1, 2, "…", 30]);
  });
  test("summary and the ends", () => {
    const s = stateOf(def, { total: 70, per: 20, page: 4 });
    expect(s.summary).toBe("4 / 4 ページ（全 70 件）");
    expect(s.atLast).toBe(true);
    expect(stateOf(def, { total: 70, per: 20, page: 1 }).atFirst).toBe(true);
  });
  test("the same number has the same key, so its row stays and the pressed button keeps its focus ($listKeys)", () => {
    const a = built(120, 20, 1).find((i) => i.n === 2);
    const b = built(120, 20, 2).find((i) => i.n === 2);
    expect(a.key).toBe(b.key);
    expect(def.$listKeys).toEqual({ items: "key" });
  });
});

describe("the editor's validation", () => {
  test("氏名 is required", () => {
    expect(validateTenant({ name: "" }).name).toBe("氏名は必須です");
    expect(validateTenant({ name: "   " }).name).toBe("氏名は必須です");
    expect(validateTenant({ name: "佐藤" }).name).toBeUndefined();
    expect(validateTenant({ name: "あ".repeat(41) }).name).toBe("氏名は 40 文字までです");
  });
  test("電話 is digits and hyphens", () => {
    expect(validateTenant({ name: "a", phone: "03-1234-5678" })).toEqual({});
    expect(validateTenant({ name: "a", phone: "" })).toEqual({});
    expect(validateTenant({ name: "a", phone: "03 1234" }).phone).toBeTruthy();
    expect(validateTenant({ name: "a", phone: "０３" }).phone).toBeTruthy();
  });
  test("郵便番号 is seven digits", () => {
    expect(validateTenant({ name: "a", postal: "100-0001" })).toEqual({});
    expect(validateTenant({ name: "a", postal: "1000001" })).toEqual({});
    expect(validateTenant({ name: "a", postal: "100-001" }).postal).toBeTruthy();
  });
  test("dirty: against the saved copy; a new person is dirty once anything is typed", () => {
    const t = editable({ name: "佐藤", phone: "1", postal: "", address: "" });
    expect(isDirty(t, t.saved)).toBe(false);
    expect(isDirty({ ...t, phone: "2" }, t.saved)).toBe(true);
    expect(isDirty({ name: "", phone: "", postal: "", address: "" }, null)).toBe(false);
    expect(isDirty({ name: "a" }, null)).toBe(true);
  });
  test("server field errors map onto the editor's fields", () => {
    expect(fieldErrors({ "tenant.name": "x", "tenant.phone": "y", other: "z" }, "tenant.")).toEqual({ name: "x", phone: "y" });
    expect(fieldErrors({ name: "x", gardenId: "g" })).toEqual({ name: "x" });
    expect(personOf({ name: " 佐藤 ", phone: 1, extra: true })).toEqual({ name: "佐藤", phone: "1", postal: "", address: "" });
  });
});

describe("the FAQ counts", () => {
  const tree = [
    { id: 1, title: "申し込み", questions: [{ q: "時期は？", a: "春" }, { q: "方法は？", a: "窓口" }], children: [
      { id: 2, title: "資格", questions: [{ q: "市外は？", a: "不可" }], children: [
        { id: 3, title: "家族", questions: [{ q: "家族名義は？", a: "可" }], children: [] },
      ] },
    ] },
    { id: 4, title: "料金", questions: [{ q: "年額は？", a: "5000円" }], children: [] },
  ];
  test("questions in it and below it, at every depth", () => {
    expect(countQuestions(tree[0])).toBe(4);
    expect(countQuestions(tree[0].children[0])).toBe(2);
    expect(countQuestions(tree[0].children[0].children[0])).toBe(1);
    expect(countQuestions(tree[1])).toBe(1);
    expect(walk(tree).map((x) => x.depth)).toEqual([1, 2, 3, 1]);
  });
  test("search: text, answers, a matching title counts its own questions", () => {
    expect(countMatches(tree[0], "家族")).toBe(1);
    expect(countMatches(tree[0], "窓口")).toBe(1);
    expect(countMatches(tree[0], "資格")).toBe(1);
    expect(countMatches(tree[1], "家族")).toBe(0);
    expect(questionMatches({ q: "ABC", a: "" }, "ａｂｃ")).toBe(true);
    expect(textMatches("anything", "")).toBe(false);
    expect(normalizeQuery("　Ａ　")).toBe("a");
  });
  test("the server's tree: about 40 nodes, five deep", () => {
    const nodes = walk(makeData().faq);
    expect(nodes.length).toBeGreaterThanOrEqual(35);
    expect(Math.max(...nodes.map((n) => n.depth))).toBe(5);
  });
});
