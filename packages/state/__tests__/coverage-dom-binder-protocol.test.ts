/**
 * coverage-dom-binder-protocol.test.ts — the inserter's side of the binder protocol
 * (src/protocol/binder.ts, docs/binder-protocol-design.md): what @wcstack/router calls when it
 * inserts route content. No `<wcs-state>` here: the binder on the global slot is a fake.
 */
import { describe, it, expect, afterEach } from "vitest";
import { BINDER_KEY, bindSubtree, flushPendingBinds, getBinder, wasBoundBy } from "../src/protocol/binder";

const PENDING_KEY = Symbol.for("wcstack.binder.pending");
const TAKEN_KEY = Symbol.for("wcstack.binder.taken");
const slot = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete slot[BINDER_KEY];
  delete slot[PENDING_KEY];
  delete slot[TAKEN_KEY];
  document.head.querySelectorAll("title, meta").forEach((node) => node.remove());
  document.body.innerHTML = "";
});

/** A binder that records what it was handed. */
function fakeBinder() {
  const bound: Node[] = [];
  const binder = { protocol: "wcs-binder" as const, version: 1, bind: (n: Node) => { bound.push(n); } };
  slot[BINDER_KEY] = binder;
  return { binder, bound };
}

describe("getBinder（プロトコルの場所の検証）", () => {
  it("正しい binder を返し、キーの名前は Symbol.for で共有される", () => {
    const { binder } = fakeBinder();
    expect(BINDER_KEY).toBe(Symbol.for("wcstack.binder"));
    expect(getBinder()).toBe(binder);
  });

  it.each([
    ["何も無い", undefined],
    ["null", null],
    ["protocol が違う", { protocol: "wcs-transition-runner", version: 1, bind() {} }],
    ["version が数でない", { protocol: "wcs-binder", version: "1", bind() {} }],
    ["version が 1 未満", { protocol: "wcs-binder", version: 0, bind() {} }],
    ["bind が関数でない", { protocol: "wcs-binder", version: 1, bind: "x" }],
  ])("%s ときは null（使える binder は無い）", (_name, value) => {
    slot[BINDER_KEY] = value;
    expect(getBinder()).toBeNull();
  });

  it("将来の版（version 2）も受け入れる", () => {
    const binder = { protocol: "wcs-binder", version: 2, bind() {} };
    slot[BINDER_KEY] = binder;
    expect(getBinder()).toBe(binder);
  });
});

describe("bindSubtree / wasBoundBy / flushPendingBinds", () => {
  it("binder があれば同期に渡して true を返し、渡したものは wasBoundBy で分かる", () => {
    const { bound } = fakeBinder();
    const a = document.createElement("section");
    const b = document.createElement("section");
    expect(bindSubtree(a)).toBe(true);
    expect(bound).toEqual([a]);
    expect(wasBoundBy(a)).toBe(true);
    expect(wasBoundBy(b)).toBe(false);
  });

  it("binder がまだ無ければ保留して false を返し、後から来た binder が flush で順に受け取る", () => {
    const a = document.createElement("title");
    const b = document.createElement("meta");
    // (the queue holds what is in the document: the router offers what it has placed)
    document.head.append(a, b);
    expect(bindSubtree(a)).toBe(false);
    expect(bindSubtree(b)).toBe(false);
    expect(wasBoundBy(a)).toBe(false);
    expect(slot[PENDING_KEY]).toEqual([a, b]);
    // no binder yet: flushing keeps the queue
    flushPendingBinds();
    expect(slot[PENDING_KEY]).toEqual([a, b]);
    const { bound } = fakeBinder();
    flushPendingBinds();
    expect(bound).toEqual([a, b]);
    expect(slot[PENDING_KEY]).toEqual([]);
    expect([wasBoundBy(a), wasBoundBy(b)]).toEqual([true, true]);
    // nothing pending: a second flush hands nothing over
    flushPendingBinds();
    expect(bound).toEqual([a, b]);
  });

  it("保留キューは別コピーと共有するグローバルの場所にあり、既にあればそれに積む", () => {
    const earlier = document.createElement("div");
    slot[PENDING_KEY] = [earlier];
    const mine = document.createElement("div");
    document.body.append(earlier, mine);
    bindSubtree(mine);
    expect(slot[PENDING_KEY]).toEqual([earlier, mine]);
  });

  it("保留キューは同じ部分木を 1 回だけ持ち、文書から外れたものは次に積むときに捨てる（docs/formal-methods-study.md §8）", () => {
    const shown = document.createElement("div");
    const hidden = document.createElement("div");
    document.body.append(shown, hidden);
    bindSubtree(shown);
    bindSubtree(hidden);
    bindSubtree(shown);
    expect(slot[PENDING_KEY]).toEqual([shown, hidden]);
    hidden.remove();
    bindSubtree(shown);
    expect(slot[PENDING_KEY]).toEqual([shown]);
  });

  it("後から来た binder には、積んだ後に文書から外れたものを渡さない", () => {
    const shown = document.createElement("div");
    const hidden = document.createElement("div");
    document.body.append(shown, hidden);
    bindSubtree(shown);
    bindSubtree(hidden);
    hidden.remove();
    const { bound } = fakeBinder();
    flushPendingBinds();
    expect(bound).toEqual([shown]);
    expect(wasBoundBy(hidden)).toBe(false);
    expect(slot[PENDING_KEY]).toEqual([]);
  });
});
