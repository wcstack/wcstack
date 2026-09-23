/**
 * webComponent/dollarPathApis.ts の番人 — 「パスを取る `$` API を chroot の**片方だけ**に
 * 足さない」（docs/state-mount-design.md §4-6）。
 *
 * 3.0 の鍵付き選択（`$eq` / `$eqPath` / `$eqIndex`）と `$dependOn` は、`proxy/traps/get.ts` に
 * 足されたときスコープの chroot（ボリュームの `createVolumeChroot`・コンポーネントの
 * `OverlayValueHandler` と `createPublicMountState`）へ伝わらず、スコープの中で**ルートの**
 * パスを読んでいた（診断も出ないまま `false` を返すか、作者が書いていないパスを名指しして
 * throw していた）。型では防げないので、`get` トラップの `$` API の一覧と、chroot が引く表の
 * 対応を機械的に突き合わせる。
 *
 * 新しい `$` API を足したときは、この 3 つのどれかに入れること:
 * - `PATH_ARGS_BY_DOLLAR_API`（パスだけを取る読み — chroot が共通の表で翻訳する）
 * - `INDEX_COMPOSING_APIS`（indexes も取る / 書き込みもある — 各 chroot が個別に包む）
 * - `NO_PATH_APIS`（パスを取らない。**理由を書くこと**）
 */
import { describe, it, expect } from "vitest";
import { readSourceFile } from "./helpers/sourceScan";
import { PATH_ARGS_BY_DOLLAR_API, createDollarPathApiWrapper } from "../src/webComponent/dollarPathApis";

/** indexes の接頭辞合成（composeMountIndexes）と `#ro` の検査が要るので、各 chroot が個別に包む */
const INDEX_COMPOSING_APIS = new Set(["$getAll", "$setAll", "$resolve", "$postUpdate"]);

/** パスを取らない `$` API（理由つき） */
const NO_PATH_APIS: Record<string, string> = {
  $stateElement: "引数を取らない（state 要素そのものを返す）",
  $untracked: "コールバックを取る（パスではない）",
  $untrackDependency: "$untracked の 3.x エイリアス — 同じくコールバック",
};

/** `proxy/traps/get.ts` の `case "$…":` を拾う（`case STATE_COMMAND_NAMESPACE_NAME:` ＝ `$command` は引数を取らない） */
function dollarCasesInGetTrap(): string[] {
  const source = readSourceFile("proxy/traps/get.ts");
  return [...new Set([...source.matchAll(/case\s+"(\$[A-Za-z0-9_]+)"\s*:/g)].map((m) => m[1]))].sort();
}

describe("dollarPathApis: get トラップの $ API が 3 つの区分のどれかに入っていること", () => {
  it("未分類の $ API が無いこと（足したら chroot の翻訳も決めること）", () => {
    const unclassified = dollarCasesInGetTrap().filter(
      (name) => !PATH_ARGS_BY_DOLLAR_API.has(name) && !INDEX_COMPOSING_APIS.has(name) && !(name in NO_PATH_APIS),
    );
    expect(unclassified).toEqual([]);
  });

  it("表に載っている API が実際に get トラップにあること（綴り違い・撤去の検出）", () => {
    const cases = new Set(dollarCasesInGetTrap());
    for (const name of PATH_ARGS_BY_DOLLAR_API.keys()) {
      expect(cases.has(name), `${name} が proxy/traps/get.ts に無い`).toBe(true);
    }
  });

  it("パス引数の位置が get トラップの引数規約と一致すること", () => {
    // `$eq(path, key)` / `$eqPath(path, keyPath)` / `$eqIndex(path, level?)` / `$dependOn(path)`
    expect([...PATH_ARGS_BY_DOLLAR_API].map(([name, args]) => [name, [...args]])).toEqual([
      ["$eq", [0]],
      ["$eqPath", [0, 1]],
      ["$eqIndex", [0]],
      ["$dependOn", [0]],
      ["$trackDependency", [0]],
    ]);
  });
});

describe("dollarPathApis: 3 つの chroot が同じ表を引いていること", () => {
  it.each([
    ["webComponent/volumeShared.ts", 1],
    ["webComponent/overlay.ts", 2],
  ])("%s が createDollarPathApiWrapper を %i 箇所で使うこと", (file, expected) => {
    const source = readSourceFile(file);
    expect(source.split("createDollarPathApiWrapper(").length - 1).toBe(expected);
  });
});

describe("dollarPathApis: createDollarPathApiWrapper", () => {
  it("表に無い API は null を返すこと（呼び手は親の意味論のまま返す）", () => {
    expect(createDollarPathApiWrapper("$untracked", (p) => p, () => undefined)).toBeNull();
  });

  it("文字列でない引数（省略された level）は翻訳せずそのまま渡すこと", () => {
    const seen: unknown[][] = [];
    const wrapped = createDollarPathApiWrapper("$eqPath", (p) => `cart.${p}`, (args) => { seen.push(args); return "ok"; })!;
    expect(wrapped("a", "b")).toBe("ok");
    // 第 2 引数が未指定なら触らない（パス位置でも文字列でなければ素通し）
    wrapped("a");
    expect(seen).toEqual([["cart.a", "cart.b"], ["cart.a"]]);
  });
});
