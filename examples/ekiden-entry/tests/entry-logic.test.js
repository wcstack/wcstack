import { describe, it, expect } from "vitest";
import * as L from "../public/lib/entry-logic.js";

describe("fees", () => {
  it("per division, reserves, parking and lunches", () => {
    expect(L.feeBreakdown({ division: "一般", runnerCount: 5, parking: 0, lunchJa: 0, lunchWestern: 0 }).total).toBe(12000);
    expect(L.feeBreakdown({ division: "ミックス", runnerCount: 5 }).total).toBe(10000);
    expect(L.feeBreakdown({ division: "高校生", runnerCount: 5 }).total).toBe(8000);
    expect(L.feeBreakdown({ division: "中学生", runnerCount: 5 }).total).toBe(5000);
    const f = L.feeBreakdown({ division: "一般", runnerCount: 7, parking: 3, lunchJa: 2, lunchWestern: "1" });
    expect(f).toMatchObject({ base: 12000, reserves: 2, reserveFee: 2000, parkingFee: 1500, lunchFee: 2400, total: 17900 });
  });
  it("no division yet is ¥0 base; fewer than five runners are no reserves", () => {
    expect(L.feeBreakdown({ division: "", runnerCount: 3, parking: 1 }).total).toBe(500);
  });
  it("totalFee reads the API entry", () => {
    expect(L.totalFee({ team: { division: "中学生" }, runners: [{}, {}, {}, {}, {}, {}], options: { parking: 1, lunchJa: 1, lunchWestern: 0 } })).toBe(5000 + 1000 + 500 + 800);
  });
  it("formats money and dates the Japanese way", () => {
    expect(L.formatYen(12000)).toBe("¥12,000");
    expect(L.formatDateJa("2010-04-02")).toBe("2010年4月2日");
    expect(L.formatDateJa("2010-02-30")).toBe("");
  });
});

describe("ages on race day (2027-03-07)", () => {
  it("counts the birthday", () => {
    expect(L.ageOn("2009-03-07")).toBe(18);
    expect(L.ageOn("2009-03-08")).toBe(17);
    expect(L.ageOn("2012-03-07")).toBe(15);
    expect(L.ageOn("2008-02-29")).toBe(19);
  });
  it("needs a consent under 18", () => {
    expect(L.needsConsent("2009-03-08")).toBe(true);
    expect(L.needsConsent("2009-03-07")).toBe(false);
    expect(L.needsConsent("")).toBe(false);
  });
});

describe("normalising and formatting", () => {
  it("keeps half-width digits only", () => {
    expect(L.digitsOnly("０９０－１２３４ー５６７８")).toBe("09012345678");
    expect(L.digitsOnly("〒123-4567")).toBe("1234567");
    expect(L.digitsOnly(" 03 1234 5678 ")).toBe("0312345678");
  });
  it("formats phone numbers, also partly typed", () => {
    expect(L.formatPhone("09012345678")).toBe("090-1234-5678");
    expect(L.formatPhone("0312345678")).toBe("03-1234-5678");
    expect(L.formatPhone("0277123456")).toBe("027-712-3456");
    expect(L.formatPhone("0120123456")).toBe("0120-123-456");
    expect(L.formatPhone("0901")).toBe("090-1");
    expect(L.formatPhone("090")).toBe("090");
    expect(L.formatPhone("090123456789")).toBe("090-1234-5678");   // at most 11 digits
  });
  it("formats 〒 and times", () => {
    expect(L.formatPostal("1234567")).toBe("123-4567");
    expect(L.formatPostal("123")).toBe("123");
    expect(L.formatTime("2345")).toBe("23:45");
    expect(L.formatTime("234")).toBe("23:4");
    expect(L.timeToSeconds("2345")).toBe(23 * 60 + 45);
    expect(L.timeToSeconds("945")).toBe(9 * 60 + 45);
    expect(L.timeToSeconds("2375")).toBe(null);
    expect(L.secondsToDigits(1425)).toBe("2345");
  });
  it("keeps the caret after the same digit", () => {
    // "090-123|5678" + "4" typed → raw "090-1234|5678" → "090-1234-5678", caret after the 4
    expect(L.reformat("phone", "090-12345678", 8)).toEqual({ digits: "09012345678", text: "090-1234-5678", caret: 8 });
    // a hyphen deleted: the digits do not change, the caret stays before the hyphen
    expect(L.reformat("phone", "0901234-5678", 3)).toEqual({ digits: "09012345678", text: "090-1234-5678", caret: 3 });
    // pasted with full-width characters
    expect(L.reformat("phone", "０９０－１２３４－５６７８", 13)).toMatchObject({ text: "090-1234-5678", caret: 13 });
    expect(L.reformat("postal", "〒123-4567", 9)).toMatchObject({ digits: "1234567", text: "123-4567", caret: 8 });
    expect(L.reformat("time", "2345", 4)).toMatchObject({ text: "23:45", caret: 5 });
    expect(L.reformat("phone", "", 0)).toEqual({ digits: "", text: "", caret: 0 });
  });
  it("refuses a digit typed into a full field instead of pushing the last one out", () => {
    // "12|3-4567" + "9" → refused: 123-4567 stays, caret where it was
    expect(L.reformat("postal", "129-34567", 3, "1234567")).toEqual({ digits: "1234567", text: "123-4567", caret: 2 });
    // a longer paste into a field that was not full is cut at the limit
    expect(L.reformat("postal", "123-45678", 9, "123")).toMatchObject({ digits: "1234567", text: "123-4567" });
  });
  it("converts kana to full-width katakana", () => {
    expect(L.toKatakana("やまだ")).toBe("ヤマダ");
    expect(L.toKatakana("ﾔﾏﾀﾞ ﾊﾟﾝ")).toBe("ヤマダ パン");
    expect(L.toKatakana("ヴァイオリン")).toBe("ヴァイオリン");
    expect(L.toKatakanaWithCaret("ｶﾞｷﾞ", 2)).toEqual({ text: "ガギ", caret: 1 });
    // typed one key at a time: ﾐ → ミ, ﾄ → ミト, then ﾞ arrives after the converted ト
    expect(L.toKatakana("ミトﾞ")).toBe("ミド");
    expect(L.toKatakana("ハﾟ")).toBe("パ");
    expect(L.toKatakana("アﾞ")).toBe("ア゛");
    expect(L.isKatakana("ヤマダ　ハナコ")).toBe(true);
    expect(L.isKatakana("やまだ")).toBe(false);
  });
  it("counts characters as a person does", () => {
    expect(L.charCount("𠮷野家")).toBe(3);
    expect(L.charCount("走る🏃‍♀️")).toBe(3);
    expect(L.charCount("👨‍👩‍👧")).toBe(1);
  });
});

