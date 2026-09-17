/**
 * addressImportBoundary.test.ts — アドレスの intern の入口を `src/address/` に閉じる番人。
 *
 * ツリー非依存のアドレスを絶対アドレスへ持ち上げる変換は、選択の余地が無い決定的なものなのに、
 * 以前は各呼び出し元が 2 行（`getAbsolutePathInfo` ＋ `createAbsoluteStateAddress`）で手書きしていた。
 * それを `liftAddress` / `absoluteAddressOf`（src/address/liftAddress.ts）に集めたので、intern の
 * 関数を直接 import してよい場所を固定する（docs/state-address-unification-impl-plan.md §6-B）。
 *
 * 直接 import が許されるのは、`src/address/` の内部と、行バインディングのパターン台帳の経路だけ。
 * パターン台帳は `(treePath, listIndex)` の 2 段キーで登録し、登録側でアドレスを intern しない設計で
 * （docs/state-row-instantiation-redesign.md §3-3）、intern の中間ノード `ITreePath` を自分で扱う必要がある。
 *
 * この境界はアドレス型の統合のあとも残る。統合後は `TreePath` が intern の表そのものを持つので、
 * 外から触れる場所が増えると、同一性（I1）と GC（I2）の不変条件を 1 箇所で守れなくなる。
 */
import { describe, it, expect } from "vitest";
import { collectImportedModules, listSourceFiles, readSourceFile } from "./helpers/sourceScan";

/** モジュール（`src/` からの相対パス）→ `src/address/` の外でそれを import してよいファイル */
const BOUNDARY: Readonly<Record<string, ReadonlyArray<{ readonly file: string; readonly reason: string }>>> = {
  "address/TreePath": [
    {
      file: "bindings/BindingSession.ts",
      reason: "行バインディングをパターン台帳へ登録する側。アドレスを intern せずに ITreePath と listIndex で登録する。",
    },
  ],
  "address/AbsoluteStateAddress": [
    {
      file: "binding/getBindingSetByAbsoluteStateAddress.ts",
      reason:
        "パターン台帳そのもの。devtools の sink が接続されているときだけ、登録・解除のイベント用に " +
        "ITreePath からアドレスを intern する。",
    },
  ],
};

function importersOutsideAddress(module: string, files: readonly string[]): string[] {
  return files
    .filter((file) => !file.startsWith("address/"))
    .filter((file) => collectImportedModules(file, readSourceFile(file)).includes(module));
}

describe("番人: アドレスの intern の入口は src/address/ に閉じる", () => {
  const files = listSourceFiles();

  it("走査が実際に import を拾えていること（空振りの番人は無いのと同じ）", () => {
    expect(files.length).toBeGreaterThan(200);
    // src/address/ の内部は intern の関数を使っている。ここが空なら、拾い方が壊れている
    expect(collectImportedModules("address/liftAddress.ts", readSourceFile("address/liftAddress.ts")))
      .toEqual(expect.arrayContaining(["address/TreePath", "address/AbsoluteStateAddress"]));
    // 持ち上げの入口は広く使われている
    expect(importersOutsideAddress("address/liftAddress", files).length).toBeGreaterThan(5);
  });

  for (const [module, allowed] of Object.entries(BOUNDARY)) {
    it(`${module} を src/address/ の外から import するのは、許可した場所だけであること`, () => {
      expect(
        importersOutsideAddress(module, files),
        `${module} は intern の内部。アドレスが要るなら liftAddress / absoluteAddressOf（address/liftAddress）を使うこと`,
      ).toEqual(allowed.map((entry) => entry.file).sort());
      for (const entry of allowed) {
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("import の拾い方そのものの試験", () => {
  it("静的 import を file の位置から解決すること", () => {
    const source = `import { getTreePath } from "../../address/TreePath";\nimport { x } from "./sibling";`;
    expect(collectImportedModules("proxy/methods/getByAddress.ts", source))
      .toEqual(["address/TreePath", "proxy/methods/sibling"]);
  });

  it("同じディレクトリからの相対 import を解決すること", () => {
    expect(collectImportedModules("address/liftAddress.ts", `import { getTreePath } from "./TreePath";`))
      .toEqual(["address/TreePath"]);
  });

  it("type import・複数行の import・export from・動的 import・副作用 import を拾うこと", () => {
    const source = [
      `import type { ITreePath } from "../address/types";`,
      `import {`,
      `  getTreePath,`,
      `} from "../address/TreePath";`,
      `export { liftAddress } from "../address/liftAddress";`,
      `const lazy = () => import("../address/AbsoluteStateAddress");`,
      `import "../polyfill";`,
    ].join("\r\n");
    expect(collectImportedModules("binding/example.ts", source)).toEqual([
      "address/AbsoluteStateAddress",
      "address/TreePath",
      "address/liftAddress",
      "address/types",
      "polyfill",
    ]);
  });

  it("bare specifier と、コメントや文字列に現れるだけのパスは拾わないこと", () => {
    const source = [
      `import { describe } from "vitest";`,
      `// 取り違えない（address/TreePath.ts）`,
      `const note = "see ../address/TreePath";`,
    ].join("\n");
    expect(collectImportedModules("watch/watchRuntime.ts", source)).toEqual([]);
  });

  it("拡張子つきの指定子を拡張子なしに正規化すること", () => {
    expect(collectImportedModules("a/b.ts", `import { x } from "../address/TreePath.ts";`)).toEqual(["address/TreePath"]);
  });
});
