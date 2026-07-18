import { ParseBindTextResult } from "../bindTextParser/types";

export interface IContent {
  readonly firstNode: Node | null;
  readonly lastNode: Node | null;
  readonly mounted: boolean;
  appendTo(targetNode: Node): void;
  mountAfter(targetNode: Node): void;
  unmount(): void;
  /**
   * wholesale 破棄: 全行クリアで再利用されない content の binding teardown
   * （listener 解除・アドレス台帳・loopContext 掃除）を省略し、ノード・binding
   * もろとも GC に任せる。定義待ち等の副作用がある場合は false を返し、呼び出し側が
   * 従来経路（deactivate + unmount）で解体する。
   */
  tryDestroy(): boolean;
}

export interface IFragmentNodeInfo {
  readonly nodePath: number[];
  readonly parseBindTextResults: ParseBindTextResult[];
}

export interface IFragmentInfo {
  readonly fragment: DocumentFragment;
  readonly parseBindTextResult: ParseBindTextResult;
  readonly nodeInfos: IFragmentNodeInfo[];
}