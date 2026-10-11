/**
 * The golden comparison shared by the source test (conformance.test.ts) and the bundle test
 * (bundle.test.ts): state-next's snapshots must equal the golden, except where a scenario
 * declares an intended difference — and there the golden must still differ.
 */
import { expect } from "vitest";
import type { Scenario } from "./scenarios";
import type { Snapshot } from "./run";

export function expectGolden(s: Scenario, got: Snapshot[], expected: Snapshot[] | undefined): void {
  expect(expected, `"${s.name}" is not recorded: run npm run golden`).toBeDefined();
  if (s.differs === undefined) {
    expect(got).toEqual(expected);
    return;
  }
  const dom = s.differs.dom;
  for (const label of Object.keys(dom)) {
    const old = expected!.find((x) => x.label === label);
    expect(old?.dom, `the current engine now matches "${label}": drop the intended difference`).not.toBe(dom[label]);
  }
  expect(got).toEqual(expected!.map((x) => (x.label in dom ? { label: x.label, dom: dom[x.label] } : x)));
}
