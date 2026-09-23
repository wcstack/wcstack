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
 * 値は **WeakRef**。既定は大域の `customElements` 1 個だが、スコープ付きレジストリを
 * ツリーごと（将来は docs/scoped-custom-element-registries.ja.md の Phase 2 で DCC
 * インスタンスごと）に作るページでは要素の数だけ増えうる。強参照で持つと、レジストリと
 * そこに定義した**全コンストラクタ**がページの寿命の間ずっと解放されない。
 * 死んだ参照は次の走査で畳む（`registerComponentDefiner` は滅多に呼ばれない — 機能の install 時のみ）。
 */
const registeredRegistries: WeakRef<CustomElementRegistry>[] = [];

/** 生きているレジストリを返し、死んだ WeakRef を台帳から畳む。 */
function liveRegistries(): CustomElementRegistry[] {
  const live: CustomElementRegistry[] = [];
  let write = 0;
  for (let i = 0; i < registeredRegistries.length; i++) {
    const registry = registeredRegistries[i].deref();
    if (typeof registry === "undefined") {
      continue;
    }
    live.push(registry);
    registeredRegistries[write++] = registeredRegistries[i];
  }
  registeredRegistries.length = write;
  return live;
}

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
  for (const registry of liveRegistries()) {
    definer(registry);
  }
}

export function registerComponents(registry: CustomElementRegistry = customElements) {
  // 同じレジストリで 2 度 bootstrap しても台帳を太らせない（definer 側は冪等）
  if (!liveRegistries().includes(registry)) {
    registeredRegistries.push(new WeakRef(registry));
  }
  // 機能のタグを先に定義する: SSR 出力の `<wcs-ssr>` は state の接続が読むので、
  // 未 upgrade のまま state が先に動くと stateData が無い
  for (let i = 0; i < definers.length; i++) {
    definers[i](registry);
  }
  if (!registry.get(config.tagNames.state)) {
    registry.define(config.tagNames.state, State);
  }
}
