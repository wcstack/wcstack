/**
 * state-next against the golden output recorded from the current engine
 * (`npm run golden` refreshes it). A scenario missing from the golden file fails, so a
 * new scenario cannot pass without being recorded first.
 */
import { describe, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scenarios } from "../conformance/scenarios";
import { runScenario } from "../conformance/run";
import { expectGolden } from "../conformance/compare";
import { bootstrapState, getBindingsReady, installFeatures, installFormats, listKeys, scopes, temporal } from "../src/index";

const golden = JSON.parse(readFileSync(resolve(__dirname, "golden/current-3.3.0.json"), "utf8"));

beforeAll(() => {
  // the golden comes from the current engine's full bundle: compare with core + formats
  installFormats();
  installFeatures([temporal, listKeys, scopes]);
  bootstrapState();
});

describe("現行 3.3.0 との突き合わせ（ゴールデン）", () => {
  for (const s of scenarios) {
    it(s.name, async () => {
      expectGolden(s, await runScenario(s, { getBindingsReady }), golden.scenarios[s.name]);
    });
  }
});
