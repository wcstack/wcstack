import { config } from "../config";
import { DELIMITER } from "../define";
import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { getMountRecordByScopeRoot } from "../webComponent/mount";
import { getRootReloadPaths } from "../webComponent/rootReloadPaths";
import { getStateElementByWebComponent } from "../webComponent/stateElementByWebComponent";
import { IApplyContext } from "./types";

/**
 * 親 state → `bind-component` 済みコンポーネントの再読込通知（内部チャネル）。
 *
 * 値そのものは運ばない。バインドされたパスの正本は親 state 側にあり、子は
 * innerState proxy のマッピング経由で親を読みに行くため、必要なのは
 * 「そのパスを読み直せ」という通知だけ。
 *
 * 以前は `element[stateProp][path] = value` と、コンポーネントの公開プロパティを
 * 経由してこの通知を送っていた。受け側の proxy が値を捨てて `$postUpdate` を呼ぶ
 * 作りだったのはそのためだが、同じ proxy が `this.state` として作者にも見えていたので、
 * 公開 API 側の書き込みまで no-op になっていた。通知はここで state element を直接
 * 引く形に分離し、公開 proxy は素通し意味論に統一した
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.1 / G1）。
 *
 * この関数が選ばれるのは `isWebComponentComplete` が真のときだけなので
 * （apply/applyChange.ts）、`bindWebComponent` は完了済み ＝ state element は登録済み。
 * ただし**登録済みと使用可能は別**で、切断済みの state element が台帳に残っている
 * 窓がある（§1.9）。下の使用可能判定を参照。
 *
 * 残余パスが空（`data-wcs="state: user"` — ルート規則の丸ごとマウント）は、親が
 * マウント先を丸ごと差し替えたという通知。何が変わったかは分からないので、子の
 * 登録済みパス全部を読み直す（docs/state-mount-design.md §3-2 / impl-plan P1-2）。
 */
export function applyChangeToWebComponent(binding: IBindingInfo, _context: IApplyContext, _newValue: unknown): void {
  const element = binding.node as Element;
  // v2 マウント（Phase 2）: 配送は静的依存と単一台帳が担うので、値を運ばない
  // 再読込通知そのものが不要（webComponent/mountScope.ts のプローブが実証）
  if (getMountRecordByScopeRoot(element.shadowRoot ?? element) !== null) {
    return;
  }
  const propSegments = binding.propSegments;
  const [ firstSegment, ...restSegments ] = propSegments;
  const innerStateElement = getStateElementByWebComponent(element, firstSegment);
  if (innerStateElement === null) {
    raiseError(`State element not bound to "${firstSegment}" on web component.`);
  }
  // 切断済みの state element には送らない。
  //
  // リスト行にコンポーネントがあるとき、行の再生成では **DOM に戻る前に** apply が走る。
  // 行の content（と中のコンポーネント要素）は再利用されるので、要素をキーにした
  // 台帳 `stateElementByWebComponent` は前回の state element を指したままで、
  // その要素は既に切断されている（`rootNode` を失っている）。そこへ `createState` すると
  // raiseError し、**updater の drain も applyChangeToFor の行ループも例外を捕まえない**ため、
  // 1 つの行が同じバッチの残り全部を道連れにする — 実測では for が空になったまま、
  // 以後どんな更新でも復帰しなくなる（§1.9）。
  //
  // ここは値を運ばない再読込通知なので、切断中の子に送る意味がそもそも無い。
  // 子が DOM に戻れば、子のバインディングが innerState 経由で親をライブ読みするため
  // 現在値はそのとき正しく入る（初期配送と同じ経路）。よって no-op で落として良い。
  if (innerStateElement.hasRootNode === false) {
    if (config.debug) {
      console.debug(
        `[@wcstack/state] skipped parent→child notification for a disconnected state element on <${element.tagName.toLowerCase()}>.`,
        { element, stateProp: firstSegment, path: restSegments.join(DELIMITER) },
      );
    }
    return;
  }
  if (restSegments.length === 0) {
    const paths = getRootReloadPaths(innerStateElement);
    if (paths.length === 0) {
      return;
    }
    innerStateElement.createState("readonly", (state) => {
      for (const path of paths) {
        state.$postUpdate(path);
      }
    });
    return;
  }
  innerStateElement.createState("readonly", (state) => {
    state.$postUpdate(restSegments.join(DELIMITER));
  });
}
