/**
 * core/diagnosticsHooks.ts — 開発時の診断の受け口（@wcstack/state/features/diagnostics）。
 *
 * 束縛時のパス存在検査（打ち間違いの console.warn）は、動作には関わらない開発時の診断
 * なので機能として分けた。core は呼び出し点だけを持ち、置かれていなければ何もしない —
 * readiness barrier は無い（診断が無いのは壊れた宣言ではなく、静かな本番形）。
 * full / auto の `bootstrapState()` は入れるので、従来のページは今までどおり警告を受け取る。
 *
 * 呼び出し点:
 *   check         パス情報の登録（State.setPathInfo — 束縛・`$watch`・`$scan`）
 *   reset         state の世代が進んだとき（`_state` 再セット）
 *   markExported  マウントの公開 getter が生えたとき（webComponent/exportIndex.ts）
 */
import type { IStateElement } from "../components/types";
import type { PathInfoSource } from "../pathDiagnostics";

export interface IPathDiagnostics {
  check(stateElement: IStateElement, state: object | undefined, path: string, source: PathInfoSource): void;
  reset(stateElement: IStateElement): void;
  markExported(stateElement: IStateElement, path: string): void;
}

/** 置かれていなければ null（診断を出さない） */
export let pathDiagnostics: IPathDiagnostics | null = null;

/** 機能の install が呼ぶ（冪等 — 置き換え） */
export function setPathDiagnostics(diagnostics: IPathDiagnostics | null): void {
  pathDiagnostics = diagnostics;
}
