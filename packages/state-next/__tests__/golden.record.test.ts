/**
 * Records the golden output of the conformance scenarios from the CURRENT engine
 * (@wcstack/state 3.3.0, its checked-in dist). Runs only with WCS_GOLDEN=1
 * (`npm run golden`); vitest isolates this file, so the current engine's <wcs-state>
 * does not collide with state-next's.
 */
import { it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { scenarios } from "../conformance/scenarios";
import { runScenario } from "../conformance/run";

export const GOLDEN_PATH = resolve(__dirname, "golden/current-3.3.0.json");

it.skipIf(process.env.WCS_GOLDEN !== "1")("現行 3.3.0 の DOM をゴールデンとして記録する", async () => {
  // @ts-ignore — the current engine's checked-in bundle (outside this package)
  const current = await import("../../state/dist/index.esm.js");
  current.bootstrapState();
  const out: Record<string, unknown> = {};
  for (const s of scenarios) out[s.name] = await runScenario(s, current);
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, JSON.stringify({ engine: "@wcstack/state 3.3.0 (dist/index.esm.js)", recordedAt: new Date().toISOString(), scenarios: out }, null, 2) + "\n");
}, 60000);
