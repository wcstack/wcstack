/**
 * core/features.ts — 分割エントリの install（設計案 §4、要件 D15）。
 *
 * 機能のエントリは「名前と install を持つ記述子」を export し、ページは要るものだけを入れる:
 *
 * ```js
 * import { bootstrapState, installFeatures } from "@wcstack/state/core";
 * import temporal from "@wcstack/state/features/temporal";
 * installFeatures([temporal]);
 * bootstrapState();
 * ```
 *
 * full（`@wcstack/state`）と `/auto` は `bootstrapState()` が全機能を入れるので、利用者から見た
 * 挙動は変わらない。
 *
 * **冪等は機能側の `install` が持つ**（どれも `installed` フラグで 2 回目を弾く）。ここで名前を
 * 覚えて重複を弾く手もあるが、同じことを 2 箇所で持つだけで、しかも「`bootstrapState()` を
 * 2 回呼ぶと 2 回目は機能の install に届かない」という観測できる差が増える。core は素直に並べた順に呼ぶ。
 */
export interface IStateFeature {
  /** 機能の名前（受け口のレジストリのキーと同じ。barrier の文言が使う） */
  readonly name: string;
  /** 受け口へこの機能の実装を置く。**冪等であること** — core は 2 回呼ぶことがある */
  install(): void;
}

export function installFeatures(features: readonly IStateFeature[]): void {
  for (let i = 0; i < features.length; i++) {
    features[i].install();
  }
}
