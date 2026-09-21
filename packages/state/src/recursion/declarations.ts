/**
 * recursion/declarations.ts — `$recursion` の宣言（設計案 H4、S4）。
 *
 * 文脈袋の作り手でもある: 構築したレジストリを袋に置き、`$scan` の検証がそれを読む
 * （`**` getter の展開形を `from` に書いた形を落とすため — D5）。core は「ある宣言が別の宣言に
 * 値を渡す」ことを知らなくてよくなった。
 *
 * 段の位置は従来の `_state` セッターのまま:
 *   validateEarly  core 自身のトークン / `$listKeys` の解析より前（`value` しか読まない）
 *   preCommit      旧世代の生成アクセサ・依存辺・キャッシュを忘れてから差し替える。世代を進める前
 *   apply          アンカーのリストパスの登録（`_listPaths` のクリアより後）
 */
import type { IState } from "../types";
import { IDeclarationHooks, registerDeclarationHooks } from "../core/declarationHooks";
import { STATE_RECURSION_NAME } from "../define";
import { installRecursionHooks } from "./addressHooks";
import { processRecursionDeclaration } from "./declaration";
import { RecursionRegistry } from "./registry";
import type { IRecursionSpec } from "./types";

const SPEC = "recursionSpec";
const REGISTRY = "recursionRegistry";

export const recursionDeclarationHooks: IDeclarationHooks = {
  // scan（8）より先に走り、袋にレジストリを置く
  order: 5,
  validateEarly(_element, value, ctx) {
    const spec = processRecursionDeclaration(value);
    ctx.set(SPEC, spec);
    ctx.set(REGISTRY, spec === null ? null : new RecursionRegistry(spec, value));
  },
  preCommit(element, _value, ctx) {
    // 旧世代の生成アクセサ（own）・それを指す依存辺・評価結果のキャッシュを忘れてから
    // 差し替える（recursion/generation.ts）。own の生成アクセサは、同じオブジェクトを再セットする
    // ときに `getStateInfo` が `getterPaths` へ拾い直す前に消えていなければならない。
    // 前世代の再帰レジストリが生やした具体パスは要素の除外集合に積む。経路情報の作り直し
    // （`_rebuildPathInfo`）はそこを除く — 新しい世代ではまだ実体化されていないため。
    const previous = element.recursionRegistry;
    if (previous !== null) {
      for (const path of previous.forgetGenerated(element, ctx.get<IState>("previousState") as IState)) {
        element.addGeneratedPath?.(path);
      }
    }
    const registry = ctx.get<RecursionRegistry | null>(REGISTRY) ?? null;
    element.setRecursionRegistry?.(registry);
    if (registry !== null) {
      // `$recursion` を宣言した state にだけ再帰の hook（`**` の束縛・再帰 getter の書き込み禁止）を付ける
      element.attachAddressHooks?.("recursion", STATE_RECURSION_NAME);
    }
  },
  apply(element, _value, ctx) {
    const spec = ctx.get<IRecursionSpec | null>(SPEC) ?? null;
    if (spec === null) {
      return;
    }
    // アンカーのリストパス（`nodes.*` なら `nodes`）は**宣言から静的に分かる**ので、
    // 展開を待たずに今すぐ登録する。
    //
    // これが無いと、再帰パスを一度読んだ後の再セットで構造書き込みが恒久的に落ちる。
    // 生成アクセサの `setPathInfo` が張った静的辺（`nodes` → `nodes.*`）は依存グラフに
    // 残るのに、`_listPaths` はセッターでクリアされ、次に再帰パスを読むまで張り直されない。
    // その隙間に構造書き込みが来ると `walkDependency` が「リストではないパス」として
    // `nodes.*` に到達し、listIndex を持たないアドレスで `Cannot expand dynamic dependency…`
    // になる（値は書かれるので、データと表示が乖離したまま自己回復しない）。
    element.addListPath(spec.anchorList);
  },
};

let installed = false;
/** 冪等。full / auto では `bootstrapState()` が呼ぶ */
export function installRecursionDeclarations(): void {
  if (installed) return;
  installed = true;
  installRecursionHooks();
  registerDeclarationHooks("recursion", recursionDeclarationHooks);
}
