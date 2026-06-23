// Phase 2 — type & runtime compatibility of bindNode's descriptor with the REAL
// wc-bindable protocol (migration-plan §9-2 (3), item 4 / G2).
//
// `WcBindableDescriptor` is intentionally a structural SUBSET of the published
// `IWcBindable` (which also carries `protocol` / `version` and richer input/command
// entries). This test feeds the real `FetchCore.wcBindable` — typed as `IWcBindable`
// — straight into `bindNode` to prove the two stay assignable. It is the regression
// that keeps the in-house declaration (G2: not shared) from drifting out of compat.

import { describe, it, expect } from "vitest";
import { FetchCore } from "../../fetch/src/core/FetchCore.js";
import type { IWcBindable } from "../../fetch/src/types.js";
import { bindNode, WcBindableDescriptor } from "../src/bindNode.js";
import { signal, flushSync } from "../src/reactive.js";

describe("bindNode: 実 IWcBindable との互換", () => {
  it("FetchCore.wcBindable（IWcBindable）を型エラーなく descriptor として渡せる", () => {
    // Compile-time assertion: a real IWcBindable is assignable to the adapter's
    // descriptor type. If this stops compiling, the in-house type drifted.
    const desc: WcBindableDescriptor = FetchCore.wcBindable satisfies IWcBindable;
    const core = new FetchCore();
    const bound = bindNode(core, desc);

    // The five declared properties become signals.
    expect(Object.keys(bound.signals).sort()).toEqual(["error", "loading", "objectURL", "status", "value"]);
  });

  it("実ノードに対し on / bindInput / bindCommand を設定できる（fetch を起動せず）", () => {
    const core = new FetchCore();
    const bound = bindNode(core); // descriptor read from constructor.wcBindable

    // event-token stream over the response property.
    const responses = bound.on("value");
    expect(responses.peek()).toBeUndefined();

    // signal → input writeback (declared input `url`); no network call is made by
    // merely assigning the property.
    const url = signal("");
    expect(() => bound.bindInput("url", url)).not.toThrow();

    // command-token over the declared `abort` command; primed, so binding alone does
    // not invoke it.
    const cancel = signal(0);
    expect(() => bound.bindCommand("abort", cancel)).not.toThrow();
    flushSync();

    bound.dispose();
  });
});
