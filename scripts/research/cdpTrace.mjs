// CDP tracing around one timed operation, for the next-major survey harnesses. The page marks
// the window with performance.mark('wcs-op-start' / 'wcs-op-end'); the trace is filtered to
// the renderer thread that carries those marks and to events inside the window, and the
// complete ('X') events are rolled up by name as self time (children subtracted), so Layout,
// style recalculation, GC and script execution can be compared between harness conditions.
export const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8', 'v8.execute', 'disabled-by-default-v8.gc'];

/** `extraCategories` adds to the default set (e.g. 'blink' and the timeline stack category for the blink audit). */
export async function startTrace(page, extraCategories = []) {
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', e => events.push(...e.value));
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: [...CATEGORIES, ...extraCategories], recordMode: 'recordContinuously' }, transferMode: 'ReportEvents' });
  return { cdp, events };
}

export async function stopTrace({ cdp, events }) {
  const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await done;
  await cdp.detach();
  return events;
}

/** Roll up the events between the two marks on the marks' thread. Times in ms. */
export function summarize(events, startMark = 'wcs-op-start', endMark = 'wcs-op-end') {
  const marks = events.filter(e => e.cat?.includes('blink.user_timing') && (e.name === startMark || e.name === endMark));
  const start = marks.find(e => e.name === startMark);
  const end = marks.filter(e => e.name === endMark).find(e => start && e.ts >= start.ts);
  if (!start || !end) return { error: 'marks not found', marks: marks.length };
  const inWindow = events.filter(e => e.ph === 'X' && e.pid === start.pid && e.tid === start.tid && e.ts >= start.ts && e.ts + (e.dur ?? 0) <= end.ts + 1)
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const self = new Map();
  const count = new Map();
  const stack = [];
  for (const e of inWindow) {
    const dur = e.dur ?? 0;
    while (stack.length && stack.at(-1).ts + (stack.at(-1).dur ?? 0) <= e.ts) stack.pop();
    if (stack.length) stack.at(-1).selfDur = (stack.at(-1).selfDur ?? stack.at(-1).dur ?? 0) - dur;
    e.selfDur = dur;
    stack.push(e);
    count.set(e.name, (count.get(e.name) ?? 0) + 1);
  }
  for (const e of inWindow) self.set(e.name, (self.get(e.name) ?? 0) + Math.max(0, e.selfDur ?? 0));
  const byName = Object.fromEntries([...self].sort((a, b) => b[1] - a[1]).map(([n, us]) => [n, Math.round(us / 100) / 10]));
  const total = Math.round((end.ts - start.ts) / 100) / 10;
  const pick = names => Math.round(names.reduce((a, n) => a + (self.get(n) ?? 0), 0) / 100) / 10;
  return {
    windowMs: total,
    layoutMs: pick(['Layout', 'UpdateLayoutTree', 'PrePaint', 'Paint', 'UpdateLayerTree', 'HitTest']),
    gcMs: pick([...self.keys()].filter(n => /GC|GarbageCollection|V8\.GC|MinorGC|MajorGC/i.test(n))),
    scriptMs: pick(['FunctionCall', 'RunMicrotasks', 'EvaluateScript', 'v8.run', 'V8.Execute', 'v8.callFunction', 'EventDispatch']),
    counts: { Layout: count.get('Layout') ?? 0, UpdateLayoutTree: count.get('UpdateLayoutTree') ?? 0, gc: [...count].filter(([n]) => /GC|GarbageCollection/i.test(n)).reduce((a, [, c]) => a + c, 0) },
    top: Object.fromEntries(Object.entries(byName).slice(0, 14)),
  };
}
