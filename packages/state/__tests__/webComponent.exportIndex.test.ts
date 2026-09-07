/**
 * webComponent/exportIndex.ts の単体テスト（docs/state-overlay-export-design.md）。
 * 統合の振る舞いは integration.mountExport.test.ts。ここは索引・インスタンス解決・
 * 通知・衝突 warn の分岐を、偽の親 state element と手組みの記録で 1 つずつ踏む。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPathInfo } from "../src/address/PathInfo";
import { buildMountRecord, IExportEntry, IMountRecord } from "../src/webComponent/mount";
import {
  _setExportRefForTesting,
  clearExportShadowReportsForTesting,
  notifyExports,
  registerExports,
  resolveExport,
  warnShadowedExports,
} from "../src/webComponent/exportIndex";
import { checkDeclaredPath, flushDeferredPathReports, markExportedPath } from "../src/pathDiagnostics";
import { setLoopContextByNode } from "../src/list/loopContextByNode";
import { createListIndex } from "../src/list/createListIndex";
import { setLoopContextSymbol } from "../src/proxy/symbols";

function fakeParent(readValue: (path: string) => unknown = () => undefined) {
  const dynamic = new Map<string, string[]>();
  const posted: string[] = [];
  const parent = {
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    dynamicDependency: dynamic,
    addDynamicDependency(from: string, to: string): boolean {
      const list = dynamic.get(from) ?? [];
      list.push(to);
      dynamic.set(from, list);
      return true;
    },
    hasMounts: false,
    markHasMounts() { this.hasMounts = true; },
    createState(_m: string, cb: (state: any) => void) {
      const state = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_ctx: unknown, fn: () => void) => fn();
          if (prop === "$postUpdate") return (path: string) => { posted.push(path); };
          return readValue(String(prop));
        },
      });
      cb(state);
    },
    posted,
  };
  return parent;
}

function hostBinding(outer: string) {
  return { propSegments: ["state"], statePathInfo: getPathInfo(outer) } as any;
}

function record(parent: any, stateObject: Record<string, any>, outer = "user", tag = "x-comp", partialOnly = false): IMountRecord {
  const component = document.createElement(tag);
  const bindings = partialOnly
    ? [{ propSegments: ["state", "sub"], statePathInfo: getPathInfo(outer) } as any]
    : [hostBinding(outer)];
  return buildMountRecord(component, "state", bindings, parent, stateObject);
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clearExportShadowReportsForTesting();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("registerExports", () => {
  it("getter / setter を公開パスで索引に載せ、エイリアス辺を張り、hasMounts を立てること", () => {
    const parent = fakeParent();
    const r = record(parent, { get display() { return 1; }, set upper(_v: unknown) {}, editing: false, save() {} });
    registerExports(r);
    expect([...r.exports.keys()].sort()).toEqual(["user.display", "user.upper"]);
    expect(r.exports.get("user.display")).toEqual({
      markerTerminalPath: `user.${r.marker}`, suffix: "display", markerPath: `user.${r.marker}.display`, exportedPath: "user.display",
    });
    expect(parent.dynamicDependency.get(`user.${r.marker}.display`)).toEqual(["user.display"]);
    expect(parent.hasMounts).toBe(true);
  });

  it("冪等であること（2 回目は何もしない）・ルートエントリの無い部分マウントは公開しないこと", () => {
    const parent = fakeParent();
    const r = record(parent, { get display() { return 1; } });
    registerExports(r);
    registerExports(r);
    expect(parent.dynamicDependency.get(`user.${r.marker}.display`)).toEqual(["user.display"]);
    const partial = record(parent, { get display() { return 1; } }, "user", "x-partial", true);
    registerExports(partial);
    expect(partial.exports.size).toBe(0);
  });

  it("翻訳できないアクセサ（ワイルドカード終端）と `$` アクセサは公開しないこと", () => {
    const parent = fakeParent();
    const r = record(parent, { get "tags.*"() { return 1; }, get $meta() { return 1; }, get ok() { return 1; } });
    registerExports(r);
    expect([...r.exports.keys()]).toEqual(["user.ok"]);
  });
});

describe("resolveExport", () => {
  it("索引に無ければ null、接続前の要素は候補にならず、接続後に一致し、2 回目は検証付きキャッシュを通ること", () => {
    const parent = fakeParent();
    expect(resolveExport(parent as any, "user", "display", null)).toBeNull();
    const r = record(parent, { get display() { return 1; } });
    registerExports(r);
    expect(resolveExport(parent as any, "user", "display", null)).toBeNull(); // 未接続
    document.body.appendChild(r.component);
    expect(resolveExport(parent as any, "user", "display", null)?.record).toBe(r);
    expect(resolveExport(parent as any, "user", "display", null)?.record).toBe(r); // キャッシュ命中
    r.component.remove();
    expect(resolveExport(parent as any, "user", "display", null)).toBeNull(); // キャッシュは検証で外れる
    document.body.appendChild(r.component);
    expect(resolveExport(parent as any, "user", "display", null)?.record).toBe(r);
  });

  it("行マウントはループ文脈の listIndex（と配下の文脈）で一致し、別の行には答えないこと", () => {
    const parent = fakeParent();
    const r = record(parent, { get display() { return 1; } }, "users.*");
    registerExports(r);
    document.body.appendChild(r.component);
    const row0 = createListIndex(null, 0);
    const row1 = createListIndex(null, 1);
    const inner = createListIndex(row0, 0);
    setLoopContextByNode(r.component, { pathInfo: getPathInfo("users.*"), listIndex: row0 } as any);
    expect(resolveExport(parent as any, "users.*", "display", row0)?.record).toBe(r);
    expect(resolveExport(parent as any, "users.*", "display", row0)?.record).toBe(r); // 行キャッシュ
    expect(resolveExport(parent as any, "users.*", "display", row1)).toBeNull();
    expect(resolveExport(parent as any, "users.*", "display", null)).toBeNull();
    // 要素がより深い文脈（内側の行）にいても、その祖先の行として一致する
    setLoopContextByNode(r.component, { pathInfo: getPathInfo("users.*.items.*"), listIndex: inner } as any);
    expect(resolveExport(parent as any, "users.*", "display", row0)?.record).toBe(r);
    r.component.remove();
  });

  it("回収済み記録（deref が undefined）は索引から遅延 prune されること", () => {
    const parent = fakeParent();
    const entry: IExportEntry = { markerTerminalPath: "user.#m0", suffix: "display", markerPath: "user.#m0.display", exportedPath: "user.display" };
    _setExportRefForTesting(parent as any, "user", "display", { deref: () => undefined } as unknown as WeakRef<IMountRecord>, entry);
    expect(resolveExport(parent as any, "user", "display", null)).toBeNull();
    // 死んだキャッシュ（deref が undefined）も検証で外れる
    const r = record(parent, { get display() { return 1; } });
    registerExports(r);
    document.body.appendChild(r.component);
    expect(resolveExport(parent as any, "user", "display", null)?.record).toBe(r);
    r.component.remove();
  });

  it("同一インスタンスに同名 getter の記録が 2 つあれば raise すること", () => {
    const parent = fakeParent();
    const a = record(parent, { get display() { return 1; } }, "user", "x-a");
    const b = record(parent, { get display() { return 2; } }, "user", "x-b");
    registerExports(a);
    registerExports(b);
    document.body.appendChild(a.component);
    document.body.appendChild(b.component);
    expect(() => resolveExport(parent as any, "user", "display", null)).toThrow(/mount-export-ambiguous.*<x-a>.*<x-b>/);
    a.component.remove();
    b.component.remove();
  });
});

describe("notifyExports / warnShadowedExports", () => {
  it("インスタンス階数の公開パスだけ $postUpdate し、createState の例外は隔離すること", () => {
    const parent = fakeParent();
    const r = record(parent, { get display() { return 1; }, get "items.*.label"() { return 1; } });
    registerExports(r);
    notifyExports(r);
    expect(parent.posted).toEqual(["user.display"]);
    const throwing = fakeParent();
    const t = record(throwing, { get display() { return 1; } });
    registerExports(t);
    throwing.createState = () => { throw new Error("no list index"); };
    expect(() => notifyExports(t)).not.toThrow();
  });

  it("ツリーに同名キーがあるときだけ warn し、同じ (タグ, パス) は 1 回、行マウントで文脈が無ければ黙ること", () => {
    const parent = fakeParent((path) => (path === "user" ? { display: "tree" } : undefined));
    const r = record(parent, { get display() { return 1; }, get other() { return 2; } });
    registerExports(r);
    warnShadowedExports(r);
    warnShadowedExports(r);
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes("[wcs/mount-export-shadowed]"))).toHaveLength(1);
    expect(messages[0]).toContain('"user.display"');

    const primitiveParent = fakeParent(() => "not-an-object");
    const p = record(primitiveParent, { get display() { return 1; } });
    registerExports(p);
    warnShadowedExports(p);
    const rowParent = fakeParent(() => ({ display: "tree" }));
    const row = record(rowParent, { get display() { return 1; } }, "users.*");
    registerExports(row);
    warnShadowedExports(row); // ループ文脈なし → 黙る
    expect(warnSpy.mock.calls.length).toBe(1);
  });
});

describe("pathDiagnostics × 公開パス", () => {
  it("公開済みのパスへのバインドは検査で黙り、遅延中の報告は登録で消えること", () => {
    const parent = fakeParent();
    markExportedPath(parent as any, "user.display");
    checkDeclaredPath(parent as any, { user: { name: "x" } }, "user.display", "binding");
    checkDeclaredPath(parent as any, { user: { name: "x" } }, "user.upper", "binding");
    markExportedPath(parent as any, "user.upper");
    flushDeferredPathReports(parent as any);
    flushDeferredPathReports(parent as any); // pending 無し
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
