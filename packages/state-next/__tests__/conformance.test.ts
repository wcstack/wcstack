/**
 * state-next against the golden output recorded from the current engine
 * (`npm run golden` refreshes it). A scenario missing from the golden file fails, so a
 * new scenario cannot pass without being recorded first.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scenarios } from "../conformance/scenarios";
import { runScenario } from "../conformance/run";
import { bootstrapState, getBindingsReady, installFormats } from "../src/index";

const golden = JSON.parse(readFileSync(resolve(__dirname, "golden/current-3.3.0.json"), "utf8"));

beforeAll(() => {
  // the golden comes from the current engine's full bundle: compare with core + formats
  installFormats();
  bootstrapState();
});

describe("現行 3.3.0 との突き合わせ（ゴールデン）", () => {
  for (const s of scenarios) {
    it(s.name, async () => {
      const expected = golden.scenarios[s.name];
      expect(expected, `"${s.name}" is not recorded: run npm run golden`).toBeDefined();
      const got = await runScenario(s, { getBindingsReady });
      if (s.differs !== undefined) {
        const labels = Object.keys(s.differs.dom);
        for (const label of labels) {
          const old = expected.find((x: { label: string }) => x.label === label);
          expect(old?.dom, `the current engine now matches "${label}": drop the intended difference`).not.toBe(s.differs.dom[label]);
        }
        const patched = expected.map((x: { label: string; dom?: string }) => (x.label in s.differs!.dom ? { ...x, dom: s.differs!.dom[x.label] } : x));
        expect(got).toEqual(patched);
        return;
      }
      expect(got).toEqual(expected);
    });
  }
});
