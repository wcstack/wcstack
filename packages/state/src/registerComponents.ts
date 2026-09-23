import { State } from "./components/State";
import { config } from "./config";

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
type ComponentDefiner = (registry: CustomElementRegistry) => void;

const definers: ComponentDefiner[] = [];

/**
 * `registerComponents` を通したレジストリ。`installFeatures([...])` を `bootstrapState()` の
 * **後**に呼んだとき、後から来た definer をここへ即座に適用して追いつかせる。
 *
 * 保持するのは bootstrap したレジストリだけ（既定は大域の `customElements` 1 個。スコープ付き
 * レジストリを使う形でも「ツリー単位の bootstrap 回数」ぶん）で、要素ごとには増えない。
 */
const registeredRegistries = new Set<CustomElementRegistry>();

/**
 * 機能のタグの定義を登録する（冪等 — 同じ definer は 1 回だけ）。`<wcs-ssr>` は ssr/install.ts が登録する。
 * 機能のタグは `<wcs-state>` より**先**に定義される（下）。
 */
export function registerComponentDefiner(definer: ComponentDefiner): void {
  if (definers.includes(definer)) {
    return;
  }
  definers.push(definer);
  // `installFeatures([...])` が `bootstrapState()` の後に呼ばれた形。タグの定義はもう済んで
  // いるので、ここで追いつかせる（definer は自分で `registry.get` を見る冪等な形）。
  // これが無いと `<wcs-ssr>` が未定義のまま残り、宣言の readiness barrier（要件 D13）にも
  // 当たらないので**無言で壊れる** — 順序の約束を文書ではなく機構で守る
  for (const registry of registeredRegistries) {
    definer(registry);
  }
}

export function registerComponents(registry: CustomElementRegistry = customElements) {
  registeredRegistries.add(registry);
  // 機能のタグを先に定義する: SSR 出力の `<wcs-ssr>` は state の接続が読むので、
  // 未 upgrade のまま state が先に動くと stateData が無い
  for (let i = 0; i < definers.length; i++) {
    definers[i](registry);
  }
  if (!registry.get(config.tagNames.state)) {
    registry.define(config.tagNames.state, State);
  }
}
