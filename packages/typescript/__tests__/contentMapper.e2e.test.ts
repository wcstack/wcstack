// The content mapper under a real TypeScript 7.1 (the `typescript-7` devDependency).
// Needs `npm run build` first: TypeScript runs dist/content-mapper.cjs, the bin runs dist/wcs-tsc.mjs.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { makeTempDir } from "./helpers";

const PACKAGE_ROOT = resolve(__dirname, "..");
const TS7 = join(PACKAGE_ROOT, "node_modules", "typescript-7");
const TS7_TSC = join(TS7, "bin", "tsc");
const MAPPER = join(PACKAGE_ROOT, "dist", "content-mapper.cjs");
const WCS_TSC = join(PACKAGE_ROOT, "dist", "wcs-tsc.mjs");

const tmp = makeTempDir("wcs-mapper-e2e-");
const links: string[] = [];

/** A directory link (a junction on Windows: no privilege needed). */
function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
  links.push(path);
}

afterAll(() => {
  // Remove the links first, so the recursive cleanup never walks into what they point at.
  for (const path of links) {
    try {
      unlinkSync(path);
    } catch {
      rmdirSync(path);
    }
  }
  tmp.cleanup();
});

beforeAll(() => {
  const version = spawnSync(process.execPath, [TS7_TSC, "-v"], { encoding: "utf8" });
  if (version.status !== 0 || !/Version 7\.1/.test(version.stdout)) {
    throw new Error(`TypeScript 7.1 (devDependency typescript-7) does not run — its native binary is an optional dependency; reinstall without --omit=optional:\n${version.stdout}${version.stderr}`);
  }
  if (!existsSync(MAPPER) || !existsSync(WCS_TSC)) throw new Error("run `npm run build` in packages/typescript first");
  link(TS7, join(tmp.dir, "node_modules", "typescript"));
  link(PACKAGE_ROOT, join(tmp.dir, "node_modules", "@wcstack", "typescript"));
});

const MAPPER_ENTRY = { package: "@wcstack/typescript", extensions: [".html"] };
const BASE_OPTIONS = { noEmit: true, target: "esnext", module: "esnext", moduleResolution: "bundler", lib: ["esnext", "dom"], types: [] };

const PAGE = `<!doctype html>
<p>日本語の前置き 🎉</p>
<wcs-state>
  <script type="module">
    import { defineState } from "https://esm.run/@wcstack/state";
    import confetti from "https://esm.run/canvas-confetti";
    export default defineState({
      count: 0,
      items: [{ name: "a" }],
      get first() { return this.items[0].nmae; },
      inc() { this.coutn++; confetti(); },
    });
  </script>
</wcs-state>
`;

// Two blocks declaring the same name, and a block with neither import nor export.
const MULTI = `<wcs-state><script type="module">
const helper = (n = 0) => n * 2;
export default { total: 0, add() { this.total = helper("1"); } };
</script></wcs-state>
<wcs-state mount="other"><script type="module">
const helper = 1;
export default { value: helper };
</script></wcs-state>
<wcs-state mount="bare"><script type="module">
const local = 1;
void local;
</script></wcs-state>
`;

const CLEAN = `<!doctype html>
<wcs-state>
  <script type="module">
    import { defineState } from "https://esm.run/@wcstack/state";
    import confetti from "https://esm.run/canvas-confetti";
    export default defineState({
      count: 0,
      items: [{ name: "a" }],
      get total() { return this.items.length + this.count; },
      inc() { this.count++; confetti(); },
    });
  </script>
</wcs-state>
`;

const BARE = `<wcs-state><script type="module">
const local = 1;
void local;
</script></wcs-state>
`;

/** Write a project under the shared node_modules; returns its directory. */
function site(name: string, tsconfig: object, pages: Record<string, string>): string {
  tmp.write(`${name}/tsconfig.json`, JSON.stringify(tsconfig, null, 2));
  for (const [file, text] of Object.entries(pages)) tmp.write(`${name}/${file}`, text);
  return join(tmp.dir, name);
}

function tsc7(dir: string, args: string[]): { status: number | null; lines: string[] } {
  const result = spawnSync(process.execPath, [TS7_TSC, ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, lines: `${result.stdout}${result.stderr}`.split(/\r?\n/).filter((line) => line.trim() !== "") };
}

/** `file(line,col)` of the first `needle` in `text` (1-based, as tsc prints it). */
function at(file: string, text: string, needle: string): string {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => l.includes(needle));
  return `${file}(${line + 1},${lines[line].indexOf(needle) + 1})`;
}

