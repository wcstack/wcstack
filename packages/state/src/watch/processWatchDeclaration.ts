/**
 * watch/processWatchDeclaration.ts
 *
 * `$watch: { "<path>": (cur, prev, ...indexes) => void }` 宣言マップを解析し、
 * IWatchEntry を構築して watchRegistry に一括登録する
 * （docs/state-watch-hook-design.md §2-2 / §8）。
 *
 * `$streams` の processStreamsDeclaration と対称だが、**キーが宣言名ではなくパス**である
 * ぶん検証が異なる（`.` / `*` を許可し、代わりにパスとしての妥当性を見る）。
 *
 * 依存グラフ登録（§8）がこの関数の要点:
 * `setPathInfo` は BindingSession（＝ DOM バインディング登録）からしか呼ばれないため、
 * 静的依存グラフに載るのは「バインドされたパス」だけである。watch を宣言しただけでは
 * walkDependency がそのパスを知らず、`items` への代入で `items.*.price` がバッチに載らない
 * ＝ ハンドラが黙って一度も発火しない。宣言時に自分で登録することでこれを塞ぐ。
 *
 * 呼び出しは stateElement の `_pathSet` クリア後・getterPaths 確定後であること
 * （State の `_state` セッターが順序を保証する）。
 */

import { getPathInfo } from "../address/PathInfo";
import type { IStateElement } from "../components/types";
import { MAX_WILDCARD_DEPTH, STATE_NAME_SEPARATOR, STATE_WATCH_NAME } from "../define";
import { LINT_HINT } from "../errorGuidance";
import { raiseError } from "../raiseError";
import type { IState } from "../types";
import { setWatchEntries } from "./watchRegistry";
import type { IWatchEntry, WatchHandler } from "./types";

/**
 * `$watch` 宣言を registry へ反映し、監視対象パスの集合を返す。
 *
 * 宣言が無い（または空）なら **null** を返す。呼び出し側（State）はこれを
 * `watchPaths` に保持し、setByAddress のホットパスは `!== null` の分岐 1 個で
 * 抜けられる（ゼロコスト契約、§10）。
 */
export function processWatchDeclaration(
  stateElement: IStateElement,
  state: IState,
): ReadonlySet<string> | null {
  const declared = (state as Record<string, unknown>)[STATE_WATCH_NAME];
  if (typeof declared === "undefined") {
    return null;
  }
  if (typeof declared !== "object" || declared === null) {
    // lint 側の findNonObjectWatch が「断定できる形」を同 code で検出するため誘導を付ける。
    // （LINT_HINT を付けない残りは、lint が検出しない空キー・Object.prototype 継承名・
    // ワイルドカード深度超過の 3 shape。）
    raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} must be an object mapping state paths to handler functions.${LINT_HINT}`);
  }
  const entries = new Map<string, IWatchEntry>();
  const paths = new Set<string>();
  let order = 0;
  for (const [path, handler] of Object.entries(declared as Record<string, unknown>)) {
    if (typeof handler !== "function") {
      raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} entry "${path}" must be a function.${LINT_HINT}`);
    }
    if (path.length === 0) {
      raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} entry name must be a non-empty state path.`);
    }
    if (path.startsWith("$")) {
      raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} entry "${path}" must not start with "$" (reserved namespace).${LINT_HINT}`);
    }
    // 越境 watch は不採用（設計 D8）。他 state のアドレスは発火対象にしないため、
    // `@stateName` 付きのパスは受け取った時点で落とす（黙って発火しないより良い）。
    if (path.includes(STATE_NAME_SEPARATOR)) {
      raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} entry "${path}" must not target another state ("${STATE_NAME_SEPARATOR}" is not allowed); watch only paths of its own state.${LINT_HINT}`);
    }
    // Object.prototype の継承名は `path in state` 系の判定を汚すため一律拒否する
    // （processStreamsDeclaration と同じ防衛線）。
    if (path in Object.prototype) {
      raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} entry "${path}" must not be a property name inherited from Object.prototype (e.g. "__proto__", "constructor").`);
    }
    const pathInfo = getPathInfo(path);
    // 空セグメント（"a..b" / 先頭・末尾の "."）は getPathInfo が黙って受理してしまうため、
    // ここで落とす。放置すると解決不能なアドレスを依存グラフへ登録することになる。
    for (const segment of pathInfo.segments) {
      if (segment.length === 0) {
        raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} entry "${path}" has an empty path segment.${LINT_HINT}`);
      }
    }
    if (pathInfo.wildcardCount > MAX_WILDCARD_DEPTH) {
      raiseError(`[wcs/watch-declaration-invalid] ${STATE_WATCH_NAME} entry "${path}" exceeds the maximum wildcard depth (${MAX_WILDCARD_DEPTH}).`);
    }
    entries.set(path, {
      path,
      pathInfo,
      handler: handler as WatchHandler,
      order: order++,
    });
    paths.add(path);
    // 依存グラフ登録（§8）。"for" 以外の bindingType は親 → 子の staticDependency
    // チェーンを生やすだけで listPaths / elementPaths を触らない（State.setPathInfo 参照）。
    // source="watch" は存在検査の診断 code を `wcs/watch-path-missing` に切り替える
    // （watch キーの miss は raiseError にも掛からず、黙って発火しないだけになる）。
    stateElement.setPathInfo(path, "prop", "watch");
  }
  setWatchEntries(stateElement, entries);
  return paths.size > 0 ? paths : null;
}
