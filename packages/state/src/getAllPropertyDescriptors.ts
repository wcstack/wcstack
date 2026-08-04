/**
 * オブジェクトの自身＋プロトタイプチェーン（Object.prototype 手前まで）の
 * property descriptor を 1 つの辞書に畳んで返す。
 *
 * state の getterPaths / setterPaths 収集（components/State.ts）と DCC の
 * アクセサ生成（dcc/defineDCC.ts）で共有する。両者が別々の走査をしていたため、
 * クラスインスタンスや Object.create(proto) の state で
 * 「getterPaths には載るのに DCC prototype にアクセサが生えない」という
 * 乖離が生じていた
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.4）。
 *
 * 遠いプロトタイプから順に畳むので、同名は**手前（自身に近い側）が勝つ**
 * ＝ プロパティ解決の実際の優先順位と一致する。名前の集合しか見ない
 * getterPaths / setterPaths には影響しないが、descriptor の中身を見て
 * アクセサを生やす DCC 側では優先順位が意味を持つ。
 *
 * オブジェクトリテラルの state では getPrototypeOf が即 Object.prototype になるため、
 * own descriptor のみを見るのと結果は変わらない。
 */
export type Descriptors = Record<string, PropertyDescriptor>;

export function getAllPropertyDescriptors(obj: object): Descriptors {
  const chain: object[] = [];
  let proto: object | null = obj;
  while (proto && proto !== Object.prototype) {
    chain.push(proto);
    proto = Object.getPrototypeOf(proto);
  }
  const descriptors: Descriptors = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    Object.assign(descriptors, Object.getOwnPropertyDescriptors(chain[i]));
  }
  return descriptors;
}
