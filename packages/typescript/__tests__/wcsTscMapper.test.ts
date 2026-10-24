import { describe, it, expect, afterAll, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { main, parseTscArgs, resolveFromProject, type TscIo } from "../src/cli/wcsTsc";
import {
  argsWithProject,
  auditShownConfig,
  findInstalledMapper,
  runWithContentMapper,
  tscBinOf,
  withCleanup,
  type MapperRun,
  type RunCommand,
} from "../src/cli/wcsTscMapper";
import { VERSION } from "../src/version";
import { makeTempDir } from "./helpers";

const tmp = makeTempDir("wcs-tsc-mapper-");
afterAll(() => tmp.cleanup());

const TS_PACKAGE = join(tmp.dir, "ts", "node_modules", "typescript", "package.json");
const TSC_BIN = join(tmp.dir, "ts", "node_modules", "typescript", "bin", "tsc");
const shown = (config: object): string => JSON.stringify(config);
const READY = shown({ compilerOptions: {}, files: ["./index.html", "./a.ts"], include: ["**/*"] });

/** A project directory with a tsconfig and (unless `installed` is false) the mapper package. */
function project(name: string, tsconfig: object, installed: string | false = VERSION): string {
  tmp.write(`${name}/tsconfig.json`, JSON.stringify(tsconfig));
  if (installed !== false) {
    tmp.write(`${name}/node_modules/@wcstack/typescript/package.json`, JSON.stringify({ name: "@wcstack/typescript", version: installed }));
  }
  return join(tmp.dir, name);
}

interface Call { file: string; args: readonly string[]; capture: boolean; config?: unknown }

/** Records each tsc run (and the config it reads); `--showConfig` answers `show`, the run answers `status`. */
function fakeRun(show: string | { status: number; stdout: string }, status: number | null = 0): { run: RunCommand; calls: Call[] } {
  const calls: Call[] = [];
  const run: RunCommand = (file, args, options) => {
    const p = args.indexOf("-p");
    const configPath = p >= 0 ? args[p + 1] : undefined;
    const config = configPath !== undefined && existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : undefined;
    calls.push({ file, args, capture: options.capture, config });
    if (args.includes("--showConfig")) return typeof show === "string" ? { status: 0, stdout: show } : show;
    return { status, stdout: "" };
  };
  return { run, calls };
}

function context(dir: string, argv: string[], run: RunCommand, overrides: Partial<MapperRun> = {}): { ctx: MapperRun; stderr: () => string } {
  let stderr = "";
  const io: TscIo = { stdout: () => {}, stderr: (t) => { stderr += t; }, cwd: () => dir };
  const args = parseTscArgs(argv);
  const p = args.tscArgs.indexOf("-p");
  const ctx: MapperRun = {
    version: "7.1.0-beta",
    tsPackagePath: TS_PACKAGE,
    tsPackage: { bin: { tsc: "./bin/tsc" } },
    args,
    project: p >= 0 ? { path: join(dir, args.tscArgs[p + 1]), index: p + 1 } : { path: join(dir, "tsconfig.json"), index: -1 },
    io,
    run,
    ...overrides,
  };
  return { ctx, stderr: () => stderr };
}

describe("部品", () => {
  it("tscBinOf: package.json の bin（文字列・tsc の項目・無ければ bin/tsc）", () => {
    expect(tscBinOf(TS_PACKAGE, { bin: { tsc: "./bin/tsc" } })).toBe(TSC_BIN);
    expect(tscBinOf(TS_PACKAGE, { bin: "./bin/tsc" })).toBe(TSC_BIN);
    expect(tscBinOf(TS_PACKAGE, {})).toBe(TSC_BIN);
    expect(tscBinOf(TS_PACKAGE, { bin: { tsserver: "x" } })).toBe(TSC_BIN);
  });

  it("findInstalledMapper: 設定のディレクトリから node_modules を遡る。名前の違う・読めない package.json は数えない", () => {
    const dir = project("installed", {}, "4.0.0");
    tmp.write("installed/app/sub/.keep", "");
    expect(findInstalledMapper(join(dir, "app", "sub"))).toEqual({ path: join(dir, "node_modules", "@wcstack", "typescript", "package.json"), version: "4.0.0" });
    tmp.write("installed/app/node_modules/@wcstack/typescript/package.json", JSON.stringify({ name: "other" }));
    tmp.write("installed/app/sub/node_modules/@wcstack/typescript/package.json", "{ broken");
    expect(findInstalledMapper(join(dir, "app", "sub"))?.version).toBe("4.0.0");
    expect(findInstalledMapper(join(tmp.dir, "nowhere"))).toBeUndefined();
  });

  it("argsWithProject: -p の値・--project= / -p= の形・無ければ足す", () => {
    expect(argsWithProject(["-p", "a.json", "--noEmit"], 1, "/t.json")).toEqual(["-p", "/t.json", "--noEmit"]);
    expect(argsWithProject(["--project=a.json"], 0, "/t.json")).toEqual(["--project=/t.json"]);
    expect(argsWithProject(["-p=a.json"], 0, "/t.json")).toEqual(["-p=/t.json"]);
    expect(argsWithProject(["--noEmit"], -1, "/t.json")).toEqual(["--noEmit", "-p", "/t.json"]);
  });

  it("auditShownConfig: .html が files に無い・noImplicitThis が切られている（7 の既定は strict）", () => {
    expect(auditShownConfig("not json")).toBeUndefined();
    expect(auditShownConfig(READY)?.missing).toEqual([]);
    const none = auditShownConfig(shown({ compilerOptions: { strict: false } }))!;
    expect(none).toMatchObject({ needsHtml: true, needsNoImplicitThis: true, hasFiles: false, include: undefined });
    expect(none.missing).toHaveLength(2);
    expect(auditShownConfig(shown({ compilerOptions: { strict: false, noImplicitThis: true }, files: ["./a.HTML"] }))?.missing).toEqual([]);
    expect(auditShownConfig(shown({ compilerOptions: { noImplicitThis: false }, files: ["./a.ts"], include: ["src"] }))).toMatchObject({ needsHtml: true, needsNoImplicitThis: true, hasFiles: true, include: ["src"] });
  });
});

describe("runWithContentMapper", () => {
  it("mapper を名指さない設定: 一時の設定（固定の名前）に継承分 + 自分の項目を書き、点検してから tsc を走らせ、後始末する", () => {
    const dir = project("plain", { compilerOptions: {} });
    tmp.write("plain/base.json", "{}");
    const { run, calls } = fakeRun(READY, 2);
    const { ctx, stderr } = context(dir, ["--noEmit", "-w", "--runExternalCode"], run);
    expect(runWithContentMapper(ctx)).toBe(2);
    const temp = join(dir, ".wcs-tsc.tsconfig.json");
    expect(calls.map((c) => [c.file, c.capture])).toEqual([[TSC_BIN, true], [TSC_BIN, false]]);
    // 点検は -w を除き、一時の設定に --showConfig
    expect(calls[0].args).toEqual(["--noEmit", "-p", temp, "--showConfig", "--runExternalCode"]);
    expect(calls[0].config).toEqual({ extends: "./tsconfig.json", contentMappers: [{ package: "@wcstack/typescript", extensions: [".html"] }] });
    // --runExternalCode は 1 回だけ
    expect(calls[1].args).toEqual(["--noEmit", "-w", "-p", temp, "--runExternalCode"]);
    expect(existsSync(temp)).toBe(false);
    expect(stderr()).toBe("");
  });

  it("継承した mapper（.vue など）を写し、--url-imports=error は options に書く", () => {
    tmp.write("inherit/base.json", JSON.stringify({ contentMappers: [{ package: "vue-mapper", extensions: [".vue"] }] }));
    const dir = project("inherit", { extends: "./base.json" });
    const { run, calls } = fakeRun(READY);
    const { ctx } = context(dir, ["--url-imports=error", "-p", "tsconfig.json"], run);
    expect(runWithContentMapper(ctx)).toBe(0);
    expect(calls[0].config).toEqual({
      extends: "./tsconfig.json",
      contentMappers: [{ package: "vue-mapper", extensions: [".vue"] }, { package: "@wcstack/typescript", extensions: [".html"], options: { urlImports: "error" } }],
    });
  });

  it("継承した別の mapper がすでに .html を取っていれば 2（TypeScript は拡張子ごとに 1 つ）", () => {
    const dir = project("clash", { contentMappers: [{ package: "dhtml-mapper", extensions: [".html"] }] });
    const { run, calls } = fakeRun(READY);
    const { ctx, stderr } = context(dir, [], run);
    expect(runWithContentMapper(ctx)).toBe(2);
    expect(calls).toEqual([]);
    expect(stderr()).toContain("maps .html with dhtml-mapper");
  });

  it("mapper を名指す設定はそのまま使う。明示した --url-imports は効かないと言う", () => {
    const dir = project("named", { contentMappers: [{ package: "@wcstack/typescript", extensions: [".html"], options: { urlImports: "any" } }] });
    const { run, calls } = fakeRun(READY, null);
    const { ctx, stderr } = context(dir, ["--url-imports=error"], run);
    expect(runWithContentMapper(ctx)).toBe(1);   // シグナルで終わった tsc（status null）は 1
    const config = join(dir, "tsconfig.json");
    expect(calls.map((c) => c.args)).toEqual([["-p", config, "--showConfig", "--runExternalCode"], ["-p", config, "--runExternalCode"]]);
    expect(stderr()).toContain("--url-imports is ignored");
    expect(readdirSync(dir).sort()).toEqual(["node_modules", "tsconfig.json"]);
  });

  it("足りないもの: --wcs-defaults なら一時の設定に足す（mapper を名指す設定でも contentMappers は書かない）、無ければ警告", () => {
    const missing = shown({ compilerOptions: { strict: false }, files: ["./a.ts"], include: ["src"] });
    const named = project("defaults", { contentMappers: [{ package: "@wcstack/typescript", extensions: [".html"] }] });
    const withDefaults = fakeRun(missing);
    const a = context(named, ["--wcs-defaults"], withDefaults.run);
    expect(runWithContentMapper(a.ctx)).toBe(0);
    expect(withDefaults.calls[1].config).toEqual({ extends: "./tsconfig.json", compilerOptions: { noImplicitThis: true }, include: ["src", "**/*.html"] });
    expect(a.stderr()).toContain("running with a temporary config that adds");
    expect(existsSync(join(named, ".wcs-tsc.tsconfig.json"))).toBe(false);

    // files だけの設定は include に html だけ、どちらも無ければ **/* も
    const filesOnly = fakeRun(shown({ compilerOptions: {}, files: ["./a.ts"] }));
    runWithContentMapper(context(named, ["--wcs-defaults"], filesOnly.run).ctx);
    expect(filesOnly.calls[1].config).toMatchObject({ include: ["**/*.html"] });
    const empty = fakeRun(shown({ compilerOptions: {} }));
    runWithContentMapper(context(named, ["--wcs-defaults"], empty.run).ctx);
    expect(empty.calls[1].config).toMatchObject({ include: ["**/*", "**/*.html"] });

    const warned = fakeRun(missing);
    const b = context(named, [], warned.run);
    expect(runWithContentMapper(b.ctx)).toBe(0);
    expect(b.stderr()).toContain("is missing include");
    expect(warned.calls[1].args).toEqual(["-p", join(named, "tsconfig.json"), "--runExternalCode"]);
  });

  it("showConfig が失敗すれば点検せずに走らせる（tsc が理由を言う）", () => {
    const dir = project("broken", { compilerOptions: {} });
    const { run, calls } = fakeRun({ status: 1, stdout: "" }, 2);
    const { ctx, stderr } = context(dir, [], run);
    expect(runWithContentMapper(ctx)).toBe(2);
    expect(calls).toHaveLength(2);
    expect(stderr()).toBe("");
  });

  it("--build はそのまま渡し、設定が mapper を名指す必要と --url-imports が効かないことを言う", () => {
    const { run, calls } = fakeRun(READY, 0);
    const { ctx, stderr } = context(tmp.dir, ["-b", "--url-imports=any", "--runExternalCode"], run);
    expect(runWithContentMapper(ctx)).toBe(0);
    expect(calls.map((c) => c.args)).toEqual([["-b", "--runExternalCode"]]);
    expect(stderr()).toContain("--build runs tsc as it is");
    expect(stderr()).toContain("--url-imports has no effect");
    const quiet = context(tmp.dir, ["--build"], fakeRun(READY, null).run);
    expect(runWithContentMapper(quiet.ctx)).toBe(1);
    expect(quiet.stderr()).not.toContain("--url-imports");
  });

  it("tsconfig が無い・mapper が入っていなければ 2。版の違いは警告", () => {
    const { run, calls } = fakeRun(READY);
    const noConfig = context(tmp.dir, [], run, { project: undefined });
    expect(runWithContentMapper(noConfig.ctx)).toBe(2);
    expect(noConfig.stderr()).toContain(`there is no tsconfig.json in ${tmp.dir}: pass -p <tsconfig>`);
    const missingFile = context(tmp.dir, ["-p", "nope.json"], run);
    expect(runWithContentMapper(missingFile.ctx)).toBe(2);
    expect(missingFile.stderr()).toContain(`${join(tmp.dir, "nope.json")} does not exist`);
    const notInstalled = context(project("bare", {}, false), [], run);
    expect(runWithContentMapper(notInstalled.ctx)).toBe(2);
    expect(notInstalled.stderr()).toContain("npm i -D @wcstack/typescript");
    expect(calls).toEqual([]);
    const old = context(project("old", {}, "4.0.0"), [], run);
    expect(runWithContentMapper(old.ctx)).toBe(0);
    expect(old.stderr()).toContain(`the project has @wcstack/typescript 4.0.0 and this wcs-tsc is ${VERSION}`);
  });
});

describe("withCleanup", () => {
  it("終わったら消す。シグナルでも消して 128+n で終わる", () => {
    const file = tmp.write("cleanup/a.txt", "x");
    const gone = tmp.write("cleanup/gone.txt", "x");
    expect(withCleanup([file], () => 7)).toBe(7);
    expect(existsSync(file)).toBe(false);

    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    try {
      const files = [gone];
      expect(() => withCleanup(files, () => { process.emit("SIGINT", "SIGINT"); return 0; })).toThrow("exit 130");
      expect(existsSync(gone)).toBe(false);
      expect(process.listenerCount("SIGINT")).toBe(0);
    } finally {
      exit.mockRestore();
    }
  });
});

describe("main — TypeScript 7.1 への振り分け", () => {
  it("typescript が 7.1 なら content mapper の経路（tsc の bin を package.json から）", () => {
    const dir = project("main71", { compilerOptions: {} });
    const { run, calls } = fakeRun(READY, 2);
    let stderr = "";
    const io: TscIo = { stdout: () => {}, stderr: (t) => { stderr += t; }, cwd: () => dir };
    const code = main(["--noEmit"], io, {
      resolve: (id, cwd) => (id === "typescript/package.json" ? TS_PACKAGE : resolveFromProject(id, cwd)),
      load: (p) => (p === TS_PACKAGE ? { version: "7.1.0-beta", bin: { tsc: "./bin/tsc" } } : undefined),
      run,
    });
    expect(code).toBe(2);
    expect(stderr).toBe("");
    expect(calls.map((c) => c.file)).toEqual([TSC_BIN, TSC_BIN]);
    expect(calls[1].args).toEqual(["--noEmit", "-p", join(dir, ".wcs-tsc.tsconfig.json"), "--runExternalCode"]);
  });
});
