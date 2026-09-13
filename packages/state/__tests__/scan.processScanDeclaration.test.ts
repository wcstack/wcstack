/**
 * scan.processScanDeclaration.test.ts
 *
 * `$scan` 宣言の検査（docs/state-scan-design.md §1-2）と出力の実体化（D7）。
 * parseScanDeclaration は `value` だけを読む純関数なので、State を介さずに固定する。
 */
import { describe, it, expect } from "vitest";
import { MAX_WILDCARD_DEPTH } from "../src/define";
import { materializeScanOutputs, parseScanDeclaration } from "../src/scan/processScanDeclaration";
import type { IState } from "../src/types";

const NO_TOKENS: ReadonlySet<string> = new Set();
const fold = (acc: unknown): unknown => acc;

function parse(state: object, tokens: ReadonlySet<string> = NO_TOKENS) {
  return parseScanDeclaration(state as unknown as IState, tokens);
}

/** getter を持たない state 用の短縮形 */
function scan(def: unknown, extra: Record<string, unknown> = {}, tokens?: ReadonlySet<string>) {
  return parse({ ...extra, $scan: def }, tokens);
}

describe("$scan 宣言の形", () => {
  it("宣言が無い・空なら null を返すこと", () => {
    expect(parse({ n: 0 })).toBeNull();
    expect(scan({})).toBeNull();
  });

  it.each([1, null, [], "x"])("オブジェクト以外（%j）は raise すること", (value) => {
    expect(() => scan(value)).toThrow(/\[wcs\/scan-declaration-invalid\] \$scan must be an object/);
  });

  it("エントリがオブジェクトでなければ raise すること", () => {
    expect(() => scan({ out: 1 })).toThrow(/\$scan entry "out" must be an object/);
    expect(() => scan({ out: null })).toThrow(/\$scan entry "out" must be an object/);
  });
});

describe("出力名", () => {
  it.each([
    ["", /entry name must be a non-empty string/],
    ["a.b", /must be a flat property name/],
    ["a*", /must be a flat property name/],
    ["$out", /must not start with "\$"/],
    ["constructor", /inherited from Object\.prototype/],
  ])("%j は raise すること", (name, pattern) => {
    expect(() => scan({ [name]: { from: "n", initial: 0, fold } })).toThrow(pattern);
  });

  it("getter / setter / $streams 名と衝突したら raise すること", () => {
    expect(() => parse({
      get total() { return 1; },
      $scan: { total: { from: "n", initial: 0, fold } },
    })).toThrow(/\$scan entry "total" conflicts with a getter/);
    expect(() => parse({
      set total(_v: unknown) { /* noop */ },
      $scan: { total: { from: "n", initial: 0, fold } },
    })).toThrow(/\$scan entry "total" conflicts with a setter/);
    expect(() => scan(
      { feed: { from: "n", initial: 0, fold } },
      { $streams: { feed: { source: () => null } } },
    )).toThrow(/conflicts with the \$streams entry of the same name/);
  });

  it("$streams がオブジェクトでなければ名前の衝突検査はしないこと（形の検査は $streams 側の責務）", () => {
    expect(scan({ feed: { from: "n", initial: 0, fold } }, { $streams: 1 })).toHaveLength(1);
  });
});

