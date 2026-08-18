/**
 * watch/types.ts
 *
 * `$watch`（headless な変更購読）の型定義（docs/state-watch-hook-design.md §2）。
 */

import type { IPathInfo } from "../address/types";

/**
 * `$watch` のハンドラ。
 *
 * - `cur` はバッチ確定値、`prev` はバッチ開始時点の値（first-write-wins、設計書 §4-1）。
 *   `prev` が意味を持つのはスカラのときだけで、参照型・`$postUpdate` 経由・
 *   `config.sameValueGuard = false` では `undefined` になる。
 * - `indexes` はワイルドカードパスのときだけ、そのスコープ自身のループ分が渡る
 *   （`getScopedIndexes`。bind-component の子スコープでも意味が変わらない）。
 * - `this` は writable な state proxy（設計書 D8）。
 * - 戻り値は無視し、await もしない（設計書 §2-1）。
 */
export type WatchHandler = (this: unknown, cur: unknown, prev: unknown, ...indexes: number[]) => void;

export interface IWatchEntry {
  readonly path: string;
  /** `getPathInfo(path)` の結果。`wildcardCount` を indexes 展開に使う */
  readonly pathInfo: IPathInfo;
  readonly handler: WatchHandler;
  /**
   * `$watch` の宣言順（`Object.keys` の順）。同一バッチで複数の watch が hit した
   * ときの呼び出し順のソートキー（設計書 §3-2 層 2）。利用者が順序に意思を持てる
   * 唯一の層なので、enqueue 順ではなく宣言順に固定する。
   */
  readonly order: number;
}
