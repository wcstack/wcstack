import { IBindingInfo } from "../types";
/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 最適化のため、以下のグループ化を行う:
 * 同じ stateName を持つバインディングをグループ化 → createState の呼び出しを削減
 */
export declare function applyChangeFromBindings(bindingInfos: IBindingInfo[]): void;
//# sourceMappingURL=applyChangeFromBindings.d.ts.map