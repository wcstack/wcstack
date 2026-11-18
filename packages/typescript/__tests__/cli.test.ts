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
    const a = parseArgs(["emit", "state.ts", "--mount=i18n", "--out=m.json", "--merge", "--tsconfig=t.json", "--max-depth=3"]);
    expect(a).toMatchObject({ command: "emit", file: "state.ts", mount: "i18n", out: "m.json", merge: true, tsconfig: "t.json", maxDepth: 3, unknown: [] });
    const b = parseArgs(["check", "s.js", "--manifest=x.json"]);
    expect(b).toMatchObject({ command: "check", file: "s.js", manifest: "x.json", mount: null });
    // v2: --state は撤去（unknown として usage + 移行ヒント）
    expect(parseArgs(["emit", "state.ts", "--state=app"]).unknown).toEqual(["--state=app"]);
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
  it("引数無し / 不明な引数 / ファイル無し / 不正な --mount / --max-depth → usage, exit 2", () => {
    expect(run([]).code).toBe(2);
    expect(run(["emit"]).code).toBe(2);
    const bogus = run(["emit", "state.ts", "--bogus"]);
    expect(bogus.code).toBe(2);
    expect(bogus.stderr).toContain("unknown argument");
    const legacy = run(["emit", "state.ts", "--state=app"]);
    expect(legacy.code).toBe(2);
    expect(legacy.stderr).toContain("--state was removed in v2");
    expect(run(["emit", "state.ts", "--mount=@bad"]).code).toBe(2);
    // runtime（validateVolumeMountPath）と同条件: `$` は位置を問わず拒否（旧 regex は
    // `$` 先頭を受理していた）、数字先頭は runtime 同様に受理
    const dollar = run(["emit", "state.ts", "--mount=$bad"]);
    expect(dollar.code).toBe(2);
    expect(dollar.stderr).toContain("reserved characters");
    expect(run(["emit", "state.ts", "--mount=a#b"]).code).toBe(2);
    expect(run(["emit", "state.ts", "--mount=a..b"]).code).toBe(2);
    expect(run(["emit", "state.ts", "--mount=a.*"]).code).toBe(2);
    // 数字先頭は runtime 同様に受理（落ちるとすれば file 不在の方）
    const digits = run(["emit", "nope-state.ts", "--mount=1a"]);
    expect(digits.stderr).not.toContain("--mount");
    expect(digits.stderr).toContain("cannot read");
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
    expect(written.schemaVersion).toBe(2);
    expect(written.manifestExtensions["wcstack.application"].stateSchema.properties.users.items.properties.name).toEqual({ type: "string" });
    expect(written.manifestExtensions["wcstack.application"].stateSchema.properties.increment).toBeUndefined();
  });

  it("--out=- は stdout に出し、ファイルを書かない", () => {
    const dir = join(tmp.dir, "emit2");
    tmp.write("emit2/state.ts", STATE);
    const result = run(["emit", "state.ts", "--out=-"], dir);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).kind).toBe("application");
    expect(existsSync(join(dir, "wcstack.manifest.json"))).toBe(false);
  });

  it("--merge は filters 等を保持し stateSchema だけ差し替える（v1 の states は持ち越さない）。壊れた既存ファイルへは merge しない", () => {
    const dir = join(tmp.dir, "emit3");
    tmp.write("emit3/state.ts", STATE);
    tmp.write("emit3/wcstack.manifest.json", JSON.stringify({
      schemaVersion: 1, kind: "application",
      manifestExtensions: { "wcstack.application": { version: 1,
        states: { default: { stateSchema: { type: "object", properties: { old: { type: "string" } } } } },
        filters: { money: { input: { type: "number" } } },
      } },
    }));
    expect(run(["emit", "state.ts", "--merge"], dir).code).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, "wcstack.manifest.json"), "utf8"));
    const ns = written.manifestExtensions["wcstack.application"];
    expect(written.schemaVersion).toBe(2);
    expect(ns.states).toBeUndefined();
    expect(ns.stateSchema.properties.old).toBeUndefined();
    expect(ns.stateSchema.properties.count).toEqual({ type: "number" });
    expect(ns.filters.money.input).toEqual({ type: "number" });

    tmp.write("emit3/broken.manifest.json", "{ oops");
    const broken = run(["emit", "state.ts", "--merge", "--out=broken.manifest.json"], dir);
    expect(broken.code).toBe(2);
    expect(broken.stderr).toContain("cannot merge");
    expect(readFileSync(join(dir, "broken.manifest.json"), "utf8")).toBe("{ oops");
  });

  it("--mount=<path> はボリュームの型を部分木として merge する", () => {
    const dir = join(tmp.dir, "emit5");
    tmp.write("emit5/state.ts", STATE);
    tmp.write("emit5/i18n.ts", "export default { t: { hello: '' } };");
    expect(run(["emit", "state.ts"], dir).code).toBe(0);
    expect(run(["emit", "i18n.ts", "--mount=i18n"], dir).code).toBe(0);
    const written = JSON.parse(readFileSync(join(dir, "wcstack.manifest.json"), "utf8"));
    const stored = written.manifestExtensions["wcstack.application"].stateSchema;
    expect(stored.properties.count).toEqual({ type: "number" });
    expect(stored.properties.i18n.properties.t.properties.hello).toEqual({ type: "string" });
  });

  it("ルートの state ファイルを stateSource に書く（manifest の置き場所からの相対・/ 区切り）。--out・--out=-・--merge・--mount", () => {
    const dir = join(tmp.dir, "source1");
    tmp.write("source1/src/state/app.ts", STATE);
    tmp.write("source1/src/i18n.ts", "export default { t: { hello: '' } };");
    const ns = (file: string): Record<string, any> => JSON.parse(readFileSync(join(dir, file), "utf8")).manifestExtensions["wcstack.application"];

    const root = run(["emit", "src/state/app.ts"], dir);
    expect(root.code).toBe(0);
    expect(root.stderr).toContain("wrote wcstack.manifest.json (state tree of src/state/app.ts)");
    expect(ns("wcstack.manifest.json").stateSource).toBe("src/state/app.ts");

    expect(run(["emit", "src/state/app.ts", "--out=tools/m.json"], dir).code).toBe(0);
    expect(ns("tools/m.json").stateSource).toBe("../src/state/app.ts");
    expect(run(["emit", "src/state/app.ts", "--out=src/state/m.json"], dir).code).toBe(0);
    expect(ns("src/state/m.json").stateSource).toBe("app.ts");

    const stdout = run(["emit", "state/app.ts", "--out=-"], join(dir, "src"));
    expect(JSON.parse(stdout.stdout).manifestExtensions["wcstack.application"].stateSource).toBe("state/app.ts");

    // --mount はボリュームの schema: ルートの stateSource を残す
    expect(run(["emit", "src/i18n.ts", "--mount=i18n"], dir).code).toBe(0);
    expect(ns("wcstack.manifest.json").stateSource).toBe("src/state/app.ts");
    expect(ns("wcstack.manifest.json").stateSchema.properties.i18n).toBeDefined();

    // --merge でルートを別のファイルから作り直すと、stateSource もそのファイルになり、filters は残る
    tmp.write("source1/src/state.ts", STATE);
    const merged = JSON.parse(readFileSync(join(dir, "wcstack.manifest.json"), "utf8"));
    merged.manifestExtensions["wcstack.application"].filters = { money: { input: { type: "number" } } };
    tmp.write("source1/wcstack.manifest.json", JSON.stringify(merged));
    expect(run(["emit", "src/state.ts", "--merge"], dir).code).toBe(0);
    expect(ns("wcstack.manifest.json").stateSource).toBe("src/state.ts");
    expect(ns("wcstack.manifest.json").filters.money).toBeDefined();
  });

  it("any な state は警告を出しつつ開いた schema を書く", () => {
    const dir = join(tmp.dir, "emit4");
    tmp.write("emit4/state.ts", `const s: any = {}; export default s;`);
    const result = run(["emit", "state.ts", "--out=-"], dir);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("warning");
    expect(JSON.parse(result.stdout).manifestExtensions["wcstack.application"].stateSchema).toEqual({});
  });
});

