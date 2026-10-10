// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/input-attribute.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

// 属性へ反映する wc-bindable 入力の producer 側（SPEC-extensions § Producer guidance for inputs の P1〜P3）。
// 入力の setter は属性をこの 2 関数で書く。それで次が揃う:
//   - `undefined` は「値が無い」（P1）: 属性を、この関数で最初に書く前の状態 — マークアップに書かれた値、
//     無ければ属性なし（= その入力の文書化した既定値）— へ戻す。applier プロファイルを宣言する binder は
//     値の後の `undefined` を書き（A2）、React 19 も書き、直接の代入でも届く。
//   - `null` はクリア（P2）: 属性なし、つまり文書化した既定値。
//   - どちらも文字列 "undefined" / "null" として属性に入らない。
//
// 「最初に書く前」は、その最初の書き込みのときに読む（遅延）。upgrade 前に代入されたプロパティは
// connectedCallback の upgradeProperties() が通し直すので、そのときにはパーサが書いた属性が揃っている。
// 要素自身が setter を通さずに書いた属性は、最初の書き込みより前なら「最初の状態」に含まれる。
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/input-attribute.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/inputAttribute.ts). Those copies are generated — do not edit them.

const initialAttributes = new WeakMap<Element, Map<string, string | null>>();

/** The attribute as it stood before the first write through these helpers. */
function initialAttribute(el: Element, name: string): string | null {
  let byName = initialAttributes.get(el);
  if (byName === undefined) {
    byName = new Map();
    initialAttributes.set(el, byName);
  }
  if (!byName.has(name)) byName.set(name, el.getAttribute(name));
  return byName.get(name) as string | null;
}

function writeAttribute(el: Element, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/**
 * A value attribute. `value` is written as `String(value)`; `null` removes the attribute;
 * `undefined` restores the attribute the element started with.
 */
export function reflectAttribute(el: Element, name: string, value: unknown): void {
  const initial = initialAttribute(el, name);
  writeAttribute(el, name, value === undefined ? initial : value === null ? null : String(value));
}

/**
 * A boolean attribute, present while `value` is truthy (`null` and `false` remove it);
 * `undefined` restores the attribute the element started with.
 */
export function reflectBooleanAttribute(el: Element, name: string, value: unknown): void {
  const initial = initialAttribute(el, name);
  writeAttribute(el, name, value === undefined ? initial : value ? "" : null);
}
