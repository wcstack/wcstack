import { I as IStateFeature } from '../chunks/features.js';

/**
 * features/formats.ts — 書式フィルタ群（@wcstack/state/features/formats）。
 * `|uc` `|date(…)` `|round(…)` のような宣言が要求する実関数を core の登録簿へ置く。
 */

declare const formats: IStateFeature;

export { formats as default, formats };
