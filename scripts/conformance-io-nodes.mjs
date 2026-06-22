// wcstack Async IO-Node authoring-invariant conformance lint.
//
// Statically checks each IO-node package's Core/Shell source against the
// normative invariants in docs/async-io-node-guidelines.md (RFC-2119, §0 TL;DR
// + §10 review checklist). This is a heuristic SOURCE lint that flags candidate
// violations for review — it is NOT a runtime test. Protocol-level {1P} producer
// conformance (declaration validity + bindability) is checked separately by the
// wc-bindable-protocol runner (conformance-wcstack-io.mjs in that repo).
//
// Run:  node scripts/conformance-io-nodes.mjs
//
// Tiers:
//   MUST   (hard correctness) -> fail   — never-throw, call-time API resolution,
//          stale-async guard, Core/Shell structure, DOM-independence.
//   SHOULD (skeleton completeness; §4 permits documented deviations) -> warn —
//          observe()/dispose(), ready promise, SSR connectedCallbackPromise.
// Behavioral invariants (same-value guard §3.3, observe() idempotency §3.5) are
// NOT statically checkable here; each package's vitest suite covers them.
//
// Exit 1 if any MUST rule fails.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKGDIR = join(ROOT, "packages");

const IO_NODES = [
  "broadcast", "camera", "clipboard", "debounce", "defined", "fetch",
  "geolocation", "intersection", "notification", "permission", "resize",
  "speech", "sse", "storage", "timer", "upload", "wakelock", "websocket", "worker",
];

// Web-API globals that MUST be resolved at call time (§3.7), not cached in a
// class-field initializer. Only the RHS of a field `=` is inspected, so a type
// annotation (`_ws: WebSocket | null`) or a call-time `new WebSocket()` inside a
// method is not flagged.
const WEB_API_GLOBALS = [
  "WebSocket", "EventSource", "Notification", "MediaRecorder", "MediaStream",
  "BroadcastChannel", "Worker", "SharedWorker", "IntersectionObserver",
  "ResizeObserver", "SpeechSynthesisUtterance", "SpeechRecognition",
  "speechSynthesis", "navigator", "PermissionStatus", "FileReader",
  "ServiceWorkerRegistration", "WakeLock", "Geolocation",
];

