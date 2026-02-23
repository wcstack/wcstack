import { IBindingInfo } from "../types";
/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 2フェーズで処理:
 * Phase 1: 構造的更新(for/if) + 値更新(select以外) — select.value/selectedIndex は遅延収集
 * Phase 2: 遅延されたselect.value/selectedIndex を適用（option要素の生成後）
 *
 * 最適化のため、以下のグループ化を行う:
 * 同じ stateNameとrootNode を持つバインディングをグループ化 → createState の呼び出しを削減
 */
export declare function applyChangeFromBindings(bindings: IBindingInfo[]): void;
//# sourceMappingURL=applyChangeFromBindings.d.ts.map