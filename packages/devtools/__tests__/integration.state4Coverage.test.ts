/**
 * The coverage report against the real 4.0 runtime (`packages/state`, its committed dist).
 *
 * In @wcstack/state 3.x, list writes reached a wildcard row watch only when the list was bound by
 * a `for` or declared in `$listKeys`, and the coverage report said so (`prerequisite-missing`).
 * 4.0 keeps the lists a row watch ranges over synced itself (packages/state/src/temporal/watch.ts):
 * a row watch with neither fires, and the report must not claim that list writes never reach it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { DevtoolsCore } from "../src/core/DevtoolsCore";
import { DEVTOOLS_HOOK_GLOBAL } from "../src/protocol/types";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("4.0 のランタイムとの配線カバレッジ", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
  });

  it("for も $listKeys も無い行 watch は、発火前は never（prerequisite-missing ではない）、リストへの書き込みで発火して fired になること", async () => {
    const core = new DevtoolsCore();
    core.connect();
    const state: any = await import("../../state/dist/index.esm.js");
    state.bootstrapState();

    const fired: string[] = [];
    // the page binds no `for:` over items / rows, and the state declares no $listKeys
    document.body.innerHTML = `<wcs-state></wcs-state><p data-wcs="textContent: items.length"></p>`;
    const el: any = document.querySelector("wcs-state");
    el.setInitialState({
      items: [{ label: "a" }],
      rows: [{ cells: [{ v: 1 }] }],
      $watch: {
        "items.*.label"(cur: string) { fired.push(`label:${cur}`); },
        "rows.*.cells.*.v"(cur: number) { fired.push(`v:${cur}`); },
      },
    });
    await el.connectedCallbackPromise;
    core.refreshRoster();

    const watches = () => new Map(core.getCoverageReport().filter((e) => e.kind === "watch").map((e) => [e.name, e]));
    expect(watches().get("items.*.label")).toMatchObject({ status: "never", count: 0, note: null });
    expect(watches().get("rows.*.cells.*.v")).toMatchObject({ status: "never", count: 0, note: null });

    el.createState("writable", (s: any) => {
      s.items = [...s.items, { label: "b" }];
      s.rows = [...s.rows, { cells: [{ v: 2 }] }];
    });
    await tick();

    expect(fired).toEqual(["label:b", "v:2"]);
    expect(watches().get("items.*.label")).toMatchObject({ status: "fired", count: 1 });
    expect(watches().get("rows.*.cells.*.v")).toMatchObject({ status: "fired", count: 1 });
    core.disconnect();
  });
});