const EXPECTED_PAGE = [
  `${at("index.html", PAGE, "nmae")}: error TS2339: Property 'nmae' does not exist on type '{ name: string; }'.`,
  `${at("index.html", PAGE, "coutn")}: error TS2551: Property 'coutn' does not exist on type '_WcsThis<{ count: number; items: { name: string; }[]; readonly first: any; inc(): void; }>'. Did you mean 'count'?`,
];

describe("tsc --runExternalCode（TypeScript 7.1）", () => {
  it("<wcs-state> の誤りを HTML の位置で報告する。CDN の import は any、ブロックの無いページは何も出さない", () => {
    const dir = site("basic", { compilerOptions: BASE_OPTIONS, contentMappers: [MAPPER_ENTRY] }, { "index.html": PAGE, "plain.html": "<p>{{ x }}</p>\n" });
    const result = tsc7(dir, ["-p", "tsconfig.json", "--runExternalCode"]);
    expect(result.lines).toEqual(EXPECTED_PAGE);
    expect(result.status).toBe(2);
  });

  it("ブロックはそれぞれ別のモジュール: 同じ名前の宣言も、import / export の無いブロックもページをまたいでぶつからない", () => {
    const dir = site("multi", { compilerOptions: BASE_OPTIONS, contentMappers: [MAPPER_ENTRY] }, { "multi.html": MULTI, "bare1.html": BARE, "bare2.html": BARE });
    expect(tsc7(dir, ["-p", "tsconfig.json", "--runExternalCode"]).lines).toEqual([
      `${at("multi.html", MULTI, '"1"')}: error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`,
    ]);
  });

  it("urlImports: \"error\" なら CDN の import は TS2307", () => {
    const dir = site("urlerror", { compilerOptions: BASE_OPTIONS, contentMappers: [{ ...MAPPER_ENTRY, options: { urlImports: "error" } }] }, { "index.html": CLEAN });
    expect(tsc7(dir, ["-p", "tsconfig.json", "--runExternalCode"]).lines).toEqual([
      `${at("index.html", CLEAN, '"https://esm.run/canvas-confetti"')}: error TS2307: Cannot find module 'https://esm.run/canvas-confetti' or its corresponding type declarations.`,
    ]);
  });

  it("誤ったオプションは tsconfig の位置で wcs1001 / wcs1002", () => {
    const dir = site("badopt", { compilerOptions: BASE_OPTIONS, contentMappers: [{ ...MAPPER_ENTRY, options: { urlImport: "any", stateTagName: "State" } }] }, { "index.html": CLEAN });
    const lines = tsc7(dir, ["-p", "tsconfig.json", "--runExternalCode"]).lines;
    expect(lines.some((line) => /^tsconfig\.json\(\d+,\d+\): error wcs1001: Unknown option 'urlImport'/.test(line))).toBe(true);
    expect(lines.some((line) => /^tsconfig\.json\(\d+,\d+\): error wcs1002: stateTagName must be a custom element name/.test(line))).toBe(true);
  });

  it("--runExternalCode が無ければ TypeScript が断る（TS18068）", () => {
    const dir = site("noflag", { compilerOptions: BASE_OPTIONS, contentMappers: [MAPPER_ENTRY] }, { "index.html": CLEAN });
    expect(tsc7(dir, ["-p", "tsconfig.json"]).lines.join("\n")).toContain("TS18068");
  });

  // docs/typescript-content-mapper.md §4.5: what the mapper adds must not report under any option a project may set.
  const combinations: Record<string, { options: object; packageJson?: object }> = {
    strictest: { options: { ...BASE_OPTIONS, strict: true, noUnusedLocals: true, noUnusedParameters: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noImplicitReturns: true, noPropertyAccessFromIndexSignature: true, noImplicitOverride: true, noFallthroughCasesInSwitch: true } },
    "tsc --init（nodenext・verbatimModuleSyntax・moduleDetection force）": { options: { noEmit: true, module: "nodenext", target: "esnext", types: [], lib: ["esnext", "dom"], strict: true, verbatimModuleSyntax: true, isolatedModules: true, noUncheckedSideEffectImports: true, moduleDetection: "force", skipLibCheck: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true } },
    "nodenext で package.json が type: module": { options: { noEmit: true, module: "nodenext", lib: ["esnext", "dom"], types: [] }, packageJson: { type: "module" } },
    "lib に DOM が無い": { options: { ...BASE_OPTIONS, lib: ["esnext"] } },
    "既定（TypeScript 7 は strict）": { options: { noEmit: true } },
  };
  for (const [name, { options, packageJson }] of Object.entries(combinations)) {
    it(`きれいなページは診断 0: ${name}`, () => {
      const pages: Record<string, string> = { "index.html": CLEAN, "bare.html": BARE };
      if (packageJson !== undefined) pages["package.json"] = JSON.stringify(packageJson);
      const dir = site(`combo-${Object.keys(combinations).indexOf(name)}`, { compilerOptions: options, contentMappers: [MAPPER_ENTRY] }, pages);
      const result = tsc7(dir, ["-p", "tsconfig.json", "--runExternalCode"]);
      expect(result.lines).toEqual([]);
      expect(result.status).toBe(0);
    });
  }
});

