/**
 * core/addressHooks.ts（設計案 H1、S3）と各機能の hook モジュールの境界。
 * 統合テストが通らない分岐（readiness barrier・冪等な install・再セット後の再帰 hook・
 * マウントもボリュームも無い state に付いた scopes hook の素通し・$postUpdate 後の written hook）を固定する。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/updater/updater", () => ({ getUpdater: () => ({ enqueueAbsoluteAddress: vi.fn() }) }));
vi.mock("../src/dependency/walkDependency", () => ({ walkDependency: vi.fn() }));
vi.mock("../src/proxy/methods/getListIndex", () => ({ getListIndex: () => null }));

import { appendHooks, createAttachedHooks, createAttachedHooksFrom, isFeatureRegistered, NOT_HANDLED, registerFeatureHooks, requireFeature } from "../src/core/addressHooks";
import { installDccHooks } from "../src/dcc/addressHooks";
import { installRecursionHooks, recursionAddressHooks } from "../src/recursion/addressHooks";
import { installScopeHooks, scopeAddressHooks } from "../src/webComponent/addressHooks";
import { addVolumeUpdatedCallback } from "../src/webComponent/volumeShared";
import { postUpdate } from "../src/proxy/apis/postUpdate";
import { createStateAddress } from "../src/address/StateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { createListIndex } from "../src/list/createListIndex";

describe("core/addressHooks: レジストリと readiness barrier", () => {
  it("未 install の機能を宣言が要求すると [wcs/feature-not-installed] で名指しで落ちること", () => {
    expect(isFeatureRegistered("no-such-feature")).toBe(false);
    expect(() => requireFeature("no-such-feature", "$nothing"))
      .toThrow(/\[wcs\/feature-not-installed\] "\$nothing" needs the "no-such-feature" feature/);
  });

  it("install 済みの機能は hook 実装を返し、同じ実装は束に 1 回しか載らないこと", () => {
    const read = vi.fn(() => NOT_HANDLED);
    registerFeatureHooks("test-feature", { read });
    expect(isFeatureRegistered("test-feature")).toBe(true);
    const attached = createAttachedHooks();
    appendHooks(attached, requireFeature("test-feature", "$test"));
    appendHooks(attached, requireFeature("test-feature", "$test"));
    expect(attached.read).toEqual([read]);
    expect(attached.write).toEqual([]);
    const combined = createAttachedHooksFrom({ read }, { write: vi.fn() as any });
    expect(combined.read).toHaveLength(1);
    expect(combined.write).toHaveLength(1);
  });

  it("各機能の install は冪等であること", () => {
    installDccHooks();
    installDccHooks();
    installRecursionHooks();
    installRecursionHooks();
    installScopeHooks();
    installScopeHooks();
    expect(isFeatureRegistered("dcc")).toBe(true);
    expect(isFeatureRegistered("recursion")).toBe(true);
    expect(isFeatureRegistered("scopes")).toBe(true);
  });
});

describe("hook は要素の寿命の間は付いたまま: 宣言が消えた後・該当しない state での素通し", () => {
  it("再セットで $recursion が消えた state では再帰の write hook が素通しすること", () => {
    const stateElement = { hasRecursion: false, recursionRegistry: null } as any;
    const address = createStateAddress(getPathInfo("nodes.0.total"), null);
    expect(recursionAddressHooks.write!(stateElement, address, 1, {}, {} as any)).toBe(NOT_HANDLED);
  });

  it("予約の無いルートの欠落読みは scopes の readMissing hook が素通しすること（core が raise する）", () => {
    const stateElement = { rootNode: document.createElement("div") } as any;
    const address = createStateAddress(getPathInfo("missing"), null);
    expect(scopeAddressHooks.readMissing!(stateElement, address, null, {}, {} as any)).toBe(NOT_HANDLED);
  });

  it("マウントの無い state（ボリュームだけ）のハンドラは添字の段数をそのまま返すこと", () => {
    const stateElement = { hasMounts: false } as any;
    const loopContext = createStateAddress(getPathInfo("items.*"), createListIndex(null, 0)) as any;
    expect(scopeAddressHooks.handlerScope!(stateElement, document.createElement("button"), document, loopContext, 1)).toBe(1);
  });

  it("ボリュームの相対配送は他の state 要素の ref を読み飛ばし、コールバックの無いルートでは何もしないこと", () => {
    const root = { name: "root" } as any;
    const other = { name: "other" } as any;
    const callback = vi.fn();
    addVolumeUpdatedCallback(root, { mountPath: "vol", injections: [], callback });
    const foreignRef = { absolutePathInfo: { stateElement: other, pathInfo: getPathInfo("vol.x") }, listIndex: null } as any;
    scopeAddressHooks.updated!(root, [foreignRef], {});
    expect(callback).not.toHaveBeenCalled();
    expect(() => scopeAddressHooks.updated!({ name: "lonely" } as any, [foreignRef], {})).not.toThrow();
  });
});

describe("$postUpdate の後の written hook", () => {
  it("in-place 変異の通知が written hook に届くこと（DCC の bindable イベントの経路）", () => {
    const written = vi.fn();
    const stateElement = {
      name: "default", staticDependency: new Map(), dynamicDependency: new Map(), listPaths: new Set(),
      bindableEventMap: {}, addressHooks: createAttachedHooksFrom({ written }),
    } as any;
    const handler = { stateElement } as any;
    postUpdate({}, "$postUpdate", {}, handler)("count");
    expect(written).toHaveBeenCalledTimes(1);
    expect(written.mock.calls[0][0]).toBe(stateElement);
    expect(written.mock.calls[0][1].path).toBe("count");
  });
});
