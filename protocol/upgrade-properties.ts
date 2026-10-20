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
import { IWcBindable } from "./wc-bindable.js";

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

// 属性になってしまったオブジェクトの入力（`files="[object File]"`）を、要素ごとに 1 回だけ言う。
// React 19 は定義前の要素にプロパティが無いのでオブジェクトを属性に書き、Vue の `.attr` も
// 書く。要素はその入力をプロパティでしか読まないので、何も受け取らず、何も言わなかった
// （docs/seam-apps.md、fw-inventory）。
const toldObjectAttribute = new WeakSet<object>();

function warnObjectAttribute(element: object, name: string, value: string): void {
  if (toldObjectAttribute.has(element)) return;
  toldObjectAttribute.add(element);
  const tag = (element as { localName?: string }).localName ?? "element";
  console.warn(
    `[wcs/input-as-attribute] <${tag}> has the attribute ${name}="${value}": an object was written as an ` +
      `attribute, so the element did not receive it. A framework does that when the property is set before the ` +
      `element's definition loads (React 19), or when told to (Vue's .attr). Load the definition before rendering, ` +
      `or assign the property through a ref (Vue: .prop). (Said once per element.)`,
    element,
  );
}

/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 * - 値が `[object …]` の属性（属性に書かれてしまったオブジェクトの入力）は、要素ごとに 1 回警告する。
 */
export function upgradeProperties(element: object): void {
  const declaration = (element as { constructor?: { wcBindable?: IWcBindable } }).constructor?.wcBindable;
  const inputs = declaration?.inputs;
  if (inputs === undefined) return;
  const getAttribute = (element as { getAttribute?: (name: string) => string | null }).getAttribute;
  for (const input of inputs) {
    const name = input.name;
    const attribute = typeof getAttribute === "function" ? getAttribute.call(element, name.toLowerCase()) : null;
    if (attribute !== null && attribute.startsWith("[object ")) warnObjectAttribute(element, name, attribute);
    if (!Object.prototype.hasOwnProperty.call(element, name)) continue;
    if (!hasAccessorOnPrototype(element, name)) continue;
    const record = element as Record<string, unknown>;
    const value = record[name];
    delete record[name];
    record[name] = value;
  }
}
