/**
 * stack.test.ts — the TypeScript checker recurses once per getter that reads `this` in a state literal with a
 * top-level spread. A tax return draft (96 getters beside `...sanitizeInputs({}).inputs`) ran `wcs-schema` out of
 * the main thread's stack: `Maximum call stack size exceeded`, and nothing else. The bin runs on a worker with a
 * larger stack; the API says why when it runs out. Runs the built dist (`npm run build` first), as wcsTsc.test does.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeTempDir } from "./helpers";

const DIST = resolve(__dirname, "..", "dist");
const tmp = makeTempDir("wcs-schema-stack-");
afterAll(() => tmp.cleanup());

/** A typed spread (its keys are listed, so the whole literal is typed) beside `count` getters that read `this`. */
function bigState(count: number): string {
  let s = "/** @returns {{ a: number }} */\nconst base = () => ({ a: 1 });\nexport default {\n  ...base(),\n";
  for (let i = 0; i < count; i++) s += `  get g${i}() { return this.a + ${i}; },\n`;
  return `${s}};\n`;
}

describe("getter の多い spread の state（TypeScript のチェッカーの再帰）", () => {
  it("wcs-schema は大きなスタックの worker で動き、主スレッドなら尽きる state でも生成する", () => {
    const file = tmp.write("big/state.js", bigState(400));
    const result = spawnSync(process.execPath, [resolve(DIST, "wcs-schema.mjs"), "emit", file, "--out=-"], { cwd: tmp.dir, encoding: "utf8" });
    expect(result.stderr).not.toContain("Maximum call stack");
    expect(result.status).toBe(0);
    const schema = JSON.parse(result.stdout).manifestExtensions["wcstack.application"].stateSchema;
    expect(schema.properties.a).toEqual({ type: "number" });
    expect(Object.keys(schema.properties)).toHaveLength(401);
  });

  it("API で尽きたときは、理由と対処（worker の resourceLimits.stackSizeMb）を言う", () => {
    const file = tmp.write("big-api/state.js", bigState(400));
    const script = `import { generateStateSchema } from ${JSON.stringify(pathToFileURL(resolve(DIST, "index.esm.js")).href)};
try { generateStateSchema(${JSON.stringify(file)}); console.log("no overflow"); } catch (e) { console.log(e.message); }`;
    // a smaller stack than the default is safe (a larger one may outgrow the thread's)
    const result = spawnSync(process.execPath, ["--stack-size=300", "--input-type=module", "-e", script], { cwd: tmp.dir, encoding: "utf8" });
    expect(result.stdout).toContain("the TypeScript checker ran out of stack on");
    expect(result.stdout).toContain("a top-level spread makes it recurse once per getter that reads `this`");
    expect(result.stdout).toContain("resourceLimits.stackSizeMb");
  });
});
