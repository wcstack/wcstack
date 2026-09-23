import { describe, it, expect, vi } from "vitest";
import { installFeatures } from "../src/core/features";
import { featureNotInstalledMessage } from "../src/core/featureEntries";

/**
 * 分割エントリの install（core/features.ts、設計案 §4・D15）の境界。
 */
describe("core/features — installFeatures", () => {
  it("記述子の install をそのまま呼ぶこと（冪等は機能側が持つ）", () => {
    let installed = false;
    const install = vi.fn(() => { installed = true; });
    const idempotent = { name: "test-feature", install: () => { if (!installed) install(); } };
    installFeatures([idempotent, idempotent]);
    installFeatures([idempotent]);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("並べた順に入れること", () => {
    const order: string[] = [];
    installFeatures([
      { name: "test-first", install: () => order.push("first") },
      { name: "test-second", install: () => order.push("second") },
    ]);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("core/featureEntries — barrier の文言", () => {
  it("内部の機能名と、足すべきエントリの両方を名指しすること", () => {
    expect(featureNotInstalledMessage("streams", '"$stream"'))
      .toBe('[wcs/feature-not-installed] "$stream" needs the "streams" feature: ' +
        'install it with installFeatures([...]) from "@wcstack/state/features/temporal" before the state is defined.');
  });

  it("対応表に無い名前はそのままエントリ名として使うこと", () => {
    expect(featureNotInstalledMessage("no-such-feature", '"$nothing"'))
      .toContain('"@wcstack/state/features/no-such-feature"');
  });

  /**
   * 対応表の鍵は登録に使う**実際の機能名**でなければならない。かつて `stream` と書かれていて
   * （登録名は `streams`）、到達すれば `@wcstack/state/features/streams` という存在しない
   * エントリを案内していた。
   */
  it.each([
    ["watch", "temporal"],
    ["scan", "temporal"],
    ["streams", "temporal"],
    ["recursion", "recursion"],
    ["scopes", "scopes"],
    ["dcc", "scopes"],
    ["ssr", "ssr"],
  ])("実際の機能名 %s が実在するエントリ %s を案内すること", (feature, entry) => {
    expect(featureNotInstalledMessage(feature, '"$x"'))
      .toContain(`"@wcstack/state/features/${entry}"`);
  });

  it("実在しない機能名（旧 `stream` / `bindComponent`）が表に残っていないこと", () => {
    // 表に無い名前はそのままエントリ名になるので、その形になれば「表から消えた」と分かる
    expect(featureNotInstalledMessage("stream", '"$x"')).toContain('"@wcstack/state/features/stream"');
    expect(featureNotInstalledMessage("bindComponent", '"$x"')).toContain('"@wcstack/state/features/bindComponent"');
  });
});