describe("source（from / on）", () => {
  it("from と on のどちらも無い・両方あるなら raise すること", () => {
    const tokens = new Set(["tick"]);
    expect(() => scan({ out: { initial: 0, fold } }, {}, tokens)).toThrow(/must declare exactly one of "from"/);
    expect(() => scan({ out: { from: "n", on: "tick", initial: 0, fold } }, {}, tokens)).toThrow(/must declare exactly one of "from"/);
  });

  it("on は宣言済みの event-token 名でなければ raise すること", () => {
    expect(() => scan({ out: { on: 1, initial: 0, fold } })).toThrow(/"on" must be a non-empty event-token name/);
    expect(() => scan({ out: { on: "", initial: 0, fold } })).toThrow(/"on" must be a non-empty event-token name/);
    expect(() => scan({ out: { on: "tikc", initial: 0, fold } }, {}, new Set(["tick"])))
      .toThrow(/on "tikc" is not declared in \$eventTokens\. Did you mean "tick"\?/);
  });

  it("on が宣言済みなら event source になること", () => {
    const entries = scan({ out: { on: "tick", initial: 0, fold } }, {}, new Set(["tick"]));
    expect(entries![0].source).toEqual({ kind: "event", tokenName: "tick" });
  });

  it.each([
    [1, /"from" must be a state path string/],
    ["", /"from" must be a non-empty state path/],
    ["$streamStatus.feed", /from "\$streamStatus\.feed" must not start with "\$"/],
    ["user@other", /must not contain "@"/],
    ["toString", /inherited from Object\.prototype/],
    ["a..b", /has an empty path segment/],
    [`rows${".*".repeat(MAX_WILDCARD_DEPTH + 1)}`, /exceeds the maximum wildcard depth/],
  ])("from %j は raise すること", (from, pattern) => {
    expect(() => scan({ out: { from, initial: 0, fold } })).toThrow(pattern);
  });

  it("from が getter・getter の配下・プロトタイプ上の getter なら wcs/scan-source-computed で raise すること", () => {
    expect(() => parse({
      get src() { return 1; },
      $scan: { out: { from: "src", initial: 0, fold } },
    })).toThrow(/\[wcs\/scan-source-computed\] \$scan entry "out" from "src" is a getter/);
    expect(() => parse({
      get row() { return { x: 1 }; },
      $scan: { out: { from: "row.x", initial: 0, fold } },
    })).toThrow(/from "row\.x" is under the getter "row"/);
    class ClassState {
      get src(): number { return 1; }
      $scan = { out: { from: "src", initial: 0, fold } };
    }
    expect(() => parse(new ClassState())).toThrow(/from "src" is a getter/);
  });

  it("from が自分の出力またはその子孫なら raise すること", () => {
    expect(() => scan({ feed: { from: "feed", initial: 0, fold } })).toThrow(/reads the entry's own output/);
    expect(() => scan({ feed: { from: "feed.items", initial: 0, fold } })).toThrow(/reads the entry's own output/);
  });

  it("wildcard を含む from は受理し、path source になること", () => {
    const entries = scan({ log: { from: "items.*.qty", initial: [], fold } });
    const source = entries![0].source;
    expect(source.kind).toBe("path");
    expect(source.kind === "path" && source.pathInfo.wildcardCount).toBe(1);
  });
});

describe("initial / fold", () => {
  it("initial が無ければ raise し、undefined を明示すれば受理すること", () => {
    expect(() => scan({ out: { from: "n", fold } })).toThrow(/requires "initial"/);
    expect(scan({ out: { from: "n", initial: undefined, fold } })![0].initial).toBeUndefined();
  });

  it("fold が関数でなければ raise すること", () => {
    expect(() => scan({ out: { from: "n", initial: 0 } })).toThrow(/fold must be a function/);
    expect(() => scan({ out: { from: "n", initial: 0, fold: 1 } })).toThrow(/fold must be a function/);
  });
});

describe("resetOn", () => {
  it.each([
    ["host", /"resetOn" must be an array of state paths/],
    [[1], /"resetOn" must contain only state path strings/],
    [[""], /"resetOn" must be a non-empty state path/],
    [["items.*"], /resetOn "items\.\*" must not contain "\*"/],
    [["n"], /resetOn "n" is the entry's own "from"/],
    [["out"], /resetOn "out" reads the \$scan output "out"/],
  ])("resetOn %j は raise すること", (resetOn, pattern) => {
    expect(() => scan({ out: { from: "n", initial: 0, fold, resetOn } })).toThrow(pattern);
  });

  it("resetOn が getter を読むなら wcs/scan-source-computed で raise すること", () => {
    expect(() => parse({
      get host() { return "a"; },
      $scan: { out: { from: "n", initial: 0, fold, resetOn: ["host"] } },
    })).toThrow(/\[wcs\/scan-source-computed\] \$scan entry "out" resetOn "host" is a getter/);
  });

  it("resetOn が他の scan の出力（の子孫）を読むなら raise すること", () => {
    expect(() => scan({
      a: { from: "n", initial: 0, fold },
      b: { from: "m", initial: 0, fold, resetOn: ["a.count"] },
    })).toThrow(/\$scan entry "b" resetOn "a\.count" reads the \$scan output "a"/);
  });

  it("省略時は空配列、指定時はそのパス列になること（on の scan も resetOn を持てる）", () => {
    const entries = scan({
      a: { from: "n", initial: 0, fold },
      b: { on: "tick", initial: 0, fold, resetOn: ["host", "user.id"] },
    }, {}, new Set(["tick"]));
    expect(entries![0].resetOn).toEqual([]);
    expect(entries![1].resetOn).toEqual(["host", "user.id"]);
  });
});

describe("scan 同士の参照", () => {
  it("from の根を辿って循環したら raise すること", () => {
    expect(() => scan({
      a: { from: "b.x", initial: 0, fold },
      b: { from: "a", initial: 0, fold },
    })).toThrow(/\$scan entries "a" → "b" → "a" feed each other through "from"/);
    expect(() => scan({
      a: { from: "b", initial: 0, fold },
      b: { from: "c", initial: 0, fold },
      c: { from: "a", initial: 0, fold },
    })).toThrow(/"a" → "b" → "c" → "a"/);
  });

  it("循環しない連鎖（別 scan の出力を from に取る）は受理すること", () => {
    const entries = scan({
      a: { from: "b.items", initial: 0, fold },
      b: { from: "src", initial: { items: [] }, fold },
    });
    expect(entries!.map((entry) => entry.name)).toEqual(["a", "b"]);
  });

  it("on の scan の出力を from に取る形は辿る先が無いので受理すること", () => {
    const entries = scan({
      a: { from: "b", initial: 0, fold },
      b: { on: "tick", initial: 0, fold },
    }, {}, new Set(["tick"]));
    expect(entries).toHaveLength(2);
  });
});

describe("戻り値", () => {
  it("宣言順の order・fold / initial の参照がそのまま載ること", () => {
    const initial = { items: [] };
    const myFold = (acc: unknown): unknown => acc;
    const entries = scan({
      first: { from: "n", initial, fold: myFold },
      second: { from: "m", initial: 0, fold },
    });
    expect(entries!.map((entry) => entry.order)).toEqual([0, 1]);
    expect(entries![0].initial).toBe(initial);
    expect(entries![0].fold).toBe(myFold);
    expect(entries![0].source).toMatchObject({ kind: "path", path: "n" });
  });
});

describe("materializeScanOutputs（D7）", () => {
  it("未定義の出力は initial で実体化し、既にある値（undefined を含む）は保持すること", () => {
    const initial = { items: [] as unknown[] };
    const state: Record<string, unknown> = { kept: "hydrated", empty: undefined };
    const entries = scan({
      fresh: { from: "n", initial, fold },
      kept: { from: "n", initial: "seed", fold },
      empty: { from: "n", initial: "seed", fold },
    }, state);
    materializeScanOutputs(state as unknown as IState, entries!);
    expect(state.fresh).toBe(initial);
    expect(state.kept).toBe("hydrated");
    expect(state.empty).toBeUndefined();
  });
});
