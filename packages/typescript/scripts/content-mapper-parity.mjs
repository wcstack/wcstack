// content-mapper-parity.mjs — the content mapper against what it replaces, over the repository.
//
//   node packages/typescript/scripts/content-mapper-parity.mjs
//
// 1. Parity: TypeScript 7.1 (`tsc --runExternalCode`, the `typescript-7` devDependency)
//    with this package's content mapper over every example page has to report exactly
//    what `wcs-tsc` on TypeScript 5.9 reports (examples/tsconfig.wcs-tsc.json).
// 2. Language server: `tsc --lsp --stdio` answers hover and diagnostics on a page when
//    the client passes `initializationOptions: { runExternalCode: true }`, and nothing
//    without it.
//
// Experimental and non-gating in CI, like the wcs-tsc step (docs/typescript-content-mapper.md §9).
// Needs `npm ci` and `npm run build` in packages/typescript. Exit code 0 when both hold.
// WCS_TS7_TSC=<path to another TypeScript 7's bin/tsc> runs it against that build (a nightly).

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PACKAGE_ROOT, "..", "..");
const TS7_TSC = process.env.WCS_TS7_TSC ?? join(PACKAGE_ROOT, "node_modules", "typescript-7", "bin", "tsc");
const WCS_TSC = join(PACKAGE_ROOT, "dist", "wcs-tsc.mjs");
const EXAMPLES_CONFIG = join(REPO, "examples", "tsconfig.wcs-tsc.json");

const posix = (path) => path.replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "wcs-mapper-parity-"));
const links = [];

/** A directory link (a junction on Windows). Removed before the work directory, never walked into. */
function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
  links.push(path);
}

function cleanup() {
  for (const path of links.splice(0)) {
    try {
      unlinkSync(path);
    } catch {
      rmdirSync(path);
    }
  }
  rmSync(work, { recursive: true, force: true });
}

/** `file(line,col): error TSxxxx: …` lines with the file made relative to the repository. */
function diagnostics(output, cwd) {
  return output
    .split(/\r?\n/)
    .filter((line) => /^\S.*\(\d+,\d+\): error /.test(line))
    .map((line) => {
      const at = line.indexOf("(");
      return `${posix(relative(REPO, resolve(cwd, line.slice(0, at))))}${line.slice(at)}`;
    })
    .sort();
}

function parity() {
  const before = spawnSync(process.execPath, [WCS_TSC, "-p", EXAMPLES_CONFIG], { cwd: REPO, encoding: "utf8" });
  const expected = diagnostics(before.stdout, REPO);

  // A project outside the repository that reads the same pages: TypeScript resolves the
  // mapper package from the config's directory.
  const project = join(work, "parity");
  link(PACKAGE_ROOT, join(project, "node_modules", "@wcstack", "typescript"));
  const examples = posix(join(REPO, "examples"));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    extends: posix(EXAMPLES_CONFIG),
    include: [`${examples}/**/*.html`],
    exclude: [`${examples}/**/node_modules/**`, `${examples}/**/dist/**`],
    contentMappers: [{ package: "@wcstack/typescript", extensions: [".html"] }],
  }, null, 2));
  const after = spawnSync(process.execPath, [TS7_TSC, "-p", "tsconfig.json", "--runExternalCode"], { cwd: project, encoding: "utf8" });
  const actual = diagnostics(`${after.stdout}${after.stderr}`, project);

  const missing = expected.filter((line) => !actual.includes(line));
  const extra = actual.filter((line) => !expected.includes(line));
  console.log(`parity: wcs-tsc on TypeScript 5.9 ${expected.length} diagnostic(s), the content mapper on ${spawnSync(process.execPath, [TS7_TSC, "-v"], { encoding: "utf8" }).stdout.trim()} ${actual.length}`);
  for (const line of missing) console.log(`  only 5.9: ${line}`);
  for (const line of extra) console.log(`  only 7.1: ${line}`);
  if (expected.length === 0) console.log("  wcs-tsc reported nothing — is packages/typescript built?");
  return expected.length > 0 && missing.length === 0 && extra.length === 0;
}

/** The page the language server is asked about: line 2 has `count` (hover) and the typo `coutn`. */
const PAGE = '<wcs-state><script type="module">\nexport default { count: 0, inc() { this.coutn++; } };\n</script></wcs-state>\n';