describe("wcs-tsc（ビルド済みの bin）を TypeScript 7.1 で", () => {
  it("mapper を名指さない tsconfig にも一時の設定で mapper を足し、同じ診断を出して後始末する", () => {
    const dir = site("wcstsc", { compilerOptions: BASE_OPTIONS }, { "index.html": PAGE });
    const result = spawnSync(process.execPath, [WCS_TSC, "-p", "tsconfig.json"], { cwd: dir, encoding: "utf8" });
    expect(result.stdout.split(/\r?\n/).filter(Boolean)).toEqual(EXPECTED_PAGE);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(["index.html", "tsconfig.json"]);
  });

  it("きれいなページは exit 0。--url-imports=error は CDN の import を TS2307 にする", () => {
    const dir = site("wcstsc-clean", { compilerOptions: BASE_OPTIONS }, { "index.html": CLEAN });
    expect(spawnSync(process.execPath, [WCS_TSC], { cwd: dir, encoding: "utf8" }).status).toBe(0);
    const strict = spawnSync(process.execPath, [WCS_TSC, "--url-imports=error"], { cwd: dir, encoding: "utf8" });
    expect(strict.stdout).toContain("TS2307");
    expect(strict.status).toBe(2);
  });

  it("noImplicitThis を切った設定は警告し、--wcs-defaults なら足して検査する", () => {
    const dir = site("wcstsc-defaults", { compilerOptions: { ...BASE_OPTIONS, strict: false } }, { "index.html": PAGE });
    const warned = spawnSync(process.execPath, [WCS_TSC], { cwd: dir, encoding: "utf8" });
    expect(warned.stderr).toContain("is missing compilerOptions.noImplicitThis: true");
    const fixed = spawnSync(process.execPath, [WCS_TSC, "--wcs-defaults"], { cwd: dir, encoding: "utf8" });
    expect(fixed.stderr).toContain("running with a temporary config that adds compilerOptions.noImplicitThis: true");
    expect(fixed.stdout).toContain("TS2551");
    expect(readdirSync(dir).sort()).toEqual(["index.html", "tsconfig.json"]);
  });
});

describe("dist/content-mapper.cjs を直接起動する", () => {
  it("標準入出力で initialize → openProject → transform に答え、stdin が閉じたら 0 で終わる", async () => {
    const child = spawn(process.execPath, [MAPPER], { stdio: ["pipe", "pipe", "pipe"] });
    const send = (message: object): void => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
    };
    let output = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer) => { output = Buffer.concat([output, chunk]); });
    const exited = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
    send({ id: 1, method: "initialize", params: { positionEncodings: ["utf-8", "utf-16"] } });
    send({ id: 2, method: "openProject", params: { configFileName: "/p/tsconfig.json", projectHandle: "h", compilerOptions: {} } });
    send({ id: 3, method: "transform", params: { fileName: "/p/index.html", content: CLEAN, projectHandle: "h" } });
    child.stdin.end();
    expect(await exited).toBe(0);
    const messages: { id: number; result: Record<string, unknown> }[] = [];
    for (let rest = output; rest.length > 0; ) {
      const headerEnd = rest.indexOf("\r\n\r\n");
      const length = Number(/Content-Length: (\d+)/.exec(rest.subarray(0, headerEnd).toString("ascii"))![1]);
      messages.push(JSON.parse(rest.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8")));
      rest = rest.subarray(headerEnd + 4 + length);
    }
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(messages[0].result).toEqual({ positionEncoding: "utf-16", diagnosticSource: "wcs" });
    expect(messages[1].result).toEqual({});
    expect(messages[2].result).toMatchObject({ text: "", extension: ".mts", mappings: [] });
    expect((messages[2].result.supplemental as unknown[]).length).toBe(1);
  });
});
