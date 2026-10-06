/**
 * Runs one probe of probes.mjs in an environment and returns its record (sizes, medians, work
 * counts, DOM changes, tables, heap, the growth exponent and the verdict). Shared by the happy-dom
 * runner (scale.test.ts) and the Chromium one (browser.mjs, inside the page).
 *
 * An environment:
 *   name                        "happy-dom" | "chromium"
 *   page({ html, state, before, ready }) → Promise<Page>
 *   gc() → Promise<void>         a full collection where the runtime exposes one
 *   heap() → number | null       bytes in use after gc(), or null
 *   captureErrors() → { stop() → string[] }   console.error while it runs
 * A page:
 *   root, mountMs, built (what build() returned)
 *   write(fn) → Promise<void>    one createState("writable", fn) and its drain
 *   timed(fn) → Promise<{ ms, dom }>   the same, measured (dom: the DOM changes it made)
 *   counted?(fn) → Promise<counts>  the same, with the engine's work counted (happy-dom only)
 *   stats() → object | null      the engine's tables (happy-dom)
 *   dispose()
 */

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s[s.length >> 1];
};

/**
 * The mean of the middle half: as robust as the median against a stray sample, and it does not
 * snap to the clock's step (a browser clamps performance.now(): 5 µs isolated, 100 µs otherwise).
 */
export const middleMean = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length < 4) return median(s);
  const mid = s.slice(s.length >> 2, s.length - (s.length >> 2));
  return mid.reduce((a, b) => a + b, 0) / mid.length;
};

/** Least-squares slope of log(t) over log(n): cost ~ n^k. */
export function exponent(ns, ts) {
  const pts = ns.map((n, i) => [Math.log(n), Math.log(Math.max(ts[i], 1e-6))]);
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = () => new Promise((r) => setTimeout(r, 0));

/** The checks of `expect` that this environment can make; each { name, pass, detail }. */
function verdicts(probe, points) {
  const ex = probe.expect ?? {};
  const out = [];
  const counted = points.every((p) => p.counts != null);
  if (ex.counts === "constant" && counted) {
    const first = points[0].counts;
    out.push({ name: "counts", pass: points.every((p) => same(p.counts, first)), detail: first });
  } else if (ex.counts && typeof ex.counts === "object" && counted) {
    const bad = [];
    for (const p of points) {
      for (const [k, f] of Object.entries(ex.counts)) if (p.counts[k] !== f(p.n)) bad.push(`${k}@${p.n}=${p.counts[k]} (expected ${f(p.n)})`);
    }
    out.push({ name: "counts", pass: bad.length === 0, detail: bad.join("; ") || "as expected" });
  }
  if (ex.dom === "constant" && points.every((p) => p.dom != null)) {
    const first = points[0].dom;
    out.push({ name: "dom", pass: points.every((p) => same(p.dom, first)), detail: first });
  } else if (ex.dom && typeof ex.dom === "object" && points.every((p) => p.dom != null)) {
    const bad = [];
    for (const p of points) {
      for (const [k, f] of Object.entries(ex.dom)) if (p.dom[k] !== f(p.n)) bad.push(`${k}@${p.n}=${p.dom[k]} (expected ${f(p.n)})`);
    }
    out.push({ name: "dom", pass: bad.length === 0, detail: bad.join("; ") || "as expected" });
  }
  if (ex.stats === "constant" && points.every((p) => p.stats != null)) {
    const first = points[0].stats;
    out.push({ name: "stats", pass: points.every((p) => same(p.stats, first)), detail: first });
  }
  return out;
}

async function settle(page) {
  for (let i = 0; i < 2; i++) await tick();
  return page;
}

async function runWrite(probe, env) {
  const points = [];
  for (const n of probe.sizes) {
    const built = probe.build(n);
    const page = await env.page(built);
    await settle(page);
    const reps = probe.reps ?? 100;
    const warmup = probe.warmup ?? Math.min(10, reps);
    const ts = [];
    let last = null;
    for (let i = -warmup; i < reps; i++) {
      let data;
      if (probe.reset) await page.write((s) => { data = probe.reset(s, i, n, page); });
      const r = await page.timed((s) => probe.write(s, i, n, page, data));
      if (i >= 0) {
        ts.push(r.ms);
        last = r;
      }
    }
    // the work of one more write, counted apart from the timed ones (the counters wrap the engine)
    let counts = null;
    if (page.counted) {
      let data;
      if (probe.reset) await page.write((s) => { data = probe.reset(s, reps, n, page); });
      counts = await page.counted((s) => probe.write(s, reps, n, page, data));
    }
    points.push({ n, ms: middleMean(ts), counts, dom: last.dom, mountMs: page.mountMs });
    page.dispose();
    await tick();
  }
  return points;
}

async function runMount(probe, env) {
  const points = [];
  for (const n of probe.sizes) {
    const ts = [];
    for (let r = 0; r < (probe.reps ?? 3); r++) {
      const page = await env.page(probe.build(n));
      ts.push(page.mountMs);
      page.dispose();
      await tick();
    }
    points.push({ n, ms: median(ts) });
  }
  return points;
}

async function runCycles(probe, env) {
  const points = [];
  const page = await env.page(probe.build());
  await settle(page);
  let done = 0;
  const t0 = performance.now();
  for (const k of probe.sizes) {
    while (done < k) {
      const i = done++;
      await page.write((s) => probe.cycle(s, i, page));
    }
    await settle(page);
    await env.gc();
    points.push({ n: k, stats: page.stats(), heap: env.heap(), ms: (performance.now() - t0) / k });
  }
  page.dispose();
  return points;
}

async function runPages(probe, env) {
  const points = [];
  let done = 0;
  for (const k of probe.sizes) {
    while (done < k) {
      done++;
      const page = await env.page(probe.build());
      await settle(page);
      page.dispose();
      await tick();
    }
    await env.gc();
    points.push({ n: k, heap: env.heap() });
  }
  return points;
}

/** Heap growth per unit between the first and the last checkpoint (bytes), or null. */
function heapSlope(points) {
  const a = points[0];
  const b = points[points.length - 1];
  if (a.heap == null || b.heap == null || b.n === a.n) return null;
  return (b.heap - a.heap) / (b.n - a.n);
}

export async function runProbe(probe, env) {
  const base = { id: probe.id, property: probe.property, title: probe.title, env: env.name };
  if (probe.kind === "custom") {
    const r = await probe.run(env);
    return { ...base, kind: "custom", rows: r.rows, pass: r.pass, firstMismatch: r.firstMismatch ?? null, checks: [{ name: "custom", pass: r.pass }] };
  }
  const run = { write: runWrite, mount: runMount, cycles: runCycles, pages: runPages }[probe.kind];
  const points = await run(probe, env);
  const checks = verdicts(probe, points);
  const timed = points.every((p) => p.ms != null) && (probe.kind === "write" || probe.kind === "mount");
  const k = timed ? exponent(points.map((p) => p.n), points.map((p) => p.ms)) : null;
  // the time is evidence, the counts are the verdict: k only fails where nothing was counted
  if (k !== null && probe.expect?.k != null) {
    checks.push({ name: "k", pass: k <= probe.expect.k, soft: checks.some((c) => c.name === "counts"), detail: `k = ${k.toFixed(2)} (≤ ${probe.expect.k})` });
  }
  const slope = probe.kind === "cycles" || probe.kind === "pages" ? heapSlope(points) : null;
  const pass = checks.filter((c) => !c.soft).every((c) => c.pass);
  return { ...base, kind: probe.kind, points, k, heapPerUnit: slope, checks, pass };
}
