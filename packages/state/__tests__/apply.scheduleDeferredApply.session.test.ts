import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IBindingInfo } from "../src/types";

const mocks = vi.hoisted(() => ({
  session: null as any,
  registry: {} as any,
  apply: vi.fn(),
  wait: vi.fn(),
}));

vi.mock("../src/bindings/BindingSession", () => ({
  getBindingSession: vi.fn(() => mocks.session),
}));
vi.mock("../src/bindings/DefinitionCoordinator", () => ({
  getDefinitionCoordinator: vi.fn(() => ({ wait: mocks.wait })),
}));
vi.mock("../src/platform/customElementRegistry", () => ({
  getCustomElementRegistry: vi.fn(() => mocks.registry),
}));
vi.mock("../src/apply/applyChangeFromBindings", () => ({
  applyChangeFromBindings: mocks.apply,
}));

import { scheduleDeferredApply } from "../src/apply/scheduleDeferredApply";

function binding(connected = true): IBindingInfo {
  return {
    replaceNode: { isConnected: connected } as Node,
    node: {} as Node,
  } as IBindingInfo;
}

describe("scheduleDeferredApply session ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = null;
    mocks.registry = {};
  });

  it("session callback/reject/teardown を所有し、多重 schedule を抑止すること", () => {
    const target = binding();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    let ownedTeardown!: () => void;
    const cancel = vi.fn();
    mocks.session = {
      deferUntilDefined: vi.fn((_node: Node, _tag: string, done: () => void, failed: (error: unknown) => void) => {
        resolve = done;
        reject = failed;
        return cancel;
      }),
      addTeardown: vi.fn((_binding: IBindingInfo, teardown: () => void) => {
        ownedTeardown = teardown;
        return true;
      }),
    };

    scheduleDeferredApply(target, "x-session-apply");
    scheduleDeferredApply(target, "x-session-apply");
    expect(mocks.session.deferUntilDefined).toHaveBeenCalledTimes(1);

    ownedTeardown();
    expect(cancel).toHaveBeenCalledTimes(1);
    scheduleDeferredApply(target, "x-session-apply");
    reject(new Error("apply rejected"));
    resolve();
    expect(mocks.apply).toHaveBeenCalledWith([target]);
  });

  it("record が teardown を受理しない場合は直ちに cancel すること", () => {
    const cancel = vi.fn();
    mocks.session = {
      deferUntilDefined: vi.fn(() => cancel),
      addTeardown: vi.fn(() => false),
    };
    scheduleDeferredApply(binding(), "x-session-gone");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("fallback で registry 不在、切断、成功、rejection を処理すること", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.registry = null;
    scheduleDeferredApply(binding(), "x-no-registry");
    expect(errorSpy).toHaveBeenCalledTimes(1);

    mocks.registry = {};
    let done!: () => void;
    let failed!: (error: unknown) => void;
    mocks.wait.mockImplementation((_tag: string, resolve: () => void, reject: (error: unknown) => void) => {
      done = resolve;
      failed = reject;
      return vi.fn();
    });
    const disconnected = binding(false);
    scheduleDeferredApply(disconnected, "x-disconnected");
    done();
    expect(mocks.apply).not.toHaveBeenCalledWith([disconnected]);

    const connected = binding(true);
    scheduleDeferredApply(connected, "x-connected");
    done();
    expect(mocks.apply).toHaveBeenCalledWith([connected]);

    scheduleDeferredApply(binding(true), "x-failed");
    failed(new Error("failed"));
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
