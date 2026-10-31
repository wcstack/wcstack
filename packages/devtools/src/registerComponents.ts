import pkg from "../package.json" with { type: "json" };
import { WcsDevtools } from "./shell/WcsDevtools";
import { defineElements } from "./protocol/defineElement";

export const TAG_NAME = "wcs-devtools";

/**
 * `<wcs-devtools>` を `registry` に定義する（定義済みなら何もしない。別のコピーが定義していれば
 * 版を名指しして 1 回警告する — docs/timing-and-firing-contract.md §24）。
 */
export function registerComponents(registry: CustomElementRegistry = customElements): void {
  defineElements(registry, `${pkg.name}@${pkg.version}`, [
    [TAG_NAME, WcsDevtools],
  ]);
}
