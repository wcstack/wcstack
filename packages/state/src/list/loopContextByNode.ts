import { getMountRecordByScopeRoot } from "../webComponent/mount";
import { ILoopContext } from "./types";

const loopContextByNode = new WeakMap<Node, ILoopContext>();

export function getLoopContextByNode(node: Node): ILoopContext | null {
  let paramNode: Node | null = node;
  while (paramNode) {
    const loopContext = loopContextByNode.get(paramNode);
    if (loopContext) {
      return loopContext;
    }
    let next: Node | null = paramNode.parentNode;
    if (next === null && paramNode instanceof ShadowRoot && getMountRecordByScopeRoot(paramNode) !== null) {
      // マウントされた ShadowRoot はホストのループ文脈を継承する（impl-plan §3-0 の 3）。
      // ホスト行の listIndex [i] が子スコープの `for` の親になり、内側の行は [i, j] を
      // 作る — 絶対パスのワイルドカード数 ＝ listIndex 段数（設計書 §4-4）がこれで成立し、
      // v1 の crossBoundaryAddress / baseListIndex（Δ の帳簿）は要らなくなる。
      // マウントされていない ShadowRoot（plain コンポーネント・通常の Shadow ツリー）は
      // 従来どおり境界で止まる。
      next = paramNode.host;
    }
    paramNode = next;
  }
  return null;
}

export function setLoopContextByNode(node: Node, loopContext: ILoopContext | null): void {
  if (loopContext === null) {
    loopContextByNode.delete(node);
    return;
  }
  loopContextByNode.set(node, loopContext);
}
