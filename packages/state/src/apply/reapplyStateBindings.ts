/**
 * apply/reapplyStateBindings.ts — 再セットで、確立済みのバインドを新しい世代で適用し直す（#267）。
 *
 * 初期化済みの `<wcs-state>` に `setInitialState` で state を入れ直すと、読みは新しい世代を返す
 * （キャッシュの世代印と経路情報の作り直し — #258）。しかしバインドは次に依存パスが書かれるまで
 * 動かないので、画面だけが前の世代のまま残っていた。ここで、入れ直す前と後の state の
 * トップレベルのパスから依存を辿り、そこに登録されているバインドを適用し直す。
 *
 * 集め方は `$postUpdate` と同じ（起点のアドレス＋依存ウォーク、リストは全行展開）。適用は drain と
 * 同じ `applyChangeFromBindings` を通すが、updater には**積まない**。再セットは書き込みではない:
 * drain 終了リスナー（`$scan` の畳み込み・`$watch`・`$streams` の依存駆動 restart）を起こさず、
 * `$updatedCallback` も呼ばない。`$watch` / `$streams` はセッタが新しい宣言で起動し直しているので、
 * restart を重ねると source が二重に起動する。
 */
import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { IAbsoluteStateAddress, IPathInfo, IStateAddress } from "../address/types";
import { peekBindingsForAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { IStateElement } from "../components/types";
import { inSsr } from "../config";
import { WILDCARD } from "../define";
import { walkDependency } from "../dependency/walkDependency";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import { beginStateListBaselineBatch, endStateListBaselineBatch } from "../list/stateListBaseline";
import { runTransition } from "../protocol/transitionRunner";
import { IBindingInfo } from "../types";
import { reportDeferredApplyFailure } from "../updater/updater";
import { applyChangeFromBindings } from "./applyChangeFromBindings";

/**
 * 再適用の起点になるトップレベルのパス。前後**両方**の state から集める — 新しい state で消えた
 * キーのバインドも適用し直し、読めないことを「黙った古い表示」ではなく適用の失敗として報告させる。
 *
 * 除くもの: `$` の宣言面、ワイルドカードを含むキー（`"items.*.upper"` / `"nodes.**.total"` —
 * 行の getter には親のリストから静的辺で辿り着く）、メソッド。
 */
export function collectReapplyPaths(states: readonly (object | undefined)[]): Set<string> {
  const paths = new Set<string>();
  for (const state of states) {
    if (typeof state === "undefined") {
      continue;
    }
    for (const [key, descriptor] of Object.entries(getAllPropertyDescriptors(state))) {
      if (key.startsWith("$") || key.includes(WILDCARD) || typeof descriptor.value === "function") {
        continue;
      }
      paths.add(key);
    }
  }
  return paths;
}

/**
 * `paths` は再適用の起点（`collectReapplyPaths`）。`registeredPaths` は state 要素が経路情報を
 * 登録したパス全部で、ここから行のバインドのパスを行（最後のワイルドカードのリスト要素）ごとに引く。
 */
export function reapplyStateBindings(
  stateElement: IStateElement,
  paths: Iterable<string>,
  registeredPaths: Iterable<string>,
): void {
  const rowPathInfosByElementPath = new Map<string, IPathInfo[]>();
  for (const path of registeredPaths) {
    const pathInfo = getPathInfo(path);
    if (pathInfo.lastWildcardPath === null) {
      continue;
    }
    const rowPathInfos = rowPathInfosByElementPath.get(pathInfo.lastWildcardPath);
    if (typeof rowPathInfos === "undefined") {
      rowPathInfosByElementPath.set(pathInfo.lastWildcardPath, [pathInfo]);
    } else {
      rowPathInfos.push(pathInfo);
    }
  }
  const bindings: IBindingInfo[] = [];
  const visited = new Set<IAbsoluteStateAddress>();
  const collect = (address: IStateAddress): void => {
    const absAddress = createAbsoluteStateAddress(getAbsolutePathInfo(stateElement, address.pathInfo), address.listIndex);
    if (visited.has(absAddress)) {
      return;
    }
    visited.add(absAddress);
    const entry = peekBindingsForAddress(absAddress);
    if (entry instanceof Set) {
      bindings.push(...entry);
    } else if (typeof entry !== "undefined") {
      bindings.push(entry);
    }
    // 行に来たら、その行に登録された行のバインドも集める。依存グラフに辺の無い行バインドがある —
    // 再帰の生成パス（`nodes.*.total`）の静的辺は、新しい世代で実体化するまで作り直さない（State の
    // `_generatedPaths`）。同じノードオブジェクトを入れ直すと `for` は行を作り直さないので、辺を
    // 辿るだけでは行の集計が前の世代の表示のまま残る。
    if (address.listIndex !== null) {
      const rowPathInfos = rowPathInfosByElementPath.get(address.pathInfo.path);
      if (typeof rowPathInfos !== "undefined") {
        for (const rowPathInfo of rowPathInfos) {
          collect(createStateAddress(rowPathInfo, address.listIndex));
        }
      }
    }
  };
  // ウォークと描画が観測したリスト値は、drain と同じくまとめて確定する（list/stateListBaseline.ts）
  beginStateListBaselineBatch();
  try {
    stateElement.createState("readonly", (state) => {
      for (const path of paths) {
        const address = createStateAddress(getPathInfo(path), null);
        collect(address);
        try {
          walkDependency(
            stateElement,
            address,
            stateElement.staticDependency,
            stateElement.dynamicDependency,
            stateElement.listPaths,
            state,
            "new",
            collect,
          );
        } catch {
          // 片方の世代にしか無いリストを辿ると、行の展開がそのリストを読めずに投げる（新しい state で
          // 消えたキーなど）。辿れなかった先は集めない。起点のバインド（`for: items`）は上で集めてあり、
          // その適用が同じ理由で失敗して `console.error` / `$errorCallback` に報告される。
        }
      }
    });
    if (bindings.length === 0) {
      return;
    }
    const apply = (): void => {
      applyChangeFromBindings(bindings, undefined, { updatedCallback: false });
    };
    // 遷移への参加は drain と同じ（updater.ts の `_applyChange`）
    if (inSsr()) {
      apply();
      return;
    }
    const pending = runTransition("state", apply);
    if (pending !== undefined) {
      pending.catch(reportDeferredApplyFailure);
    }
  } finally {
    endStateListBaselineBatch();
  }
}
