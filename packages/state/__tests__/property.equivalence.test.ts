/**
 * property.equivalence.test.ts — the incremental update and a fresh render agree
 * (docs/verification-practices-study.md §2.5 (a)).
 *
 * The engine renders a write by what it dirtied: the paths a write reaches, the getters that read them, the
 * keyed diff of a list, the branches of an `if`. Its oracle needs no second implementation: the same final
 * data, drawn from scratch by a new <wcs-state>, is what the page must show. fast-check generates the writes
 * — scalars, list operations that keep or replace row objects, `$update` on a row's fields, several writes in
 * one callback — and shrinks a failure to the shortest sequence that still disagrees.
 *
 * What is compared: the page's elements and text, comments (the engine's anchors) and whitespace-only text
 * left out, attributes in order, and `class=""` read as no class (a class removed leaves the attribute).
 */
import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import { bootstrapState, getBindingsReady } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

const TEMPLATE = `
<h1 class="title" data-wcs="textContent: title"></h1>
<p class="meta" data-wcs="class.on: show; attr.data-count: count; textContent: summary"></p>
<template data-wcs="if: show"><span class="shown" data-wcs="textContent: title"></span></template>
<template data-wcs="else:"><span class="hidden">-</span></template>
<ul>
  <template data-wcs="for: items">
    <li data-wcs="attr.data-id: .id; class.done: .done">
      <span class="label" data-wcs="textContent: .label"></span><em data-wcs="textContent: .upper"></em>
      <template data-wcs="if: .done"><b>done</b></template>
      <template data-wcs="for: .tags"><i data-wcs="textContent: ."></i></template>
    </li>
  </template>
</ul>`;

interface Item { id: number; label: string; done: boolean; tags: string[] }
interface Data { title: string; show: boolean; items: Item[] }

/** The state object: the data, a root getter, an aggregate getter and a row getter. */
function makeState(data: Data): Record<string, any> {
  return {
    ...data,
    get count() { return this.items.length; },
    get summary() {
      const done: boolean[] = this.$getAll("items.*.done", []);
      return `${done.filter(Boolean).length}/${done.length}`;
    },
    get "items.*.upper"() { return String(this["items.*.label"]).toUpperCase(); },
  };
}

