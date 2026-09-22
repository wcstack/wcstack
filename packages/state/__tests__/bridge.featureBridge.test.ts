/**
 * bridge/featureBridge.ts — 機能どうしの受け口（要件 B13）。
 *
 * `features/scopes` が `watch/*` を、`features/devtools` が `webComponent/*` を静的 import すると、
 * 片方だけを入れたページがもう片方のコードごとダウンロードすることになる（実測で scopes に
 * temporal ランタイムの 5.3 KB gzip、devtools にスコープの 3.3 KB gzip が乗っていた）。
 * ここではその受け口の意味論 —「未 install なら空 / 名指しで落ちる」— を固定する。
 * 実物の分割成果物での検証は `scripts/check-state-split.mjs`（CI）が持つ。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetFeatureBridgeForTest,
  getMountOverlays,
  requireVolumeWatchSupport,
  setMountOverlayProvider,
  setVolumeWatchSupport,
} from "../src/bridge/featureBridge";

const stateElement = { name: "default" } as any;

beforeEach(() => {
  __resetFeatureBridgeForTest();
});

describe("featureBridge: ボリュームの $watch 受け口", () => {
  it("temporal が未 install なら readiness barrier の文言で落ちること", () => {
    expect(() => requireVolumeWatchSupport("cart"))
      .toThrow(/\[wcs\/feature-not-installed\] "\$watch" in <wcs-state mount="cart"> needs the "watch" feature/);
    expect(() => requireVolumeWatchSupport("cart")).toThrow(/@wcstack\/state\/features\/temporal/);
  });

  it("install 済みなら置かれた実装をそのまま返すこと", () => {
    const support = { assertValidPath: () => {}, addEntries: () => {}, start: () => {} };
    setVolumeWatchSupport(support);
    expect(requireVolumeWatchSupport("cart")).toBe(support);
  });
});

describe("featureBridge: マウントのオーバーレイ受け口", () => {
  it("scopes が未 install なら空配列を返すこと（マウントは存在しえない）", () => {
    expect(getMountOverlays(stateElement)).toEqual([]);
  });

  it("install 済みなら置かれた provider に委譲すること", () => {
    const summary = [{ marker: "#m1" }] as any;
    const seen: unknown[] = [];
    setMountOverlayProvider((element) => { seen.push(element); return summary; });
    expect(getMountOverlays(stateElement)).toBe(summary);
    expect(seen).toEqual([stateElement]);
  });
});