/** A minimal LSP client over `tsc --lsp --stdio`. */
function languageServer(cwd) {
  const child = spawn(process.execPath, [TS7_TSC, "--lsp", "--stdio"], { cwd, stdio: ["pipe", "pipe", "ignore"] });
  const exited = new Promise((done) => child.on("exit", done));
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString("ascii"))[1]);
      if (buffer.length < end + 4 + length) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8"));
      buffer = buffer.subarray(end + 4 + length);
      if (message.id !== undefined && message.method === undefined) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      } else if (message.id !== undefined) {
        // a request from the server (workspace/configuration, registrations …)
        const result = message.method === "workspace/configuration" ? (message.params?.items ?? []).map(() => null) : null;
        send({ id: message.id, result });
      }
    }
  });
  const send = (message) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  };
  const request = (method, params) => new Promise((done) => {
    const id = nextId++;
    pending.set(id, done);
    send({ id, method, params });
  });
  const notify = (method, params) => send({ method, params });
  // Wait for the server (and its mapper) to exit: Windows cannot remove a directory a process runs in.
  const close = async () => {
    await Promise.race([request("shutdown", null), new Promise((done) => setTimeout(done, 2000))]);
    notify("exit", null);
    const timer = setTimeout(() => child.kill(), 2000);
    await exited;
    clearTimeout(timer);
  };
  return { request, notify, close };
}

async function lspAnswers(runExternalCode) {
  const project = join(work, `lsp-${runExternalCode}`);
  link(PACKAGE_ROOT, join(project, "node_modules", "@wcstack", "typescript"));
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: { noEmit: true, target: "esnext", module: "esnext", moduleResolution: "bundler", lib: ["esnext", "dom"] },
    contentMappers: [{ package: "@wcstack/typescript", extensions: [".html"] }],
  }));
  const page = PAGE;
  writeFileSync(join(project, "index.html"), page);
  writeFileSync(join(project, "main.ts"), "export const x = 1;\n");
  const server = languageServer(project);
  const root = pathToFileURL(project).href;
  await server.request("initialize", {
    processId: process.pid,
    rootUri: root,
    workspaceFolders: [{ uri: root, name: "lsp" }],
    initializationOptions: runExternalCode ? { runExternalCode: true } : {},
    capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { hover: { contentFormat: ["plaintext"] }, diagnostic: {} }, workspace: { configuration: true, workspaceFolders: true } },
  });
  server.notify("initialized", {});
  const uri = pathToFileURL(join(project, "index.html")).href;
  // A .ts file first, so the server finds the tsconfig; then the page.
  server.notify("textDocument/didOpen", { textDocument: { uri: pathToFileURL(join(project, "main.ts")).href, languageId: "typescript", version: 1, text: "export const x = 1;\n" } });
  server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "html", version: 1, text: page } });
  let items = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    const pulled = await server.request("textDocument/diagnostic", { textDocument: { uri } });
    items = pulled.result?.items ?? [];
    if (items.length > 0 || !runExternalCode) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  const hover = await server.request("textDocument/hover", { textDocument: { uri }, position: { line: 1, character: PAGE.split("\n")[1].indexOf("count") } });
  await server.close();
  return { diagnostics: items.map((d) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`), hover: hover.result ?? null };
}

async function languageServerSmoke() {
  const on = await lspAnswers(true);
  const off = await lspAnswers(false);
  const typo = `2:${PAGE.split("\n")[1].indexOf("coutn") + 1} `;
  const onOk = on.diagnostics.some((d) => d.startsWith(typo) && d.includes("coutn")) && on.hover !== null;
  const offOk = off.diagnostics.length === 0 && off.hover === null;
  console.log(`language server: with runExternalCode ${onOk ? "answers" : "DOES NOT answer"} (${on.diagnostics.join(" | ") || "no diagnostics"}; hover ${on.hover === null ? "none" : "yes"})`);
  console.log(`language server: without it ${offOk ? "stays silent" : "ANSWERS"} (${off.diagnostics.join(" | ") || "no diagnostics"}; hover ${off.hover === null ? "none" : "yes"})`);
  return onOk && offOk;
}

let ok = false;
try {
  readFileSync(TS7_TSC);
  const parityOk = parity();
  const lspOk = await languageServerSmoke();
  ok = parityOk && lspOk;
} finally {
  cleanup();
}
console.log(ok ? "content mapper: OK" : "content mapper: FAILED");
process.exit(ok ? 0 : 1);
