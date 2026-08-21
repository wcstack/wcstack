/**
 * parser.ts — `data-wcs` バインディング構文の正本パーサを tooling 向けに公開する
 * サブパスエントリ（`@wcstack/state/parser`）。
 *
 * `./manifest` と同じ「実装が唯一の正本」パターン（docs/static-wiring-dx-design.md D2）。
 * vscode-wcs の正規表現パーサ・devtools の declaredScan 簡易パーサという複製実装を
 * 段階的にこの正本へ寄せるための土台。
 *
 * 契約:
 * - DOM 非依存・純関数（bindText 文字列 → ParseBindTextResult[]）。Node でそのまま動く
 *   （__tests__/parser.test.ts が node 環境で検証する）。
 * - **位置情報は持たず、不正構文は raiseError で throw する**。エラー耐性と診断 range の
 *   生成は消費側（vscode-wcs の positional ラッパー）の責務（同 D3）— ランタイムの
 *   サイズと責務をここで増やさない。
 * - `getPathInfo` はパス文字列の解析済みビュー（セグメント・ワイルドカード位置・親パス
 *   チェーン）を返す純関数。静的依存グラフの親チェーン展開はこの情報から機械的に再現できる。
 *   同一パス → 同一インスタンスの保証は**このエントリのモジュールインスタンス内**でのみ
 *   成立する（`.` エントリは別バンドル＝別キャッシュ。ランタイムの PathInfo と identity
 *   比較してはならない）。キャッシュは無制限（evict なし）— 言語サーバー等の長時間
 *   プロセスでは入力パス種数に単調比例してメモリが増える点に留意。
 * - `ParseBindTextResult.uuid` はランタイム内部（構造テンプレートのハイドレーション台帳）
 *   用のフィールドで、このパーサの戻り値では常に undefined。
 *
 * 公開面は意図的に最小（公開＝恒久契約）。`expandSpread` は live Element と
 * CustomElementRegistry を要するためここには含めない — ブラウザ内の消費者
 * （devtools の declared 正本化）は state 自身が pull API で答える。
 */
export { parseBindTextsForElement } from "./bindTextParser/parseBindTextsForElement.js";
export type { ParseBindTextResult } from "./bindTextParser/types.js";
export { getPathInfo } from "./address/PathInfo.js";
export type { IPathInfo } from "./address/types.js";
export type { IFilterInfo, BindingType } from "./types.js";