describe("steps", () => {
  const complete = () => {
    const e = L.emptyEntry(((n) => () => `r${n++}`)(1));
    Object.assign(e.team, { name: "みどりAC", kana: "ミドリエーシー", division: "一般" });
    Object.assign(e.rep, { name: { family: "山田", given: "花子" }, kana: { family: "ヤマダ", given: "ハナコ" }, birth: "1985-06-15",
      postal: "3790000", prefecture: "10", city: "みどり市", street: "中央1-2-3", phone: "09012345678", email: "a@example.jp", emailConfirm: "a@example.jp" });
    e.runners.forEach((r, i) => Object.assign(r, { name: `走者${i}`, kana: "ソウシャ", birth: "1990-01-01", sex: "male", best: "2345", shirt: "M" }));
    e.options.payment = "cash";
    return e;
  };
  it("the first step that is not complete", () => {
    expect(L.firstIncompleteStep(null)).toBe("team");
    const e = complete();
    expect(L.firstIncompleteStep(e)).toBe("confirm");
    e.runners[3].best = "23";
    expect(L.firstIncompleteStep(e)).toBe("runners");
    e.rep.emailConfirm = "b@example.jp";
    expect(L.firstIncompleteStep(e)).toBe("team");
  });
  it("a field the payment hides blocks nothing and is not sent", () => {
    const e = complete();
    e.options.transferName = "やまだ";            // not katakana, but 当日現金 is chosen
    expect(L.validateOptionsStep(e)).toEqual({});
    expect(L.toApiEntry(e).options).not.toHaveProperty("transferName");
    e.options.payment = "transfer";
    expect(L.validateOptionsStep(e)).toHaveProperty("options.transferName");
  });
  it("under 18 needs a consent; the receipt name follows the team name until edited", () => {
    const e = complete();
    e.runners[0].birth = "2012-01-01";
    expect(L.validateRunnersStep(e)).toHaveProperty("runners.0.consentId");
    e.runners[0].consentId = "abc";
    expect(L.validateRunnersStep(e)).toEqual({});
    expect(L.toApiEntry(e).options.receiptName).toBe("みどりAC");
    e.options.receiptTouched = true; e.options.receiptName = "みどり陸上部";
    expect(L.toApiEntry(e).options.receiptName).toBe("みどり陸上部");
    expect(L.toApiEntry(e).runners[0]).toMatchObject({ best: 1425, consentId: "abc" });
  });
  it("the team name: at most 20 characters as a person counts them", () => {
    const e = complete();
    e.team.name = "𠮷".repeat(20);
    expect(L.validateTeamStep(e)).not.toHaveProperty("team.name");
    e.team.name = "𠮷".repeat(21);
    expect(L.validateTeamStep(e)).toHaveProperty("team.name");
  });
});

describe("placing the server's errors", () => {
  it("runner errors by row number become errors by runner id; every step with one is listed", () => {
    const runners = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const p = L.placeErrors({ "team.name": "x", "runners.2.birth": "y", "runners.0.name": "z", "options.transferName": "w", "runners.9.name": "?" }, runners);
    expect(p.fields).toEqual({ "team.name": "x", "options.transferName": "w" });
    expect(p.byRunner).toEqual({ c: { birth: "y" }, a: { name: "z" } });
    expect(p.steps.sort()).toEqual(["options", "runners", "team"]);
    expect(p.unplaced).toEqual({ "runners.9.name": "?" });
  });
});

describe("moving rows", () => {
  it("moves the row object itself", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const moved = L.moveRow([a, b, c], 2, 0);
    expect(moved).toEqual([c, a, b]);
    expect(moved[0]).toBe(c);
    expect(L.moveRow([a, b, c], 0, -1)).toEqual([a, b, c]);
  });
  it("sorts fastest first, rows with no time last in their order", () => {
    const rows = [{ id: 1, best: "2500" }, { id: 2, best: "" }, { id: 3, best: "1959" }, { id: 4, best: "2" }, { id: 5, best: "2100" }];
    expect(L.sortByBest(rows).map((r) => r.id)).toEqual([3, 5, 1, 2, 4]);
  });
  it("labels legs and reserves", () => {
    expect([0, 4, 5, 6].map(L.legLabel)).toEqual(["1区", "5区", "補欠1", "補欠2"]);
  });
});