// ---- comment/string-aware blanker (preserves line numbers) ----
// Replaces comment characters with spaces so regex content scans don't match the
// word "throw" / "document" etc. inside prose; keeps string literals intact.
function blankComments(src) {
  let out = "", i = 0, st = "code";
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (st === "code") {
      if (c === "/" && d === "/") { out += "  "; i += 2; st = "line"; continue; }
      if (c === "/" && d === "*") { out += "  "; i += 2; st = "block"; continue; }
      if (c === "'" || c === '"' || c === "`") { out += c; i++; st = c; continue; }
      out += c; i++; continue;
    }
    if (st === "line") { if (c === "\n") { out += "\n"; st = "code"; } else out += " "; i++; continue; }
    if (st === "block") {
      if (c === "*" && d === "/") { out += "  "; i += 2; st = "code"; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    // inside a string literal (st is the quote char)
    if (c === "\\") { out += c + (d ?? ""); i += 2; continue; }
    if (c === st) { out += c; i++; st = "code"; continue; }
    out += c; i++;
  }
  return out;
}

const linesMatching = (code, orig, re) => {
  const codeLines = code.split("\n"), origLines = orig.split("\n");
  const out = [];
  for (let i = 0; i < codeLines.length; i++) {
    if (re.test(codeLines[i])) out.push({ line: i + 1, text: (origLines[i] || "").trim() });
  }
  return out;
};
const has = (code, re) => re.test(code);

function fieldInitGlobalRefs(code, orig) {
  const apiAlt = WEB_API_GLOBALS.join("|");
  const fieldRe = /^\s+(?:private|protected|public|readonly|static)\b[^=\n]*=\s*(.+?);?\s*$/;
  const rhsRe = new RegExp(`\\b(?:new\\s+)?(${apiAlt})\\b`);
  const codeLines = code.split("\n"), origLines = orig.split("\n");
  const hits = [];
  for (let i = 0; i < codeLines.length; i++) {
    const m = fieldRe.exec(codeLines[i]);
    if (m && rhsRe.test(m[1])) hits.push({ line: i + 1, api: rhsRe.exec(m[1])[1], text: (origLines[i] || "").trim() });
  }
  return hits;
}

// ---- rules ----
function checkCore(orig) {
  const code = blankComments(orig);
  const r = {};
  r["extends EventTarget"] = { tier: "MUST", pass: has(code, /class\s+\w+Core\s+extends\s+EventTarget\b/) };
  r["static wcBindable"] = { tier: "MUST", pass: has(code, /static\s+wcBindable\b/) };

  const dom = linesMatching(code, orig, /\bdocument\.|\bHTMLElement\b/);
  r["DOM-independent"] = { tier: "MUST", pass: dom.length === 0, lines: dom };

  const thr = linesMatching(code, orig, /\bthrow\b|\braiseError\s*\(/);
  r["never-throw"] = { tier: "MUST", pass: thr.length === 0, lines: thr };

  const isAsync = has(code, /\basync\b|\bawait\b|\.then\s*\(|:\s*Promise<|new\s+Promise\b/);
  const guard = has(code, /\b_\w*[Gg]en\b|AbortController|AbortSignal|\bgeneration\b/);
  r["stale-async guard"] = isAsync
    ? { tier: "MUST", pass: guard, note: guard ? undefined : "async work but no _gen / AbortController" }
    : { tier: "MUST", na: true, note: "no async work" };

  const refs = fieldInitGlobalRefs(code, orig);
  r["call-time API resolution"] = { tier: "MUST", pass: refs.length === 0, lines: refs.map((h) => ({ line: h.line, text: `${h.api} cached: ${h.text}` })) };

  // SHOULD / skeleton-completeness
  const obs = has(code, /\bobserve\s*\(/), dis = has(code, /\bdispose\s*\(/);
  const alt = has(code, /\bconnect\s*\(/) && has(code, /\bclose\s*\(/);
  r["observe()/dispose()"] = (obs && dis)
    ? { tier: "SHOULD", pass: true }
    : { tier: "SHOULD", pass: false, note: alt ? "uses connect()/close() instead" : "missing observe()/dispose()" };
  r["ready promise (SSR)"] = { tier: "SHOULD", pass: has(code, /\bget\s+ready\b|_ready\b/) };
  return r;
}

function checkShell(orig) {
  const code = blankComments(orig);
  const r = {};
  const ext = /class\s+\w+\s+extends\s+(\w+)/.exec(code);
  const base = ext ? ext[1] : null;
  const isSubclass = base && base !== "HTMLElement" && /^[A-Z]/.test(base);
  r["extends HTMLElement"] = isSubclass
    ? { tier: "MUST", pass: true, note: `subclass of ${base}` }
    : { tier: "MUST", pass: base === "HTMLElement" };
  r["static wcBindable"] = { tier: "MUST", pass: has(code, /static\s+wcBindable\b/) };
  r["wraps new <Name>Core(this)"] = isSubclass
    ? { tier: "MUST", pass: true, note: "inherited from base shell" }
    : { tier: "MUST", pass: has(code, /new\s+\w+Core\s*\([^)]*\bthis\b[^)]*\)/) };
  // SHOULD / SSR
  r["hasConnectedCallbackPromise"] = { tier: "SHOULD", pass: has(code, /static\s+hasConnectedCallbackPromise\s*=\s*true/) };
  r["connectedCallbackPromise"] = { tier: "SHOULD", pass: has(code, /connectedCallbackPromise/) };
  return r;
}

// ---- run ----
const tsFiles = (dir) => existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f)) : [];

let mustFail = 0, shouldWarn = 0, files = 0;
const rows = [], findings = [];

for (const pkg of IO_NODES) {
  const cores = tsFiles(join(PKGDIR, pkg, "src", "core"));
  const shells = tsFiles(join(PKGDIR, pkg, "src", "components"))
    .filter((f) => /static\s+wcBindable\b/.test(blankComments(readFileSync(f, "utf8"))));

  const units = [];
  for (const f of cores) units.push({ kind: "Core", name: basename(f), rules: checkCore(readFileSync(f, "utf8")) });
  for (const f of shells) units.push({ kind: "Shell", name: basename(f), rules: checkShell(readFileSync(f, "utf8")) });

  for (const u of units) {
    files++;
    const flags = [];
    for (const [name, res] of Object.entries(u.rules)) {
      if (res.na) { flags.push("·"); continue; }
      if (res.pass) { flags.push("✓"); continue; }
      if (res.tier === "MUST") { flags.push("✗"); mustFail++; findings.push({ pkg, unit: u.name, sev: "MUST", name, res }); }
      else { flags.push("!"); shouldWarn++; findings.push({ pkg, unit: u.name, sev: "SHOULD", name, res }); }
    }
    rows.push({ pkg, kind: u.kind, name: u.name, flags });
  }
}

// ---- print ----
console.log("\n=== wcstack Async IO-Node authoring-invariant conformance lint ===");
console.log("(source: docs/async-io-node-guidelines.md  ·  ✓ pass  ✗ MUST-fail  ! SHOULD-warn  · n/a)\n");
console.log("Core  rules:  1 extends EventTarget · 2 static wcBindable · 3 DOM-independent · 4 never-throw · 5 stale-async guard · 6 call-time API · 7 observe/dispose · 8 ready");
console.log("Shell rules:  1 extends HTMLElement · 2 static wcBindable · 3 wraps new Core(this) · 4 hasConnectedCallbackPromise · 5 connectedCallbackPromise\n");
for (const r of rows) {
  console.log(`${r.pkg.padEnd(13)} ${r.kind.padEnd(5)} ${r.name.padEnd(22)} ${r.flags.join(" ")}`);
}

if (findings.length) {
  console.log("\n--- Findings ---");
  for (const f of findings) {
    const where = f.res.lines && f.res.lines.length ? `  @ ${f.res.lines.slice(0, 5).map((l) => l.line).join(", ")}` : "";
    const note = f.res.note ? ` — ${f.res.note}` : "";
    console.log(`  [${f.sev}] ${f.pkg}/${f.unit}: ${f.name}${note}${where}`);
  }
}

console.log("\n" + "-".repeat(72));
console.log(`Files checked: ${files}  |  MUST-fail: ${mustFail}  |  SHOULD-warn: ${shouldWarn}`);
if (mustFail > 0) process.exitCode = 1;
