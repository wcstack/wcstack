import { IListIndex } from "../../list/types";

export interface ISwapInfo {
  readonly value: unknown[];
  readonly listIndexes: IListIndex[];
  /** 揃う前の書き込みが着地した行と、そのバッチの番号（updater の batch・#361） */
  readonly written: Map<IListIndex, number>;
}
