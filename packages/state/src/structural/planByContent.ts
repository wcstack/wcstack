import type { IContent, IRowPlan } from "./types";

/**
 * structural/planByContent.ts — 行プランから実体化した content の逆引き（行ランタイム設計 R2）。
 *
 * プラン経路で作られた content だけがここに載る。活性化のとき、その行が「プラン行か」を
 * 1 回の WeakMap 引きで判定するためのもの（プラン初期描画の門）。
 */
const planByContent = new WeakMap<IContent, IRowPlan>();

export function setPlanByContent(content: IContent, plan: IRowPlan): void {
  planByContent.set(content, plan);
}

export function getPlanByContent(content: IContent): IRowPlan | null {
  return planByContent.get(content) ?? null;
}
