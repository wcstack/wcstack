import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  parseTscArgs,
  findProjectConfig,
  auditConfig,
  writeDefaultsConfig,
  writeUrlImportsDeclaration,
  resolveFromProject,
  main,
  type TscIo,
  type MainDeps,
} from "../src/cli/wcsTsc";
import { makeTempDir } from "./helpers";

const tmp = makeTempDir("wcs-tsc-");
afterAll(() => tmp.cleanup());

const BIN = resolve(__dirname, "..", "dist", "wcs-tsc.mjs");

const READY_CONFIG = JSON.stringify({
  compilerOptions: {
    target: "ESNext", module: "ESNext", moduleResolution: "bundler", lib: ["ESNext", "DOM"], types: [],
    noEmit: true, allowJs: true, checkJs: true, noImplicitThis: true, skipLibCheck: true,
  },
  include: ["**/*.html"],
});

const PAGE = `<!doctype html>
<html><body>
<wcs-state>
  <script type="module">
    import { defineState } from "https://esm.run/@wcstack/state";
    import { debounce } from "https://esm.run/lodash-es";
    export default defineState({
      count: 0,
      inc() { this.coutn++; },
      ok() { this.count++; debounce(() => {}, 1); },
    });
  </script>
</wcs-state>
<wcs-state name="plain"><script type="module">
export default { items: [] as string[], add() { this.items = [...this.items, 1]; } };
</script></wcs-state>
</body></html>
`;

function runBin(dir: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("parseTscArgs", () => {
  it("自前の 2 オプションだけを取り、残りは tsc に渡す", () => {
    const a = parseTscArgs(["--url-imports=error", "--wcs-defaults", "-p", "tsconfig.json", "--noEmit"]);
    expect(a).toMatchObject({ urlImports: "error", wcsDefaults: true, tscArgs: ["-p", "tsconfig.json", "--noEmit"], invalid: [] });
    expect(parseTscArgs([]).urlImports).toBe("any");
    expect(parseTscArgs(["--url-imports=maybe"]).invalid).toEqual(["--url-imports=maybe"]);
    expect(parseTscArgs(["--wcs-help"]).help).toBe(true);
    expect(parseTscArgs(["--wcs-version"]).version).toBe(true);
  });
});

describe("findProjectConfig / auditConfig / writeDefaultsConfig", () => {
  it("-p の形（ファイル / ディレクトリ / =）と既定の ./tsconfig.json", () => {
    const dir = join(tmp.dir, "find");
    const cfg = tmp.write("find/tsconfig.json", READY_CONFIG);
    tmp.write("find/sub/tsconfig.json", READY_CONFIG);
    expect(findProjectConfig(["-p", "sub"], dir)).toEqual({ path: join(dir, "sub", "tsconfig.json"), index: 1 });
    expect(findProjectConfig(["--project", "sub/tsconfig.json"], dir)).toEqual({ path: join(dir, "sub", "tsconfig.json"), index: 1 });
    expect(findProjectConfig(["-p=sub"], dir)?.index).toBe(0);
    expect(findProjectConfig(["--noEmit"], dir)).toEqual({ path: cfg, index: -1 });
    expect(findProjectConfig([], join(tmp.dir, "nowhere"))).toBeUndefined();
  });

  it("不足の検出: include に html 無し / files のみ / noImplicitThis・allowJs・checkJs", () => {
    const ready = tmp.write("audit/ready/tsconfig.json", READY_CONFIG);
    expect(auditConfig(ready, ts).missing).toEqual([]);

    // strict は noImplicitThis を含む。target / lib 無し（ES5 既定）はプリアンブルの型が崩れるので不足
    const bare = tmp.write("audit/bare/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }));
    expect(auditConfig(bare, ts).missing).toEqual([
      'include: "**/*.html"',
      "compilerOptions.allowJs: true",
      "compilerOptions.checkJs: true",
      'compilerOptions.target: "ES2015" or later (the this-typing preamble uses Map / Set / Promise)',
    ]);
    expect(auditConfig(bare, ts).needsTarget).toBe(true);

    const filesOnly = tmp.write("audit/files/tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", noImplicitThis: true, allowJs: true, checkJs: true }, files: ["a.ts"] }));
    expect(auditConfig(filesOnly, ts).missing).toEqual(['include: "**/*.html" (a files-only config never sees HTML)']);

    // include 無し（既定 **/*）は html を拾うので include の不足にはしない。lib があれば target 無しでもよい
    const defaults = tmp.write("audit/defaults/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, allowJs: true, checkJs: true, lib: ["ES2022", "DOM"] } }));
    expect(auditConfig(defaults, ts).missing).toEqual([]);
    const noImplicitOff = tmp.write("audit/off/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noImplicitThis: false, allowJs: true, checkJs: true, target: "ESNext" } }));
    expect(auditConfig(noImplicitOff, ts).missing).toEqual(["compilerOptions.noImplicitThis: true"]);
  });

  it("--wcs-defaults の一時 config は元を extends し、include と 3 オプションを足す", () => {
    const base = tmp.write("defaults/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }));
    const audit = auditConfig(base, ts);
    const temp = writeDefaultsConfig(base, audit);
    expect(temp.startsWith(join(tmp.dir, "defaults"))).toBe(true);
    const written = JSON.parse(readFileSync(temp, "utf8"));
    expect(written).toEqual({
      extends: "./tsconfig.json",
      compilerOptions: { allowJs: true, checkJs: true, noImplicitThis: true, target: "ESNext" },
      include: ["src/**/*.ts", "**/*.html"],
    });
    const noInclude = tmp.write("defaults2/tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020" }, files: ["a.ts"] }));
    const noIncludeWritten = JSON.parse(readFileSync(writeDefaultsConfig(noInclude, auditConfig(noInclude, ts)), "utf8"));
    expect(noIncludeWritten.include).toEqual(["**/*", "**/*.html"]);
    expect(noIncludeWritten.compilerOptions.target).toBeUndefined();   // 明示の target は上書きしない
  });

  it("URL import の ambient 宣言ファイル", () => {
    const path = writeUrlImportsDeclaration();
    expect(readFileSync(path, "utf8")).toContain('declare module "https://*";');
  });

  it("resolveFromProject: project → 自パッケージの順、無ければ undefined", () => {
    expect(resolveFromProject("typescript", tmp.dir)).toMatch(/typescript/);
    expect(resolveFromProject("@volar/typescript/lib/quickstart/runTsc.js", tmp.dir)).toMatch(/runTsc\.js$/);
    expect(resolveFromProject("definitely-not-a-package-xyz", tmp.dir)).toBeUndefined();
  });
});

