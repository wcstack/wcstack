/**
 * The failure count and the pick mark against the real 4.0 runtime (`packages/state`, its committed dist).
 *
 * ledger-repair (a seam app: an outside maintainer fixed family-ledger with mistakes put in, using the
 * console, the lint, this overlay and the docs) found two things the overlay showed without a word:
 * - a `for:` list whose getter threw (`[wcs/getter-write]`) reached the timeline as a `binding-apply-error`
 *   row, but between logging in and the month page that was 2 rows of 72, among `write` and `batch`;
 * - the ⌖ pick view listed `textContent ← rows.*.amountLabl` with no mark.
 *
 * The runtime reports a row field that does not resolve only when it can tell without evaluating a getter:
 * a list a getter returns (family-ledger's `rows`) stays silent (protocol §4.3.2), so the typo here is in a
 * list held as data. For a getter's rows built with `map`, the lint reads the callback's literal and reports
 * the field (`wcs/binding-path-missing`).
 */
import { describe, it, expect, afterEach } from "vitest";
import { WcsDevtools } from "../src/shell/WcsDevtools";
import { DEVTOOLS_HOOK_GLOBAL } from "../src/protocol/types";

if (!customElements.get("wcs-devtools")) {
  customElements.define("wcs-devtools", WcsDevtools);
}

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("4.0 のランタイムとの失敗の数と pick の印（ledger-repair）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
  });

  it("for の getter の失敗を閉じたバッジとヘッダーで数えて失敗だけの表示に出し、行のパスの打ち間違いに pick で印を付けること", async () => {
    // devtools を先に繋ぐ（Quick start と同じ順）
    const devtools = document.createElement("wcs-devtools") as WcsDevtools;
    document.body.append(devtools);
    const state: any = await import("../../state/dist/index.esm.js");
    state.bootstrapState();

    const page = document.createElement("main");
    page.innerHTML = `<wcs-state></wcs-state>
      <p data-wcs="textContent: month"></p>
      <ul><template data-wcs="for: entries"><li><span data-wcs="textContent: .amountLabl"></span><em data-wcs="textContent: .memo"></em></li></template></ul>
      <ol><template data-wcs="for: budgetRows"><li data-wcs="textContent: .name"></li></template></ol>`;
    document.body.append(page);
    const el: any = page.querySelector("wcs-state");
    el.setInitialState({
      month: "2026-11",
      touched: 0,
      entries: [{ amountLabel: "¥1,200", memo: "lunch" }, { amountLabel: "¥800", memo: "bus" }],
      // a getter that writes: the runtime refuses the write and isolates the `for:` that failed
      get budgetRows() { this.touched = 1; return [{ name: "food" }]; },
    });
    await el.connectedCallbackPromise;
    // writes and batches around the failures, as on the way to the month page
    for (const month of ["2026-10", "2026-09", "2026-11"]) {
      el.createState("writable", (s: any) => { s.month = month; });
      await tick();
    }
    // the diagnostics add-on checks the bound paths a macrotask after the bindings
    await tick(10);
    devtools.__flushRenderForTest();

    const core = devtools.core!;
    const shadow = document.querySelector("wcs-devtools")!.shadowRoot!;
    expect(core.getFailures().map((entry) => [entry.kind, entry.label])).toEqual([
      ["binding-apply-error", "budgetRows"],
      ["path-unresolved", "entries.*.amountLabl"],
    ]);
    expect(core.getTimeline().filter((entry) => entry.kind === "write" || entry.kind === "batch").length).toBeGreaterThan(2);
    // closed: the badge carries the count
    expect(devtools.open).toBe(false);
    expect(shadow.querySelector(".badge-count")!.textContent).toBe("2");
    expect(shadow.querySelector('button[data-role="failures"]')!.textContent).toBe("⚠ 2 failures");

    devtools.toggle(true);
    shadow.querySelector<HTMLButtonElement>('button[data-role="failures"]')!.click();
    devtools.__flushRenderForTest();
    const kinds = [...shadow.querySelectorAll(".pane-timeline .timeline-row .kind")].map((node) => node.textContent);
    expect(kinds).toEqual(["binding-apply-error", "path-unresolved"]);
    expect(shadow.querySelector(".pane-timeline .pane-body")!.textContent).toContain("[wcs/getter-write]");

    // ⌖ pick a row of the list: the binding whose path does not resolve is marked, the other one is not
    shadow.querySelector<HTMLButtonElement>('button[data-role="pick"]')!.click();
    page.querySelector("ul li")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    devtools.__flushRenderForTest();
    const rows = [...shadow.querySelectorAll<HTMLElement>(".pane-wiring .wiring-row")];
    const typo = rows.find((row) => row.textContent!.includes("entries.*.amountLabl"))!;
    const fine = rows.find((row) => row.textContent!.includes("entries.*.memo"))!;
    const mark = typo.querySelector<HTMLElement>(".badge-tag.warn")!;
    expect(mark.textContent).toBe("unresolved");
    expect(mark.title).toContain('"amountLabl" is not declared');
    expect(fine.querySelector(".badge-tag.warn")).toBeNull();
  });
});
