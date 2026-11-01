import { describe, it, expect } from "vitest";
import {
  formatDay, formatDeadline, formatSize, splitDeadline, joinDeadline, initials, safeNext, noticesPath, noticesLinkTo,
  parsePage, mergeQuestions, checkFile, uploadErrorMessage, catLabel, reasonLabel, todayJst,
} from "../../public/lib/format.js";

describe("日本時間の日付", () => {
  it("掲載日を 10月17日(土) の形にする", () => {
    expect(formatDay("2026-10-17T08:30:00+09:00")).toBe("10月17日(土)");
    // 23:30 UTC on the 16th is already the 17th in Tokyo
    expect(formatDay("2026-10-16T23:30:00Z")).toBe("10月17日(土)");
  });
  it("締め切りを 10月24日(土) 17:00まで の形にする", () => {
    expect(formatDeadline("2026-10-24T17:00:00+09:00")).toBe("10月24日(土) 17:00まで");
  });
  it("日付が無ければ空", () => {
    expect(formatDay(null)).toBe("");
    expect(formatDeadline("")).toBe("");
    expect(formatDeadline("not a date")).toBe("");
  });
  it("フォームの日付と時刻の欄に分け、また一つにする", () => {
    expect(splitDeadline("2026-10-24T08:00:00Z")).toEqual({ date: "2026-10-24", time: "17:00" });
    expect(splitDeadline(null)).toEqual({ date: "", time: "" });
    expect(joinDeadline("2026-10-24", "09:30")).toEqual({ value: "2026-10-24T09:30:00+09:00", error: null });
    expect(joinDeadline("2026-10-24", "")).toEqual({ value: "2026-10-24T17:00:00+09:00", error: null });
    expect(joinDeadline("", "")).toEqual({ value: null, error: null });
    expect(joinDeadline("", "09:00").error).toBe("日付も入力してください。");
  });
  it("東京の今日を知っている", () => {
    expect(todayJst(new Date("2026-10-31T16:00:00Z"))).toBe("2026-11-01");
  });
});

describe("ラベルと小さな書式", () => {
  it("区分と理由のラベル", () => {
    expect(catLabel("event")).toBe("行事");
    expect(catLabel("nope")).toBe("");
    expect(reasonLabel("family")).toBe("家庭の事情");
  });
  it("大きさの書式", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(200 * 1024)).toBe("200 KB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatSize(undefined)).toBe("");
  });
  it("頭文字を作る", () => {
    expect(initials("田中 花子")).toBe("田");
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("")).toBe("");
  });
});

describe("URL", () => {
  it("next はアプリの中のときだけ従う", () => {
    expect(safeNext("/notices/3?x=1")).toBe("/notices/3?x=1");
    expect(safeNext("https://evil.example/")).toBe("/notices");
    expect(safeNext("//evil.example/")).toBe("/notices");
    expect(safeNext("/login?next=/x")).toBe("/notices");
    expect(safeNext(undefined)).toBe("/notices");
  });
  it("一覧のパスを正規の形で作る", () => {
    expect(noticesPath({})).toBe("/notices");
    expect(noticesPath({ cat: "event", page: 2 })).toBe("/notices?cat=event&page=2");
    expect(noticesPath({ cat: "", page: 1 })).toBe("/notices");
  });
  it("<wcs-link to> の一覧のパスは、クエリが無ければ ? で終わる（空のクエリ — router 4.11）", () => {
    expect(noticesLinkTo({})).toBe("/notices?");
    expect(noticesLinkTo({ page: 1 })).toBe("/notices?");
    expect(noticesLinkTo({ page: 2 })).toBe("/notices?page=2");
    expect(noticesLinkTo({ cat: "event", page: 1 })).toBe("/notices?cat=event");
  });
  it("クエリのページ番号を読む", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe("質問のマージ（失わず、重ねない）", () => {
  const q = (id, answer = null) => ({ id, from: "a", text: "t" + id, at: "", answer });
  it("GET に無いソケットからの質問は残し、GET にある行は GET が勝つ", () => {
    const local = [q(1), q(3)];
    const server = [q(1, { text: "ok", at: "" }), q(2)];
    const merged = mergeQuestions(local, server);
    expect(merged.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(merged[0].answer).toEqual({ text: "ok", at: "" });
  });
  it("2 回届いた質問を重ねない", () => {
    expect(mergeQuestions([q(1)], [q(1)]).length).toBe(1);
  });
});

describe("添付ファイル", () => {
  it("送る前に大きさと種類を確かめる", () => {
    expect(checkFile({ size: 10, type: "application/pdf" })).toBeNull();
    expect(checkFile({ size: 6 * 1024 * 1024, type: "application/pdf" })).toMatch(/5MB/);
    expect(checkFile({ size: 10, type: "text/plain" })).toMatch(/PDF/);
  });
  it("413 と 415 を説明する", () => {
    expect(uploadErrorMessage(413)).toMatch(/大きすぎ/);
    expect(uploadErrorMessage(415)).toMatch(/種類/);
  });
});
