import { describe, it, expect } from "vitest";
import {
  monthTotal, categorySummaries, filterAndSort, formatYen, formatDateLabel, shiftMonth, toCsv, parseAmount,
  parseFieldErrors, receiptProblem, buildQuery, safeNext, withParams, devParams,
} from "../public/lib.js";

const categories = [
  { id: "food", name: "食費", color: "#e8590c" },
  { id: "daily", name: "日用品", color: "#1c7ed6" },
  { id: "fun", name: "娯楽", color: "#ae3ec9" },
];
const entries = [
  { id: 1, date: "2026-10-01", amount: 3120, categoryId: "food", memo: "a" },
  { id: 2, date: "2026-10-05", amount: 1280, categoryId: "daily", memo: "b" },
  { id: 3, date: "2026-10-18", amount: 12345, categoryId: "food", memo: "c" },
];

describe("月の合計", () => {
  it("すべての記録を足す", () => {
    expect(monthTotal(entries)).toBe(16745);
    expect(monthTotal([])).toBe(0);
    expect(monthTotal(undefined)).toBe(0);
  });

  it("カテゴリごとに予算に対する支出を出し、超えたら over", () => {
    const s = categorySummaries(entries, { food: 10000, daily: 5000 }, categories);
    const food = s.find((x) => x.id === "food");
    const daily = s.find((x) => x.id === "daily");
    const fun = s.find((x) => x.id === "fun");
    expect(food).toMatchObject({ spent: 15465, budget: 10000, over: true, percent: 100 });
    expect(food.remainingLabel).toBe("¥5,465 超過");
    expect(daily).toMatchObject({ spent: 1280, budget: 5000, over: false, percent: 26 });
    expect(fun).toMatchObject({ spent: 0, budget: null, over: false, percent: 0, budgetLabel: "予算なし" });
  });

  it("予算 0 は少しでも使えば超過", () => {
    const s = categorySummaries(entries, { daily: 0, fun: 0 }, categories);
    expect(s.find((x) => x.id === "daily").over).toBe(true);
    expect(s.find((x) => x.id === "fun").over).toBe(false);
  });

  it("予算ちょうどは超過ではない", () => {
    const s = categorySummaries([{ categoryId: "food", amount: 100 }], { food: 100 }, categories);
    expect(s[0]).toMatchObject({ over: false, percent: 100 });
  });
});

describe("一覧", () => {
  it("カテゴリで絞り込み、並べ替える", () => {
    expect(filterAndSort(entries, "food", "-amount").map((e) => e.id)).toEqual([3, 1]);
    expect(filterAndSort(entries, "", "amount").map((e) => e.id)).toEqual([2, 1, 3]);
    expect(filterAndSort(entries, "", "-date").map((e) => e.id)).toEqual([3, 2, 1]);
    expect(filterAndSort(entries, "", "nonsense").map((e) => e.id)).toEqual([1, 2, 3]);
  });
});

describe("表示の形", () => {
  it("円と日付", () => {
    expect(formatYen(12345)).toBe("¥12,345");
    expect(formatDateLabel("2026-10-26")).toBe("10月26日(月)");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("CSV のエスケープ", () => {
    const csv = toCsv([{ date: "2026-10-01", categoryName: "食費", memo: 'a,"b"', amount: 1, by: "母" }]);
    expect(csv).toBe('日付,カテゴリ,メモ,金額,入力者\r\n2026-10-01,食費,"a,""b""",1,母');
  });
  it("金額の文字は、ただの整数でなければサーバーの判断に任せる", () => {
    expect(parseAmount("1200")).toBe(1200);
    expect(parseAmount("-5")).toBe(-5);
    expect(parseAmount("abc")).toBe("abc");
    expect(parseAmount("")).toBe("");
  });
});

describe("サーバーのエラー", () => {
  it("422 の欄ごとのエラーを読む", () => {
    const error = { status: 422, statusText: "", body: JSON.stringify({ errors: { amount: "金額は整数で入力してください" } }) };
    expect(parseFieldErrors(error)).toEqual({ amount: "金額は整数で入力してください" });
    expect(parseFieldErrors({ status: 500, body: "{}" })).toEqual({});
    expect(parseFieldErrors({ status: 422, body: "not json" })).toEqual({});
    expect(parseFieldErrors(null)).toEqual({});
  });
  it("領収書の制限", () => {
    expect(receiptProblem({ type: "image/png", size: 10 })).toBe("");
    expect(receiptProblem({ type: "text/plain", size: 10 })).toContain("画像");
    expect(receiptProblem({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toContain("5MB");
  });
});

describe("URL", () => {
  it("クエリは開発用のスイッチを残し、next と既定値を落とす", () => {
    expect(buildQuery({ category: "food", delay: "3000", next: "/x" }, { sort: "-amount" })).toBe("?category=food&delay=3000&sort=-amount");
    expect(buildQuery({ category: "food" }, { category: "" })).toBe("?");
    expect(withParams("/api/x?m=1", devParams({ delay: "5" }))).toBe("/api/x?m=1&delay=5");
    expect(safeNext("//evil.example")).toBe("");
    expect(safeNext("/months/2026-09?category=food")).toBe("/months/2026-09?category=food");
  });
});