describe("wcs-schema check", () => {
  it("emit 直後は 0、型を変えると 1（差分列挙）、mount 不在 / manifest 不在 / v1 / 壊れ は 2", () => {
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

    const missingMount = run(["check", "state.ts", "--mount=other"], dir);
    expect(missingMount.code).toBe(2);
    // 誘導コマンドは check と同じスロット（--mount=other）を指すこと
    expect(missingMount.stderr).toContain("emit --merge --mount=other");
    tmp.write("check1/broken.manifest.json", "{ oops");
    expect(run(["check", "state.ts", "--manifest=broken.manifest.json"], dir).code).toBe(2);
    tmp.write("check1/v1.manifest.json", JSON.stringify({
      schemaVersion: 1, kind: "application",
      manifestExtensions: { "wcstack.application": { version: 1, states: { default: { stateSchema: {} } } } },
    }));
    const v1 = run(["check", "state.ts", "--manifest=v1.manifest.json"], dir);
    expect(v1.code).toBe(2);
    expect(v1.stderr).toContain("schemaVersion 1");
    expect(v1.stderr).toContain("wcs-schema emit");
  });

  it("stateSource: 無い manifest は最新のまま（注記だけ）、別のファイルを指す manifest は乖離、.js と .ts は同じファイル", () => {
    const dir = join(tmp.dir, "check2");
    tmp.write("check2/src/state.ts", STATE);
    expect(run(["emit", "src/state.ts", "--out=config/wcstack.manifest.json"], dir).code).toBe(0);
    const fresh = run(["check", "src/state.ts", "--manifest=config/wcstack.manifest.json"], dir);
    expect(fresh.code).toBe(0);
    expect(fresh.stderr).not.toContain("note:");

    // 4.26 より前に書いた manifest（stateSource が無い）は落とさない
    const manifestPath = join(dir, "config", "wcstack.manifest.json");
    const old = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete old.manifestExtensions["wcstack.application"].stateSource;
    tmp.write("check2/config/wcstack.manifest.json", JSON.stringify(old));
    const legacy = run(["check", "src/state.ts", "--manifest=config/wcstack.manifest.json"], dir);
    expect(legacy.code).toBe(0);
    expect(legacy.stderr).toContain("up to date");
    expect(legacy.stderr).toContain(`note: config/wcstack.manifest.json names no stateSource`);
    expect(legacy.stderr).toContain(`wcs-schema emit src/state.ts --merge --out=config/wcstack.manifest.json\` records "../src/state.ts"`);
    // --mount の check は stateSource を見ない
    expect(run(["emit", "src/state.ts", "--mount=sub", "--out=config/wcstack.manifest.json"], dir).code).toBe(0);
    const mounted = run(["check", "src/state.ts", "--mount=sub", "--manifest=config/wcstack.manifest.json"], dir);
    expect(mounted.code).toBe(0);
    expect(mounted.stderr).not.toContain("note:");

    // 別のファイルを指す: schema が同じでも乖離（検証器はこのファイルのページに schema を当てない）
    old.manifestExtensions["wcstack.application"].stateSource = "../src/old-state.ts";
    tmp.write("check2/config/wcstack.manifest.json", JSON.stringify(old));
    const moved = run(["check", "src/state.ts", "--manifest=config/wcstack.manifest.json"], dir);
    expect(moved.code).toBe(1);
    expect(moved.stderr).toContain("out of date (1 change(s))");
    expect(moved.stderr).toContain(`~ stateSource: the manifest names "../src/old-state.ts", not "../src/state.ts"`);

    // ページが読むのはビルドした .js: 同じファイル
    old.manifestExtensions["wcstack.application"].stateSource = "../src/state.js";
    tmp.write("check2/config/wcstack.manifest.json", JSON.stringify(old));
    expect(run(["check", "src/state.ts", "--manifest=config/wcstack.manifest.json"], dir).code).toBe(0);
  });

  it("--state-source: ページの src がビルドの出力（outDir）のとき、そのファイルを書き、check も同じ指定で比べる。--mount とは併用できない", () => {
    const dir = join(tmp.dir, "check3");
    tmp.write("check3/src/state.ts", STATE);
    const emitted = run(["emit", "src/state.ts", "--state-source=public/state.js"], dir);
    expect(emitted.code).toBe(0);
    expect(emitted.stderr).toContain("(state tree of public/state.js)");
    const ns = JSON.parse(readFileSync(join(dir, "wcstack.manifest.json"), "utf8")).manifestExtensions["wcstack.application"];
    expect(ns.stateSource).toBe("public/state.js");
    expect(run(["check", "src/state.ts", "--state-source=public/state.js"], dir).code).toBe(0);
    const without = run(["check", "src/state.ts"], dir);
    expect(without.code).toBe(1);
    expect(without.stderr).toContain(`~ stateSource: the manifest names "public/state.js", not "src/state.ts"`);

    // 無い manifest への注記は --state-source も添えて案内する
    delete ns.stateSource;
    tmp.write("check3/wcstack.manifest.json", JSON.stringify({ schemaVersion: 2, kind: "application", manifestExtensions: { "wcstack.application": ns } }));
    expect(run(["check", "src/state.ts", "--state-source=public/state.js"], dir).stderr)
      .toContain(`wcs-schema emit src/state.ts --state-source=public/state.js --merge --out=wcstack.manifest.json\` records "public/state.js"`);

    const mounted = run(["emit", "src/state.ts", "--mount=sub", "--state-source=public/state.js"], dir);
    expect(mounted.code).toBe(2);
    expect(mounted.stderr).toContain("a --mount volume has none");
    const empty = run(["check", "src/state.ts", "--state-source="], dir);
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain("--state-source requires a path");
    expect(parseArgs(["emit", "s.ts", "--state-source=x.js"]).stateSource).toBe("x.js");
  });
});
