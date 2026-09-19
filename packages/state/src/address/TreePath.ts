import { IStateElement } from "../components/types";
import { ITreePath, IPathInfo } from "./types";

/**
 * ツリー（`<wcs-state>` 要素）に固定したパス。絶対アドレスの intern の中間ノードであり、
 * 行バインディングのパターン台帳のキーでもある（docs/state-row-instantiation-redesign.md §3-3）。
 *
 * 表は「要素を弱キーにした WeakMap → PathInfo をキーにした Map」の 2 段。PathInfo はページの
 * 寿命だけ生きる（強参照の Map に載っている）ので内側は WeakMap である必要が無く、Map のほうが
 * 引きが速い。各段は get 1 回と undefined 比較で引く — has してから get する形は同じ表を
 * 2 回引いていた。読みのベンチ（e2e/bench/plain-read.mjs）では、キャッシュを引く読みが
 * getter で約 1ns、行の getter で 3〜5ns 速くなり、この関数を通らない素のパスの読みは変わらない
 * （docs/spikes/state-address-intern-placement/README.md の main-tp）。
 *
 * ノードへの強参照経路は要素の WeakMap エントリ（ephemeron）だけなので、要素が DOM から外れれば
 * ノードごと回収される（e2e/tests/state-address-gc.spec.ts）。
 */
const treePathsByElement: WeakMap<IStateElement, Map<IPathInfo, ITreePath>> = new WeakMap();

export function getTreePath(stateElement: IStateElement, pathInfo: IPathInfo): ITreePath {
  let table = treePathsByElement.get(stateElement);
  if (table === undefined) {
    table = new Map();
    treePathsByElement.set(stateElement, table);
  }
  let treePath = table.get(pathInfo);
  if (treePath === undefined) {
    treePath = Object.freeze(new TreePath(stateElement, pathInfo));
    table.set(pathInfo, treePath);
  }
  return treePath;
}

class TreePath implements ITreePath {
  readonly pathInfo: IPathInfo;
  readonly stateElement: IStateElement;
  readonly parentAbsolutePathInfo: ITreePath | null;
  constructor(stateElement: IStateElement, pathInfo: IPathInfo) {
    this.pathInfo = pathInfo;
    this.stateElement = stateElement;
    if (pathInfo.parentPathInfo === null) {
      this.parentAbsolutePathInfo = null;
    } else {
      this.parentAbsolutePathInfo = getTreePath(stateElement, pathInfo.parentPathInfo);
    }
  }
}
