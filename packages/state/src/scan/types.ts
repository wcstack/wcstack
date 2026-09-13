/**
 * scan/types.ts
 *
 * `$scan`（時間軸方向の累積）の型定義（docs/state-scan-design.md §1）。
 */

import type { IPathInfo } from "../address/types";

/**
 * fold。`this` は渡さない（設計書 D4 — `$streams.fold` と同じ）。
 *
 * - `from`: `(acc, cur, prev, ...indexes) => next`
 * - `on`:   `(acc, event, ...indexes) => next`
 *
 * 同期・純粋で、新しい値を返すこと。`acc` と同一参照を返したら書き込まない。
 */
export type ScanFold = (acc: unknown, ...args: unknown[]) => unknown;

/** state パスの変化を畳む source（drain 終端で発火、設計書 §2-1） */
export interface IScanPathSource {
  readonly kind: "path";
  readonly path: string;
  readonly pathInfo: IPathInfo;
}

/** event-token の出来事を畳む source（subscriber として同期発火、設計書 §2-2） */
export interface IScanEventSource {
  readonly kind: "event";
  readonly tokenName: string;
}

export type ScanSource = IScanPathSource | IScanEventSource;

export interface IScanEntry {
  /** 出力プロパティ名（平坦。runtime 所有 — 設計書 D1 / D7） */
  readonly name: string;
  readonly source: ScanSource;
  readonly fold: ScanFold;
  /** 実体化の種と `resetOn` の戻り先 */
  readonly initial: unknown;
  /** バッチに載ったら出力を `initial` に戻すパス（設計書 D6） */
  readonly resetOn: readonly string[];
  /** 宣言順。同一バッチで複数の scan が発火するときの順序（設計書 D11） */
  readonly order: number;
}

export interface IScanRegistry {
  /** 発火直前の identity 再確認に使う（先行 fold が同期に再セットし得る） */
  readonly entries: ReadonlySet<IScanEntry>;
  /** `from` パス → そのパスを畳む scan（宣言順） */
  readonly byFromPath: ReadonlyMap<string, readonly IScanEntry[]>;
  /** `resetOn` パス → そのパスで reset する scan（宣言順） */
  readonly byResetPath: ReadonlyMap<string, readonly IScanEntry[]>;
}