describe("main — プロセス内（runTsc を差し替え）", () => {
  const realRequire = createRequire(import.meta.url);
  const run = (argv: string[], cwd: string = tmp.dir, deps?: Partial<MainDeps>) => {
    let stdout = "";
    let stderr = "";
    const io: TscIo = { stdout: (t) => { stdout += t; }, stderr: (t) => { stderr += t; }, cwd: () => cwd };
    const code = main(argv, io, {
      resolve: deps?.resolve ?? resolveFromProject,
      load: deps?.load ?? ((p) => realRequire(p)),
    });
    return { code, stdout, stderr };
  };

  it("--wcs-help / --wcs-version / 不正オプション", () => {
    expect(run(["--wcs-help"]).stdout).toContain("usage: wcs-tsc");
    expect(run(["--wcs-version"]).stdout).toMatch(/^\d+\.\d+\.\d+/);
    const bad = run(["--url-imports=nope"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("invalid option");
  });

  it("peer が解決できなければ 2（Volar → 案内、typescript → 案内）", () => {
    const noVolar = run([], tmp.dir, { resolve: (id, cwd) => (id.startsWith("@volar/") ? undefined : resolveFromProject(id, cwd)) });
    expect(noVolar.code).toBe(2);
    expect(noVolar.stderr).toContain("@volar/typescript");
    const noTs = run([], tmp.dir, { resolve: (id, cwd) => (id.startsWith("typescript") ? undefined : resolveFromProject(id, cwd)) });
    expect(noTs.code).toBe(2);
    expect(noTs.stderr).toContain("needs typescript");
  });

  it("runTsc に .html 拡張・tsc モードの plugin・URL import の ambient 宣言を渡し、argv を組み立て、後始末する", () => {
    const dir = join(tmp.dir, "inproc");
    tmp.write("inproc/tsconfig.json", READY_CONFIG);
    const calls: { tscPath: string; options: unknown; rootNames: string[]; plugins: unknown[] }[] = [];
    const fakeRunTsc = (tscPath: string, options: unknown, getPlugins: (ts: unknown, o: { rootNames: string[] }) => unknown[]) => {
      const o = { rootNames: ["a.ts"] };
      const plugins = getPlugins(undefined, o);
      calls.push({ tscPath, options, rootNames: o.rootNames, plugins });
    };
    const savedArgv = process.argv;
    try {
      const result = run(["--noEmit"], dir, {
        load: (p) => (p.endsWith("runTsc.js") ? { runTsc: fakeRunTsc } : realRequire(p)),
      });
      expect(result.code).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0].tscPath).toMatch(/tsc\.js$/);
      expect(calls[0].options).toEqual({ extraSupportedExtensions: [".html"], extraExtensionsToRemove: [] });
      expect(calls[0].rootNames[1]).toMatch(/url-imports\.d\.ts$/);
      expect(existsSync(calls[0].rootNames[1])).toBe(false);   // cleaned up after runTsc returned
      const plugin = calls[0].plugins[0] as { typescript: { getServiceScript: unknown; getExtraServiceScripts?: unknown } };
      expect(plugin.typescript.getExtraServiceScripts).toBeUndefined();   // tsc mode
      expect(process.argv.slice(1)).toEqual([calls[0].tscPath, "--noEmit"]);
    } finally {
      process.argv = savedArgv;
    }

    // --url-imports=error: 宣言ファイルを足さない。--wcs-defaults: 一時 config を -p に差し替え、後始末する
    tmp.write("inproc-bare/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }));
    const bareDir = join(tmp.dir, "inproc-bare");
    calls.length = 0;
    try {
      const result = run(["--url-imports=error", "--wcs-defaults", "-p", "tsconfig.json"], bareDir, {
        load: (p) => (p.endsWith("runTsc.js") ? { runTsc: fakeRunTsc } : realRequire(p)),
      });
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("temporary config");
      expect(calls[0].rootNames).toEqual(["a.ts"]);
      const projectArg = process.argv[process.argv.indexOf("-p") + 1];
      expect(projectArg).toMatch(/\.wcs-tsc\.\d+\.tsconfig\.json$/);
      expect(existsSync(projectArg)).toBe(false);
      expect(readdirSync(bareDir)).toEqual(["tsconfig.json"]);
    } finally {
      process.argv = savedArgv;
    }
  });
});

describe("wcs-tsc（ビルド済み bin・tsc まで通す）", () => {
  it("<wcs-state> の typo を file.html(line,col) の TS2551 で報告し、CDN の @wcstack/state import は消える", () => {
    const dir = join(tmp.dir, "page");
    tmp.write("page/tsconfig.json", READY_CONFIG);
    tmp.write("page/index.html", PAGE);
    const result = runBin(dir, ["-p", "tsconfig.json"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/index\.html\(9,\d+\): error TS2551: Property 'coutn' does not exist/);
    expect(result.stdout).toMatch(/index\.html\(15,\d+\): error TS2322/);   // second block: number into string[]
    expect(result.stdout).not.toContain("TS2307");
    expect(result.stdout).not.toContain("not available in this use case");
  }, 60_000);

  it("--url-imports=error は他の URL import を TS2307 にする", () => {
    const dir = join(tmp.dir, "page-error");
    tmp.write("page-error/tsconfig.json", READY_CONFIG);
    tmp.write("page-error/index.html", PAGE);
    const result = runBin(dir, ["--url-imports=error", "-p", "tsconfig.json"]);
    expect(result.stdout).toMatch(/index\.html\(6,\d+\): error TS2307: Cannot find module 'https:\/\/esm\.run\/lodash-es'/);
    expect(result.stdout).not.toMatch(/TS2307: Cannot find module 'https:\/\/esm\.run\/@wcstack\/state'/);
  }, 60_000);

  it("正しいページは exit 0", () => {
    const dir = join(tmp.dir, "clean");
    tmp.write("clean/tsconfig.json", READY_CONFIG);
    tmp.write("clean/index.html", `<wcs-state><script type="module">
export default { count: 0, inc() { this.count++; } };
</script></wcs-state>`);
    const result = runBin(dir, ["-p", "tsconfig.json"]);
    expect(result.stdout + result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 60_000);

  it("不足のある tsconfig は警告し HTML を検査しない。--wcs-defaults なら一時 config で検査し、後始末する", () => {
    const dir = join(tmp.dir, "bare");
    tmp.write("bare/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true }, include: ["src/**/*.ts"] }));
    tmp.write("bare/index.html", PAGE);
    const warned = runBin(dir, ["-p", "tsconfig.json"]);
    expect(warned.stderr).toContain("is missing");
    expect(warned.stdout).not.toContain("TS2551");

    const fixed = runBin(dir, ["--wcs-defaults", "-p", "tsconfig.json"]);
    expect(fixed.stderr).toContain("temporary config");
    expect(fixed.stdout).toMatch(/error TS2551/);
    expect(readdirSync(dir).filter((f) => f.startsWith(".wcs-tsc."))).toEqual([]);
    expect(existsSync(join(dir, "tsconfig.json"))).toBe(true);
  }, 60_000);
});
