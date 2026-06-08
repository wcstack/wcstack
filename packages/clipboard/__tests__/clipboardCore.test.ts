import { describe, it, expect, vi, afterEach } from "vitest";
import { ClipboardCore } from "../src/core/ClipboardCore";
import {
  installClipboard, removeClipboard, installPermissions, removePermissions,
  makeClipboardItem, dispatchPaste, mockSelection,
} from "./mocks";

// Flush pending microtasks/macrotasks so the clipboard/permission callbacks
// (resolved on Promise.resolve().then / setTimeout) run before assertions.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ClipboardCore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removeClipboard();
    removePermissions();
  });

  it("EventTargetを継承している", () => {
    removePermissions();
    const core = new ClipboardCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("初期状態は text/items/error が null、loading/monitoring が false", () => {
    removePermissions();
    const core = new ClipboardCore();
    expect(core.text).toBeNull();
    expect(core.items).toBeNull();
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
    expect(core.monitoring).toBe(false);
    expect(core.copied).toBeNull();
    expect(core.cut).toBeNull();
    expect(core.pasted).toBeNull();
  });

  // --- write ---

  it("writeText 成功で loading をトグルし error を出さない", async () => {
    const mock = installClipboard();
    removePermissions();
    const core = new ClipboardCore();

    const loadings: boolean[] = [];
    core.addEventListener("wcs-clipboard:loading-changed", (e) => loadings.push((e as CustomEvent).detail));

    const p = core.writeText("hello");
    expect(core.loading).toBe(true);
    await p;

    expect(mock.writeText).toHaveBeenCalledWith("hello");
    expect(core.loading).toBe(false);
    expect(loadings).toEqual([true, false]);
    expect(core.error).toBeNull();
  });

  it("writeText 失敗で error を正規化して公開する（reject しない）", async () => {
    installClipboard({ writeError: new DOMException("denied", "NotAllowedError") });
    removePermissions();
    const core = new ClipboardCore();

    const errors: any[] = [];
    core.addEventListener("wcs-clipboard:error", (e) => errors.push((e as CustomEvent).detail));

    await expect(core.writeText("x")).resolves.toBeUndefined();
    expect(core.loading).toBe(false);
    expect(core.error).toEqual({ name: "NotAllowedError", message: "denied" });
    expect(errors).toEqual([{ name: "NotAllowedError", message: "denied" }]);
  });

  it("write（リッチ）成功で ClipboardItem を渡す", async () => {
    const mock = installClipboard();
    removePermissions();
    const core = new ClipboardCore();

    const item = makeClipboardItem({ "text/plain": "hi" });
    await core.write([item]);
    expect(mock.write).toHaveBeenCalledWith([item]);
    expect(core.error).toBeNull();
  });

  it("Error でない reject 値も error に正規化する", async () => {
    installClipboard({ writeError: "boom" });
    removePermissions();
    const core = new ClipboardCore();

    await core.writeText("x");
    expect(core.error).toEqual({ name: "Error", message: "boom" });
  });

  it("clipboard 非対応環境では writeText が unsupported エラーを出す", async () => {
    removeClipboard();
    removePermissions();
    const core = new ClipboardCore();

    await core.writeText("x");
    expect(core.error).toEqual({
      name: "NotSupportedError",
      message: "Clipboard API is not available in this environment.",
    });
    expect(core.loading).toBe(false);
  });

  // --- read ---

  it("readText 成功で text を公開し read イベントを出す（items は null）", async () => {
    installClipboard({ readText: "pasted text" });
    removePermissions();
    const core = new ClipboardCore();

    let detail: any = null;
    core.addEventListener("wcs-clipboard:read", (e) => { detail = (e as CustomEvent).detail; });

    await core.readText();
    expect(core.text).toBe("pasted text");
    expect(core.items).toBeNull();
    expect(detail).toEqual({ text: "pasted text", items: null });
  });

  it("read イベントから派生 getter（text/items）を取り出す", async () => {
    installClipboard({ readText: "abc" });
    removePermissions();
    const core = new ClipboardCore();

    const textProp = ClipboardCore.wcBindable.properties.find((p) => p.name === "text")!;
    const itemsProp = ClipboardCore.wcBindable.properties.find((p) => p.name === "items")!;
    let captured: Event | null = null;
    core.addEventListener("wcs-clipboard:read", (e) => { captured = e; });

    await core.readText();
    expect(textProp.getter!(captured!)).toBe("abc");
    expect(itemsProp.getter!(captured!)).toBeNull();
  });

  it("read（リッチ）は items を正規化し text/plain を text に出す", async () => {
    const item = makeClipboardItem({ "text/plain": "plain!", "text/html": "<b>x</b>" });
    installClipboard({ readItems: [item] });
    removePermissions();
    const core = new ClipboardCore();

    await core.read();
    expect(core.text).toBe("plain!");
    expect(core.items).toHaveLength(1);
    expect(core.items![0].types).toEqual(["text/plain", "text/html"]);
    expect(core.items![0].data["text/plain"]).toBeDefined();
    expect(core.items![0].data["text/html"]).toBeDefined();
  });

  it("read は後続 item の text/plain も拾う（1件目 image、2件目 text/plain）", async () => {
    const imageItem = makeClipboardItem({ "image/png": "binary" });
    const textItem = makeClipboardItem({ "text/plain": "from 2nd" });
    installClipboard({ readItems: [imageItem, textItem] });
    removePermissions();
    const core = new ClipboardCore();

    await core.read();
    // 1件目に text/plain は無いので、2件目から text を拾う
    expect(core.text).toBe("from 2nd");
    expect(core.items).toHaveLength(2);
    expect(core.items![0].types).toEqual(["image/png"]);
    expect(core.items![1].types).toEqual(["text/plain"]);
  });

  it("read は最初の text/plain だけを text に採用する（後続 item は上書きしない）", async () => {
    const first = makeClipboardItem({ "text/plain": "first" });
    const second = makeClipboardItem({ "text/plain": "second" });
    installClipboard({ readItems: [first, second] });
    removePermissions();
    const core = new ClipboardCore();

    await core.read();
    // 1件目で text が確定するので、2件目の text/plain は無視される（text === null ガード）
    expect(core.text).toBe("first");
    expect(core.items).toHaveLength(2);
  });

  it("read で text/plain が無ければ text は null", async () => {
    const item = makeClipboardItem({ "image/png": "binary" });
    installClipboard({ readItems: [item] });
    removePermissions();
    const core = new ClipboardCore();

    await core.read();
    expect(core.text).toBeNull();
    expect(core.items![0].types).toEqual(["image/png"]);
  });

  it("read 失敗で error を公開する", async () => {
    installClipboard({ readError: new DOMException("no focus", "NotAllowedError") });
    removePermissions();
    const core = new ClipboardCore();

    await core.read();
    expect(core.error).toEqual({ name: "NotAllowedError", message: "no focus" });
    expect(core.loading).toBe(false);
  });

  // --- generation guard / loading ---

  it("dispose 後に解決した write は状態を更新しない（世代ガード）", async () => {
    installClipboard();
    removePermissions();
    const core = new ClipboardCore();

    const loadings: boolean[] = [];
    core.addEventListener("wcs-clipboard:loading-changed", (e) => loadings.push((e as CustomEvent).detail));

    const p = core.writeText("x"); // 保留（resolve は microtask）
    core.dispose();                // 解決前に dispose → 世代を無効化
    await p;

    // dispose のサイレントリセットで true→（dispatch 無し）false。stale なので
    // resolve 側でも何も出さない。
    expect(loadings).toEqual([true]);
    expect(core.loading).toBe(false);
    await expect(p).resolves.toBeUndefined();
  });

  it("dispose 後に解決した read は text を更新しない（世代ガード）", async () => {
    installClipboard({ readText: "late" });
    removePermissions();
    const core = new ClipboardCore();

    const reads: any[] = [];
    core.addEventListener("wcs-clipboard:read", () => reads.push("read"));

    const p = core.readText();
    core.dispose();
    await p;

    expect(reads).toEqual([]);
    expect(core.text).toBeNull();
  });

  it("dispose 後に解決した read（失敗）も error を更新しない", async () => {
    installClipboard({ readError: new Error("late fail") });
    removePermissions();
    const core = new ClipboardCore();

    const errors: any[] = [];
    core.addEventListener("wcs-clipboard:error", (e) => errors.push((e as CustomEvent).detail));

    const p = core.readText();
    core.dispose();
    await p;

    expect(errors).toEqual([]);
    expect(core.error).toBeNull();
  });

  it("dispose は進行中の loading をサイレントにリセットする（再接続後の true エッジを潰さない）", async () => {
    installClipboard();
    removePermissions();
    const core = new ClipboardCore();

    const loadings: boolean[] = [];
    core.addEventListener("wcs-clipboard:loading-changed", (e) => loadings.push((e as CustomEvent).detail));

    const p1 = core.writeText("a");
    expect(core.loading).toBe(true);
    core.dispose();
    expect(core.loading).toBe(false);
    await p1;

    const p2 = core.writeText("b");
    await p2;
    // 1回目: true（dispose は無音）。2回目: true,false。
    expect(loadings).toEqual([true, true, false]);
  });

  it("取得中に再度コマンドしても loading は二重トグルしない", async () => {
    installClipboard({ readText: "x" });
    removePermissions();
    const core = new ClipboardCore();

    const loadings: boolean[] = [];
    core.addEventListener("wcs-clipboard:loading-changed", (e) => loadings.push((e as CustomEvent).detail));

    const p1 = core.readText();
    const p2 = core.readText(); // 既に loading=true → 同値で何も出さない
    expect(core.loading).toBe(true);
    await Promise.all([p1, p2]);

    expect(loadings).toEqual([true, false]);
  });

  it("成功時の _setError(null) は初期 null と同値なら重複発火しない（同値ガード）", async () => {
    installClipboard();
    removePermissions();
    const core = new ClipboardCore();

    const errors: any[] = [];
    core.addEventListener("wcs-clipboard:error", (e) => errors.push((e as CustomEvent).detail));

    await core.writeText("a");
    await core.writeText("b");
    expect(errors).toEqual([]);
  });

  // --- permissions ---

  it("read/write permission を Permissions API から取得し change を購読する", async () => {
    removeClipboard();
    const status = installPermissions({ state: "granted" });
    const core = new ClipboardCore();

    const reads: string[] = [];
    const writes: string[] = [];
    core.addEventListener("wcs-clipboard:read-permission-changed", (e) => reads.push((e as CustomEvent).detail));
    core.addEventListener("wcs-clipboard:write-permission-changed", (e) => writes.push((e as CustomEvent).detail));

    await flush();
    expect(core.readPermission).toBe("granted");
    expect(core.writePermission).toBe("granted");

    // 同一 status を両クエリが共有するので change は両方に届く
    status.change("denied");
    expect(core.readPermission).toBe("denied");
    expect(core.writePermission).toBe("denied");
    expect(reads).toEqual(["granted", "denied"]);
    expect(writes).toEqual(["granted", "denied"]);
  });

  it("clipboard-read と clipboard-write を正しい permission に配線している（名前取り違え検出）", async () => {
    removeClipboard();
    // name ごとに別 status を返すモック。read/write を取り違えていると検出できる。
    const perm = installPermissions({ state: "prompt", byName: true });
    const core = new ClipboardCore();
    await flush();

    const reads: string[] = [];
    const writes: string[] = [];
    core.addEventListener("wcs-clipboard:read-permission-changed", (e) => reads.push((e as CustomEvent).detail));
    core.addEventListener("wcs-clipboard:write-permission-changed", (e) => writes.push((e as CustomEvent).detail));

    // clipboard-read の change だけが readPermission を動かし、writePermission は動かない
    perm.readStatus.change("granted");
    expect(core.readPermission).toBe("granted");
    expect(core.writePermission).toBe("prompt");
    expect(reads).toEqual(["granted"]);
    expect(writes).toEqual([]);

    // clipboard-write の change だけが writePermission を動かし、readPermission は据え置き
    perm.writeStatus.change("denied");
    expect(core.writePermission).toBe("denied");
    expect(core.readPermission).toBe("granted");
    expect(writes).toEqual(["denied"]);
    expect(reads).toEqual(["granted"]);
  });

  it("Permissions API 非対応なら read/write permission は unsupported", async () => {
    removeClipboard();
    removePermissions();
    const core = new ClipboardCore();
    await flush();
    expect(core.readPermission).toBe("unsupported");
    expect(core.writePermission).toBe("unsupported");
  });

  it("permissions.query が関数でない場合も unsupported", async () => {
    removeClipboard();
    Object.defineProperty(navigator, "permissions", {
      value: {}, configurable: true, writable: true,
    });
    const core = new ClipboardCore();
    await flush();
    expect(core.readPermission).toBe("unsupported");
    expect(core.writePermission).toBe("unsupported");
  });

  it("permissions.query が reject した場合は unsupported に落とす", async () => {
    removeClipboard();
    installPermissions({ reject: true });
    const core = new ClipboardCore();
    await flush();
    expect(core.readPermission).toBe("unsupported");
    expect(core.writePermission).toBe("unsupported");
  });

  it("granted 観測後に Permissions API を失った状態で reinit すると unsupported 遷移を通知する", async () => {
    removeClipboard();
    installPermissions({ state: "granted" });
    const core = new ClipboardCore();
    await flush();
    expect(core.readPermission).toBe("granted");

    const states: string[] = [];
    core.addEventListener("wcs-clipboard:read-permission-changed", (e) => states.push((e as CustomEvent).detail));

    core.dispose();
    removePermissions();
    core.reinitPermission();

    expect(core.readPermission).toBe("unsupported");
    expect(states).toEqual(["unsupported"]);
  });

  it("reinitPermission は dispose 後に change 購読を張り直す（再接続相当）", async () => {
    removeClipboard();
    const status = installPermissions({ state: "prompt" });
    const core = new ClipboardCore();
    await flush();
    expect(core.readPermission).toBe("prompt");

    core.dispose();
    core.reinitPermission();
    await flush();

    status.change("granted");
    expect(core.readPermission).toBe("granted");
  });

  it("reinitPermission は購読が生きている間は二重購読しない（初回接続相当）", async () => {
    removeClipboard();
    const status = installPermissions({ state: "prompt" });
    const core = new ClipboardCore();
    await flush();

    const states: string[] = [];
    core.addEventListener("wcs-clipboard:read-permission-changed", (e) => states.push((e as CustomEvent).detail));

    core.reinitPermission(); // 既に購読済み → no-op
    await flush();
    status.change("denied");
    expect(states).toEqual(["denied"]);
  });

  it("購読確立前に dispose されたら change を購読しない", async () => {
    removeClipboard();
    const status = installPermissions({ state: "granted" });
    const core = new ClipboardCore();
    core.dispose(); // query 解決前に dispose
    await flush();

    expect(core.readPermission).toBe("prompt");
    status.change("denied");
    expect(core.readPermission).toBe("prompt");
  });

  it("query 解決前の同期 reparent でも最新の query だけを購読する（世代ガード）", async () => {
    removeClipboard();
    const perm = installPermissions({ state: "prompt", distinctPerQuery: true });

    const core = new ClipboardCore(); // round#1: read=statuses[0], write=statuses[1]（保留）
    core.dispose();
    core.reinitPermission();          // round#2: read=statuses[2], write=statuses[3]（保留）
    await flush();

    // 古い round#1 の read status の change は購読されておらず無視される
    perm.statuses[0].change("denied");
    expect(core.readPermission).toBe("prompt");
    // 最新 round#2 の read status のみ追跡する
    perm.statuses[2].change("granted");
    expect(core.readPermission).toBe("granted");
  });

  it("query が reject しても stale（dispose 済み世代）なら unsupported にしない", async () => {
    removeClipboard();
    installPermissions({ reject: true });
    const core = new ClipboardCore();
    core.dispose();
    await flush();
    expect(core.readPermission).toBe("prompt");
  });

  it("dispose で permission change の購読を解除する", async () => {
    removeClipboard();
    const status = installPermissions({ state: "prompt" });
    const core = new ClipboardCore();
    await flush();

    core.dispose();
    status.change("granted");
    expect(core.readPermission).toBe("prompt");
    expect(core.writePermission).toBe("prompt");

    // 購読が無い状態での dispose も安全
    core.dispose();
  });

  // --- monitor ---

  it("startMonitor で copy/cut/paste を購読し copied/cut/pasted を公開する", () => {
    removePermissions();
    const core = new ClipboardCore();

    const monitorings: boolean[] = [];
    core.addEventListener("wcs-clipboard:monitoring-changed", (e) => monitorings.push((e as CustomEvent).detail));

    core.startMonitor();
    expect(core.monitoring).toBe(true);
    expect(monitorings).toEqual([true]);

    mockSelection("selected text");
    document.dispatchEvent(new Event("copy", { bubbles: true }));
    expect(core.copied).toBe("selected text");

    document.dispatchEvent(new Event("cut", { bubbles: true }));
    expect(core.cut).toBe("selected text");

    dispatchPaste("pasted text");
    expect(core.pasted).toBe("pasted text");
  });

  it("選択が無い copy では copied は空文字", () => {
    removePermissions();
    const core = new ClipboardCore();
    core.startMonitor();

    mockSelection(null);
    document.dispatchEvent(new Event("copy", { bubbles: true }));
    expect(core.copied).toBe("");
  });

  it("clipboardData が無い paste では pasted は空文字", () => {
    removePermissions();
    const core = new ClipboardCore();
    core.startMonitor();

    dispatchPaste(null);
    expect(core.pasted).toBe("");
  });

  it("startMonitor は冪等（二重購読しない）", () => {
    removePermissions();
    const core = new ClipboardCore();
    const spy = vi.spyOn(document, "addEventListener");

    core.startMonitor();
    core.startMonitor();
    // copy/cut/paste の3リスナーが1度だけ張られる
    const monitorCalls = spy.mock.calls.filter(([t]) => t === "copy" || t === "cut" || t === "paste");
    expect(monitorCalls).toHaveLength(3);
  });

  it("stopMonitor でリスナーを解除し monitoring を false にする", () => {
    removePermissions();
    const core = new ClipboardCore();
    core.startMonitor();
    core.stopMonitor();
    expect(core.monitoring).toBe(false);

    // 解除後の paste は反映されない
    dispatchPaste("after stop");
    expect(core.pasted).toBeNull();
  });

  it("dispose は monitor リスナーも解除する", () => {
    removePermissions();
    const core = new ClipboardCore();
    core.startMonitor();
    core.dispose();
    expect(core.monitoring).toBe(false);

    dispatchPaste("after dispose");
    expect(core.pasted).toBeNull();
  });

  // --- target / wcBindable ---

  it("target を渡すとそのターゲットにイベントを発火する", async () => {
    installClipboard({ readText: "T" });
    removePermissions();
    const target = new EventTarget();
    const core = new ClipboardCore(target);

    const texts: string[] = [];
    target.addEventListener("wcs-clipboard:read", (e) => texts.push((e as CustomEvent).detail.text));

    await core.readText();
    expect(texts).toEqual(["T"]);
  });

  it("wcBindable にプロパティとコマンドが宣言されている", () => {
    const props = ClipboardCore.wcBindable.properties.map((p) => p.name);
    expect(props).toEqual([
      "text", "items", "loading", "error",
      "readPermission", "writePermission",
      "monitoring", "copied", "cut", "pasted",
    ]);
    const commands = (ClipboardCore.wcBindable.commands ?? []).map((c) => c.name);
    expect(commands).toEqual([
      "writeText", "write", "readText", "read", "startMonitor", "stopMonitor",
    ]);

    // 派生 getter は同一 read イベントから取り出す
    const ev = new CustomEvent("wcs-clipboard:read", { detail: { text: "t", items: null } });
    const get = (name: string) => ClipboardCore.wcBindable.properties.find((p) => p.name === name)!.getter!;
    expect(get("text")(ev)).toBe("t");
    expect(get("items")(ev)).toBeNull();

    const cev = new CustomEvent("wcs-clipboard:copied", { detail: "c" });
    expect(get("copied")(cev)).toBe("c");
    expect(get("cut")(new CustomEvent("wcs-clipboard:cut", { detail: "x" }))).toBe("x");
    expect(get("pasted")(new CustomEvent("wcs-clipboard:pasted", { detail: "p" }))).toBe("p");
  });
});
