import { describe, it, expect, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { main, parseArgs, type CliIo } from "../src/cli/wcsSchema";
import { VERSION, schemaCoreCandidates, loadSchemaCore } from "../src/exports";
import { makeTempDir } from "./helpers";

const tmp = makeTempDir("wcs-schema-cli-");
afterAll(() => tmp.cleanup());

function run(argv: string[], cwd: string = tmp.dir): { code: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const io: CliIo = { stdout: (t) => { stdout += t; }, stderr: (t) => { stderr += t; }, cwd: () => cwd };
  const code = main(argv, io);
  return { code, stdout, stderr };
}

const STATE = `export default {
  count: 0,
  users: [] as { name: string }[],
  increment() { this.count++; },
};`;

describe("parseArgs", () => {
  it("コマンド・ファイル・オプションを分ける", () => {
    const a = parseArgs(["emit", "state.ts", "--state=app", "--out=m.json", "--merge", "--tsconfig=t.json", "--max-depth=3"]);
    expect(a).toMatchObject({ command: "emit", file: "state.ts", state: "app", out: "m.json", merge: true, tsconfig: "t.json", maxDepth: 3, unknown: [] });
    const b = parseArgs(["check", "s.js", "--manifest=x.json"]);
    expect(b).toMatchObject({ command: "check", file: "s.js", manifest: "x.json", state: "default" });
    expect(parseArgs(["--version"]).command).toBe("version");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["emit", "a.ts", "b.ts", "--bogus"]).unknown).toEqual(["b.ts", "--bogus"]);
  });
});

describe("schema-core bundle", () => {
  it("dist / ../dist / ../../dist の順に探し、読み込みはキャッシュされる", () => {
    const pkg = join(tmp.dir, "pkg");
    const candidates = schemaCoreCandidates(pathToFileURL(join(pkg, "src", "cli", "wcsSchema.ts")).href);
    expect(candidates).toEqual([
      join(pkg, "src", "cli", "schema-core.cjs"),
      join(pkg, "src", "cli", "..", "dist", "schema-core.cjs"),
      join(pkg, "src", "cli", "..", "..", "dist", "schema-core.cjs"),
    ]);
    expect(loadSchemaCore()).toBe(loadSchemaCore());
    expect(loadSchemaCore().ALLOWED_SCHEMA_KEYWORDS.has("anyOf")).toBe(true);
  });
});

describe("wcs-schema emit", () => {
  it("引数無し / 不明な引数 / ファイル無し / 不正な --state / --max-depth → usage, exit 2", () => {
    expect(run([]).code).toBe(2);
    expect(run(["emit"]).code).toBe(2);
    const bogus = run(["emit", "state.ts", "--bogus"]);
    expect(bogus.code).toBe(2);
    expect(bogus.stderr).toContain("unknown argument");
    expect(run(["emit", "state.ts", "--state=@bad"]).code).toBe(2);
    expect(run(["emit", "state.ts", "--max-depth=0"]).code).toBe(2);
    expect(run(["emit", "state.ts", "--max-depth=x"]).code).toBe(2);
    const missing = run(["emit", "nope/state.ts"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("cannot read");
  });

  it("--version / --help", () => {
    expect(run(["--version"])).toMatchObject({ code: 0, stdout: `${VERSION}\n` });
    expect(run(["--help"]).stdout).toContain("usage: wcs-schema");
  });

  it("wcstack.manifest.json を書き、自己検査を通す", () => {
    const dir = join(tmp.dir, "emit1");
    tmp.write("emit1/state.ts", STATE);
    const result = run(["emit", "state.ts"], dir);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("wrote wcstack.manifest.json");
    const written = JSON.parse(readFileSync(join(dir, "wcstack.manifest.json"), "utf8"));
    expect(written.kind).toBe("application");
    expect(written.manifestExtensions["wcstack.application"].states.default.stateSchema.properties.users.items.properties.name).toEqual({ type: "string" });
    expect(written.manifestExtensions["wcstack.application"].states.default.stateSchema.properties.increment).toBeUndefined();
  });

  it("--out=- は stdout に出し、ファイルを書かない", () => {
    const dir = join(tmp.dir, "emit2");
    tmp.write("emit2/state.ts", STATE);
    const result = run(["emit", "state.ts", "--out=-"], dir);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).kind).toBe("application");
    expect(existsSync(join(dir, "wcstack.manifest.json"))).toBe(false);
  });

  it("--merge は他 state を保持し該当 state だけ差し替える。壊れた既存ファイルへは merge しない", () => {
    const dir = join(tmp.dir, "emit3");
    tmp.write("emit3/state.ts", STATE);
    tmp.write("emit3/wcstack.manifest.json", JSON.stringify({
      schemaVersion: 1, kind: "application",
      manifestExtensions: { "wcstack.application": { version: 1, states: {
        default: { stateSchema: { type: "object", properties: { old: { type: "string" } } } },
        other: { stateSchema: { type: "object", properties: { x: { type: "number" } } } },
      } } },
    }));
    expect(run(["emit", "state.ts", "--merge"], dir).code).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, "wcstack.manifest.json"), "utf8"));
    const states = written.manifestExtensions["wcstack.application"].states;
    expect(states.default.stateSchema.properties.old).toBeUndefined();
    expect(states.default.stateSchema.properties.count).toEqual({ type: "number" });
    expect(states.other.stateSchema.properties.x).toEqual({ type: "number" });

    tmp.write("emit3/broken.manifest.json", "{ oops");
    const broken = run(["emit", "state.ts", "--merge", "--out=broken.manifest.json"], dir);
    expect(broken.code).toBe(2);
    expect(broken.stderr).toContain("cannot merge");
    expect(readFileSync(join(dir, "broken.manifest.json"), "utf8")).toBe("{ oops");
  });

  it("any な state は警告を出しつつ開いた schema を書く", () => {
    const dir = join(tmp.dir, "emit4");
    tmp.write("emit4/state.ts", `const s: any = {}; export default s;`);
    const result = run(["emit", "state.ts", "--out=-"], dir);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("warning");
    expect(JSON.parse(result.stdout).manifestExtensions["wcstack.application"].states.default.stateSchema).toEqual({});
  });
});

describe("wcs-schema check", () => {
  it("emit 直後は 0、型を変えると 1（差分列挙）、state 不在 / manifest 不在 / 壊れ は 2", () => {
    const dir = join(tmp.dir, "check1");
    tmp.write("check1/state.ts", STATE);
    expect(run(["check", "state.ts"], dir).code).toBe(2); // manifest 不在
    expect(run(["emit", "state.ts"], dir).code).toBe(0);
    const same = run(["check", "state.ts"], dir);
    expect(same.code).toBe(0);
    expect(same.stderr).toContain("up to date");

    tmp.write("check1/state.ts", `export default { count: "0", users: [] as { name: string; age: number }[] };`);
    const drift = run(["check", "state.ts"], dir);
    expect(drift.code).toBe(1);
    expect(drift.stderr).toContain("~ /properties/count/type");
    expect(drift.stderr).toContain("+ /properties/users/items/properties/age/type");
    expect(drift.stderr).toContain("wcs-schema emit --merge");

    expect(run(["check", "state.ts", "--state=other"], dir).code).toBe(2);
    tmp.write("check1/broken.manifest.json", "{ oops");
    expect(run(["check", "state.ts", "--manifest=broken.manifest.json"], dir).code).toBe(2);
  });
});
