import { ParseBindTextResult } from "../bindTextParser/types";

export interface IContent {
  readonly firstNode: Node | null;
  readonly lastNode: Node | null;
  mountAfter(targetNode: Node): void;
  unmount(): void;
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