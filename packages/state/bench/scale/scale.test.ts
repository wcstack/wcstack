/**
 * scale.test.ts — the scale verification in happy-dom, from src
 * (docs/state-engine-rewrite/scale-verification.ja.md §4). Not part of the unit suite:
 *   npx vitest run --config bench/vitest.scale.config.ts [-t L1]
 * Every probe of probes.mjs runs here with the engine's work counted (Engine.prototype methods,
 * wrapped only around one write), the DOM changes recorded, the tables read and the heap measured
 * after a GC (the config passes --expose-gc). The records go to $OUT (default: the OS temp
 * directory) as happy-dom.json; bench/scale/report.mjs turns them into tables.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapState, getBindingsReady, installFeatures, Engine } from "../../src/index";
import { ALL_FEATURES } from "../../src/features/all";
import { probes } from "./probes.mjs";
import { runProbe } from "./run.mjs";

const COUNTED = ["enqueue", "applyBinding", "evalGetter", "visitGetter", "forSubtree", "rowRemoved", "indexChanged"] as const;
const microtask = () => new Promise<void>((r) => queueMicrotask(r));
let seq = 0;

/** Runs `fn` with the counted Engine methods wrapped; their call counts. */
async function counting(fn: () => Promise<void>): Promise<Record<string, number>> {
  const proto = Engine.prototype as any;
  const counts: Record<string, number> = {};
  const originals = COUNTED.map((name) => [name, proto[name]] as const);
  for (const [name, orig] of originals) {
    counts[name] = 0;
    proto[name] = function (this: unknown, ...a: unknown[]) {
      counts[name]++;
      return orig.apply(this, a);
    };
  }
  try {
    await fn();
  } finally {
    for (const [name, orig] of originals) proto[name] = orig;
  }
  return counts;
}

function summarize(records: MutationRecord[]) {
  let added = 0;
  let removed = 0;
  let attributes = 0;
  let text = 0;
  for (const r of records) {
    added += r.addedNodes.length;
    removed += r.removedNodes.length;
    if (r.type === "attributes") attributes++;
    if (r.type === "characterData") text++;
  }
  return { added, removed, attributes, text };
}

/** Waits for every `tag` component under `root` (and under theirs) to be bound. */
async function settleTag(root: ParentNode, tag: string): Promise<void> {
  for (const el of Array.from(root.querySelectorAll(tag))) {
    const sr = (el as HTMLElement).shadowRoot;
    if (sr === null) continue;
    const st = sr.querySelector("wcs-state") as any;
    if (st) await st.connectedCallbackPromise;
    await getBindingsReady(sr);
    await new Promise((r) => setTimeout(r, 0));
    await settleTag(sr, tag);
  }
}

const env = {
  name: "happy-dom",
  async page(built: { html: string; state: Record<string, any>; before?: string; ready?: string }) {
    const host = document.createElement(`scale-page-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `${built.before ?? ""}<wcs-state></wcs-state>${built.html}`;
    const el = root.querySelector("wcs-state:not([mount])") as any;
    el.setInitialState(built.state);
    const t0 = performance.now();
    document.body.appendChild(host);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    if (built.ready) await settleTag(root, built.ready);
    const mountMs = performance.now() - t0;
    // the records a delivery (a microtask after the drain) hands over before timed() reads them; only
    // while timing — an untimed write's records would hold the nodes it removed
    const seen: MutationRecord[] = [];
    let recording = false;
    const observer = new MutationObserver((rs) => { if (recording) seen.push(...rs); });
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    const write = async (fn: (s: any) => void) => {
      el.createState("writable", fn);
      await microtask();
    };
    return {
      root, el, built, mountMs,
      write,
      async timed(fn: (s: any) => void) {
        observer.takeRecords();
        seen.length = 0;
        recording = true;
        const t = performance.now();
        el.createState("writable", fn);
        await microtask();
        const ms = performance.now() - t;
        recording = false;
        const dom = summarize([...seen, ...observer.takeRecords()]);
        seen.length = 0;
        return { ms, dom };
      },
      counted: (fn: (s: any) => void) => counting(() => write(fn)),
      stats() {
        const e = el.engine;
        const pats = [...e.patterns.all()];
        let rows = 0;
        const walk = (l: any): void => {
          for (const r of l.rows) {
            rows++;
            if (r.children !== null) for (const c of r.children.values()) walk(c);
          }
        };
        for (const l of e.rootLists.values()) walk(l);
        let bindings = 0;
        for (const s of e.rootBindings.values()) bindings += s.size;
        return { patterns: pats.length, sources: pats.reduce((a: number, p: any) => a + p.sources.length, 0), rootBindings: bindings, rows };
      },
      dispose() {
        observer.disconnect();
        host.remove();
      },
    };
  },
  async gc() {
    const gc = (globalThis as any).gc as (() => void) | undefined;
    for (let i = 0; i < 3; i++) {
      gc?.();
      await new Promise((r) => setTimeout(r, 0));
    }
  },
  heap(): number | null {
    return (globalThis as any).gc ? process.memoryUsage().heapUsed : null;
  },
  captureErrors() {
    const msgs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { msgs.push(a.map(String).join(" ")); });
    return { stop: () => { spy.mockRestore(); return msgs; } };
  },
};

const results: any[] = [];

beforeAll(() => {
  installFeatures(ALL_FEATURES);
  bootstrapState();
});

afterAll(() => {
  const out = process.env.OUT ?? join(tmpdir(), "wcs-scale");
  mkdirSync(out, { recursive: true });
  const file = join(out, "happy-dom.json");
  writeFileSync(file, JSON.stringify({ env: "happy-dom", date: new Date().toISOString(), results }, null, 2));
  process.stdout.write(`\n[scale] ${results.length} probes → ${file}\n`);
});

const fmt = (ms: number | null) => (ms == null ? "-" : ms < 1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(2)} ms`);

describe("規模の検証（happy-dom）", () => {
  for (const probe of probes) {
    it(`${probe.id} ${probe.title}`, async () => {
      const r = await runProbe(probe, env);
      results.push(r);
      const lines = [`\n### ${r.id} ${r.title} — ${r.pass ? "PASS" : "FAIL"}`];
      if (r.points) {
        for (const p of r.points) {
          lines.push(`  n=${p.n} ${fmt(p.ms)}${p.counts ? ` counts=${JSON.stringify(p.counts)}` : ""}${p.dom ? ` dom=${JSON.stringify(p.dom)}` : ""}${p.stats ? ` stats=${JSON.stringify(p.stats)}` : ""}${p.heap != null ? ` heap=${(p.heap / 1048576).toFixed(1)}MB` : ""}`);
        }
        if (r.k != null) lines.push(`  k=${r.k.toFixed(2)}`);
        if (r.heapPerUnit != null) lines.push(`  heap/unit=${Math.round(r.heapPerUnit)} B`);
      } else {
        for (const row of r.rows) lines.push(`  ${JSON.stringify(row)}`);
        if (r.firstMismatch) lines.push(`  first mismatch: ${JSON.stringify(r.firstMismatch)}`);
      }
      for (const c of r.checks) lines.push(`  ${c.pass ? "ok" : c.soft ? "warn" : "NG"} ${c.name}${c.detail !== undefined ? ` ${typeof c.detail === "string" ? c.detail : JSON.stringify(c.detail)}` : ""}`);
      process.stdout.write(`${lines.join("\n")}\n`);
      expect(r.pass, JSON.stringify(r.checks)).toBe(true);
    }, 600000);
  }
});
