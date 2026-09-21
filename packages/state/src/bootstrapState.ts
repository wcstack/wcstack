import { bootstrapCore } from "./core/bootstrapCore";
import { installFeatures, IStateFeature } from "./core/features";
import devtools from "./features/devtools";
import diagnostics from "./features/diagnostics";
import formats from "./features/formats";
import recursion from "./features/recursion";
import scopes from "./features/scopes";
import ssr from "./features/ssr";
import temporal from "./features/temporal";
import { IWritableConfig } from "./types";

/**
 * full / auto が入れる機能（設計案 §4）。分割エントリの利用者は、このうち要るものだけを
 * `installFeatures([...])` で入れる。並びは install 順だが、受け口の呼び出し順は
 * `order` と優先度が決めるので、この並びに契約は無い。
 */
export const ALL_FEATURES: readonly IStateFeature[] = [formats, temporal, recursion, scopes, ssr, devtools, diagnostics];

/**
 * 全機能を入れてから core を立ち上げる（従来の `bootstrapState()` と同じ挙動）。
 * install は要素の定義（connectedCallback が走り得る）より前に行う。いずれも冪等。
 */
export function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void {
  installFeatures(ALL_FEATURES);
  bootstrapCore(config, registry);
}
