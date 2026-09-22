/**
 * declarationAliases.ts — 宣言キーの旧名 → 正式名（要件 B12・docs/state-3x-naming.ja.md V13 / V14）。
 *
 * `$updatedCallback` → `$renderedCallback`、`$streams` → `$stream`。旧名は 3.x の間は受け、4.0 で外す（D4）。
 * state オブジェクトがランタイムに入る入口（State の `_state` と `_loadStateFromSource`、マウント記録）で
 * 1 回だけ正規化し、以降のすべての読み手は正式名だけを見る。両方の綴りを宣言したらどちらが効くのか
 * 書き手に見えないので、名指しで落とす（D38）。
 */
import { STATE_STREAMS_NAME, STATE_UPDATED_CALLBACK_NAME } from "./define";
import { raiseError } from "./raiseError";

export const DECLARATION_ALIASES: Readonly<Record<string, string>> = {
  $updatedCallback: STATE_UPDATED_CALLBACK_NAME,
  $streams: STATE_STREAMS_NAME,
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
        `"${alias}" is the old name of "${canonical}" (it works through 3.x) — keep "${canonical}".`,
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
