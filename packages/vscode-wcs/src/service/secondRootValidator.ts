/**
 * secondRootValidator.ts — 文書に 2 つ目の root の `<wcs-state>`（`wcs/second-root`）。
 *
 * v2 から state の木は root ごとに 1 つ。ランタイム（stateElementByName.ts の setStateElement）は、
 * 同じ root に後から登録しに来た `<wcs-state>` を raiseError で拒む（"A state tree is already registered
 * on this root"）。拒まれた要素は state を読み込んだまま登録されず、何もバインドしない。部分木は
 * `<wcs-state mount="path">`（ボリューム）で接ぎ木する。4.0 も同じ規則を同じ code（#47）で報告する。
 *
 * root の `<wcs-state>` として数えるもの: 文書の要素で、`mount` も `bind-component` も `name` も持たないもの
 * （`name=` の要素は登録の前に初期化で失敗するので root を占めない）。
 * 数えないもの（どれも文書の root に登録されない・要素ですらない）:
 *   - `<template>` の中（構造テンプレート・コンポーネントの雛形・宣言的 shadow root・router の route —
 *     どれも別の root に置かれるか、同時には生きない）
 *   - コメントの中、`<script>` / `<style>` / `<textarea>` / `<title>` などの中身（JS で組み立てる
 *     shadow DOM の `innerHTML` の文字列など）
 *
 * severity は warning（3.x で既に拒まれる形だが、3.x の lint は error を増やさない）。どの要素が後から
 * 登録されるかは読み込みの順で決まるので、文書順で 2 つ目以降を報告する。
 *
 * 文書の走査は 1 回だけで、`<wcs-state` の開始タグが 2 つ以上無い文書は走査しない。
 * pure（DOM / vscode 非依存）。
 */

import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { asciiLowerCase, parseAttributeNames, RAW_TEXT_ELEMENTS } from '../language/htmlParse.js';

export function validateSecondRoot(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const lower = asciiLowerCase(html);
  const tagName = asciiLowerCase(stateTagName);
  const open = `<${tagName}`;
  const first = lower.indexOf(open);
  if (first === -1 || lower.indexOf(open, first + open.length) === -1) return [];

  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  let templateDepth = 0;
  let rootSeen = false;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const next = html[lt + 1];
    if (next === '/') {
      const end = /^<\/([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
      if (end !== null && asciiLowerCase(end[1]) === 'template') templateDepth = Math.max(0, templateDepth - 1);
      const gt = html.indexOf('>', lt + 2);
      i = gt === -1 ? html.length : gt + 1;
      continue;
    }
    if (next === '!' || next === '?') {
      const gt = html.indexOf('>', lt + 2);
      i = gt === -1 ? html.length : gt + 1;
      continue;
    }
    if (next === undefined || !/[A-Za-z]/.test(next)) {
      i = lt + 1;
      continue;
    }

    // 開始タグ: 名前と、引用符を跨がない終端
    let n = lt + 1;
    while (n < html.length && /[^\s/>]/.test(html[n])) n++;
    const name = lower.slice(lt + 1, n);
    let j = n;
    let quote: string | null = null;
    while (j < html.length) {
      const c = html[j];
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    const tagEnd = j < html.length ? j + 1 : html.length;
    i = tagEnd;

    if (RAW_TEXT_ELEMENTS.has(name)) {
      const close = lower.indexOf(`</${name}`, tagEnd);
      i = close === -1 ? html.length : close;
      continue;
    }
    // `<template/>` の `/` は HTML では無視される（開いたまま）
    if (name === 'template') {
      templateDepth++;
      continue;
    }
    if (name !== tagName || templateDepth > 0) continue;
    const attributes = parseAttributeNames(html.slice(n, j));
    // `name=`（v2 で撤去した名前付き State）は登録の前に初期化で失敗する（State.ts の _failInitialization —
    // `wcs/named-state-deprecated` が報告する）ので root を占めない
    if (attributes.has('mount') || attributes.has('bind-component') || attributes.has('name')) continue;
    if (rootSeen) {
      out.push({
        code: WcsDiagnosticCode.SecondRoot,
        start: lt,
        end: tagEnd,
        message: msgs.secondRoot(),
        severity: 'warning',
      });
    }
    rootSeen = true;
  }
  return out;
}
