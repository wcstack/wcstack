/**
 * declarationAliases.ts — 宣言キーの旧名 → 正式名（要件 B12・docs/state-3x-naming.ja.md V13 / V14）。
 *
 * `$updatedCallback` → `$renderedCallback`、`$streams` → `$stream`。旧名は 3.x の間は受け、4.0 で外す（D4）。
 * state オブジェクトがランタイムに入る入口（State の `_state` と `_loadStateFromSource`、マウント記録）で
 * 1 回だけ正規化し、以降のすべての読み手は正式名だけを見る。両方の綴りを宣言したらどちらが効くのか
 * 書き手に見えないので、名指しで落とす（D38）。
 */
import { STATE_STREAM_NAME, STATE_RENDERED_CALLBACK_NAME } from "./define";
import { LINT_HINT } from "./errorGuidance";
import { raiseError } from "./raiseError";

export const DECLARATION_ALIASES: Readonly<Record<string, string>> = {
  $updatedCallback: STATE_RENDERED_CALLBACK_NAME,
  $streams: STATE_STREAM_NAME,
};

/** 正規化済みの state オブジェクト（同じオブジェクトの再セット・ボリュームの 2 つの入口で二重に処理しない） */
const normalizedStates = new WeakSet<object>();

function findOwner(value: object, key: string): object {
  let owner: object | null = value;
  while (owner !== null && !Object.prototype.hasOwnProperty.call(owner, key)) {
    owner = Object.getPrototypeOf(owner);
  }
  return owner!;
}

/**
 * 旧名で宣言されたキーを正式名へ写す。自前のプロパティなら旧名は消す。class の state でメソッドが
 * プロトタイプにある形（`$updatedCallback() {}`）は、インスタンスに正式名の定義を足すだけにする。
 */
export function normalizeDeclarationAliases(state: object): void {
  // state の出どころ（`src="./x.json"` / `<script type="application/json">` / インライン script）は
  // オブジェクト以外も返しうる（`JSON.parse("null")` は `typeof` が "object"）。ここは state が
  // ランタイムに入る最初の関門なので、`in` 演算子の素の TypeError ではなく形を名指しで落とす
  if (state === null || (typeof state !== "object" && typeof state !== "function")) {
    raiseError(
      `The state must be an object, got ${state === null ? "null" : typeof state}. ` +
      `Check the source of the state element (json / src / the inline <script>).`,
    );
  }
  if (normalizedStates.has(state)) {
    return;
  }
  for (const alias of Object.keys(DECLARATION_ALIASES)) {
    if (!(alias in state)) {
      continue;
    }
    const canonical = DECLARATION_ALIASES[alias];
    if (canonical in state) {
      raiseError(
        `[wcs/declaration-alias] The state declares both "${alias}" and "${canonical}". ` +
        `"${alias}" is the old name of "${canonical}" (it works through 3.x) — keep "${canonical}".${LINT_HINT}`,
      );
    }
    if (!Object.isExtensible(state)) {
      // 凍結・封印された state には正式名を足せない（`Object.defineProperty` が
      // "object is not extensible" で落ちる）。3.1 まで旧名のまま動いていた形なので、
      // 素の TypeError ではなく「正式名に書き換えよ」と名指しで案内する
      raiseError(
        `[wcs/declaration-alias] The state is not extensible, so the old name "${alias}" cannot be ` +
        `rewritten to "${canonical}". Declare "${canonical}" directly (the old name works through 3.x ` +
        `only on an extensible state).${LINT_HINT}`,
      );
    }
    const owner = findOwner(state, alias);
    const descriptor = Object.getOwnPropertyDescriptor(owner, alias)!;
    Object.defineProperty(state, canonical, { ...descriptor, configurable: true });
    if (owner === state) {
      delete (state as Record<string, unknown>)[alias];
    }
  }
  normalizedStates.add(state);
}
