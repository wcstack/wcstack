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
 * 機能のタグの定義を登録する（冪等 — 同じ definer は 1 回だけ）。`<wcs-ssr>` は ssr/install.ts が登録する。
 * 機能のタグは `<wcs-state>` より**先**に定義される（下）。
 */
export function registerComponentDefiner(definer: ComponentDefiner): void {
  if (!definers.includes(definer)) {
    definers.push(definer);
  }
}

export function registerComponents(registry: CustomElementRegistry = customElements) {
  // 機能のタグを先に定義する: SSR 出力の `<wcs-ssr>` は state の接続が読むので、
  // 未 upgrade のまま state が先に動くと stateData が無い
  for (let i = 0; i < definers.length; i++) {
    definers[i](registry);
  }
  if (!registry.get(config.tagNames.state)) {
    registry.define(config.tagNames.state, State);
  }
}
