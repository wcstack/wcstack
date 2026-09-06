// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

// custom element の property upgrade — `static wcBindable.inputs` に宣言した入力のうち、
// 要素が upgrade される前に代入された own データプロパティを取り込み直す。
//
// なぜ必要か:
//   未定義タグの要素は素の HTMLElement なので、`el.url = "..."` は own データプロパティを作る。
//   upgrade 後にクラスの accessor が prototype へ入っても own プロパティが優先されるため、
//   setter は二度と呼ばれず、値は要素へ届かないまま消える（エラーも警告も出ない）。
//   常にプロパティ代入を行う framework（Angular の `[prop]`、Lit の `.prop=`、
//   Solid の `prop:`、Vue の `.prop` 修飾子）× 遅延定義（autoloader / CDN / code-split）で
//   常態的に起きる。docs/architecture-hardening/13-framework-adapter-binding-constraints.md §1.2。
//
// 安全側の判定:
//   own プロパティがあっても、prototype チェーンに accessor が無ければ「シャドウ」ではなく
//   その own プロパティ自体が正規の格納先なので触らない（public class field を壊さない）。
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/upgrade-properties.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/upgradeProperties.ts). Those copies are generated — do not edit them.
import { IWcBindable } from "./wcBindable.js";

function hasAccessorOnPrototype(target: object, name: string): boolean {
  let proto = Object.getPrototypeOf(target);
  while (proto !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor !== undefined) {
      return typeof descriptor.get === "function" || typeof descriptor.set === "function";
    }
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 */
export function upgradeProperties(element: object): void {
  const declaration = (element as { constructor?: { wcBindable?: IWcBindable } }).constructor?.wcBindable;
  const inputs = declaration?.inputs;
  if (inputs === undefined) return;
  for (const input of inputs) {
    const name = input.name;
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    if (!hasAccessorOnPrototype(element, name)) continue;
    const record = element as Record<string, unknown>;
    const value = record[name];
    delete record[name];
    record[name] = value;
  }
}