async function mountPage(data: Data) {
  const h = document.createElement(`prop-eq-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${TEMPLATE}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(makeState(data));
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  return { h, root, write };
}

/** The page's elements and text, as a string that ignores what the engine is free to vary. */
function shown(node: Node): string {
  let out = "";
  for (const n of Array.from(node.childNodes)) {
    if (n.nodeType === 8) continue;
    if (n.nodeType === 3) {
      if ((n as Text).data.trim() !== "") out += (n as Text).data;
      continue;
    }
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (e.localName === "wcs-state" || e.localName === "template") continue;
    const attrs = Array.from(e.attributes)
      .filter((a) => a.name !== "data-wcs" && !(a.name === "class" && a.value.trim() === ""))
      .map((a) => `${a.name}="${a.name === "class" ? a.value.trim().split(/\s+/).sort().join(" ") : a.value}"`)
      .sort();
    out += `<${e.localName}${attrs.length ? " " + attrs.join(" ") : ""}>${shown(e)}</${e.localName}>`;
  }
  return out;
}

// ---------------------------------------------------------------- the writes

const text = fc.stringMatching(/^[a-c]{0,3}$/);
type Op =
  | { k: "title"; v: string } | { k: "show" }
  | { k: "push"; v: string } | { k: "unshift"; v: string } | { k: "remove"; at: number }
  | { k: "move"; from: number; to: number } | { k: "reverse" } | { k: "sort" } | { k: "replaceAll"; vs: string[] }
  | { k: "label"; at: number; v: string } | { k: "toggle"; at: number } | { k: "tags"; at: number; vs: string[] }
  | { k: "replaceItem"; at: number; v: string };
const simple: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant("title" as const), v: text }),
  fc.constant({ k: "show" as const }),
  fc.record({ k: fc.constant("push" as const), v: text }),
  fc.record({ k: fc.constant("unshift" as const), v: text }),
  fc.record({ k: fc.constant("remove" as const), at: fc.nat(9) }),
  fc.record({ k: fc.constant("move" as const), from: fc.nat(9), to: fc.nat(9) }),
  fc.constant({ k: "reverse" as const }),
  fc.constant({ k: "sort" as const }),
  fc.record({ k: fc.constant("replaceAll" as const), vs: fc.array(text, { maxLength: 4 }) }),
  fc.record({ k: fc.constant("label" as const), at: fc.nat(9), v: text }),
  fc.record({ k: fc.constant("toggle" as const), at: fc.nat(9) }),
  fc.record({ k: fc.constant("tags" as const), at: fc.nat(9), vs: fc.array(text, { maxLength: 3 }) }),
  fc.record({ k: fc.constant("replaceItem" as const), at: fc.nat(9), v: text }),
);
/** One write: one operation, or two in one callback (one drain renders both). */
const step = fc.oneof({ weight: 4, arbitrary: simple.map((o) => [o]) }, { weight: 1, arbitrary: fc.tuple(simple, simple) });

let nextId = 1000;
const item = (label: string): Item => ({ id: nextId++, label, done: false, tags: [] });

/**
 * Applies `op` to the model (the plain data the fresh page is drawn from) and to the page's state through
 * `s`. A list is never changed in place: a new array of the same row objects, new objects where a row changed.
 * `$update` writes one field of a row, as an app does.
 */
function apply(model: Data, s: any, op: Op): void {
  const items = model.items;
  const at = (n: number) => n % items.length;
  const list = (next: Item[]) => { model.items = next; s.items = next; };
  switch (op.k) {
    case "title": model.title = op.v; s.title = op.v; return;
    case "show": model.show = !model.show; s.show = model.show; return;
    case "push": return list([...items, item(op.v)]);
    case "unshift": return list([item(op.v), ...items]);
    case "replaceAll": return list(op.vs.map(item));
    case "reverse": return list([...items].reverse());
    case "sort": return list([...items].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id - b.id)));
  }
  if (items.length === 0) return;
  switch (op.k) {
    case "remove": return list(items.filter((_, i) => i !== at(op.at)));
    case "move": {
      const next = [...items];
      const [moved] = next.splice(at(op.from), 1);
      next.splice(op.to % (next.length + 1), 0, moved);
      return list(next);
    }
    case "replaceItem": return list(items.map((x, i) => (i === at(op.at) ? { ...x, label: op.v } : x)));
    case "label": { const i = at(op.at); s.$update("items.*.label", [i], () => op.v); items[i].label = op.v; return; }
    case "toggle": { const i = at(op.at); const v = !items[i].done; s.$update("items.*.done", [i], () => v); items[i].done = v; return; }
    case "tags": { const i = at(op.at); const v = [...op.vs]; s.$update("items.*.tags", [i], () => v); items[i].tags = v; return; }
  }
}

describe("差分の更新とゼロからの描画が一致する（property、§2.5 (a)）", () => {
  // (a broken variant, on the test side: the comparison tells a page whose rows are out of order. Changing the
  // keyed diff's swap of the two ends — `oe - s > 1` to `> 3` in dom/view.ts — made the property below fail,
  // shrunk to: four rows replaced, reversed, one put in front)
  it("比べ方は、行の順序だけが違うページを見分ける", async () => {
    const data: Data = { title: "t", show: true, items: ["a", "b", "c"].map(item) };
    const page = await mountPage(data);
    const fresh = await mountPage(structuredClone(data));
    try {
      expect(shown(page.root)).toBe(shown(fresh.root));
      const ul = page.root.querySelector("ul")!;
      const lis = ul.querySelectorAll("li");
      ul.insertBefore(lis[2], lis[0]);
      expect(shown(page.root)).not.toBe(shown(fresh.root));
    } finally {
      page.h.remove();
      fresh.h.remove();
    }
  });

  it("ランダムな書き込みの列の後、ページの DOM は同じ最終データを新しく描いた DOM と同じ", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ title: text, show: fc.boolean(), labels: fc.array(text, { maxLength: 4 }) }),
        fc.array(step, { minLength: 1, maxLength: 12 }),
        async (start, steps) => {
          const model: Data = { title: start.title, show: start.show, items: start.labels.map(item) };
          const page = await mountPage(model);
          let fresh: Awaited<ReturnType<typeof mountPage>> | null = null;
          try {
            for (const ops of steps) await page.write((s) => { for (const op of ops) apply(model, s, op); });
            fresh = await mountPage(structuredClone(model));
            expect(shown(page.root)).toBe(shown(fresh.root));
          } finally {
            page.h.remove();
            fresh?.h.remove();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 120_000);
});
