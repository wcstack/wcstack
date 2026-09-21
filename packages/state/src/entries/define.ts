/**
 * entries/define.ts — `@wcstack/state/define`（設計案 §4、要件 N2）。
 *
 * `defineState` と型だけの入口。値の import は 0 本で、ここを import しても
 * ランタイムは 1 バイトも起動しない（`scripts/audit-state-tech-helper-import.mjs` が門で固定する）。
 * オーサリング時に型を付けるだけのファイル（ビルド無しのページの `<script type="module">` や、
 * TypeScript から state オブジェクトを書く側）はこの入口を使う。
 */
export { defineState } from "../defineState.js";
export type {
  WcsStateApi, WcsThis,
  WcsPaths, WcsPathValue,
} from "../defineState.js";
