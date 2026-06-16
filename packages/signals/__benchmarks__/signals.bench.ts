// Performance benchmarks for @wcstack/signals (workstream B, item B2).
//
// Run with: `npm run bench` (→ `vitest bench --run`).
//
// These live OUTSIDE `__tests__/` so the regular `vitest run` include pattern
// (`__tests__/**/*.{test,spec}`) never picks them up — they neither inflate the
// test count nor distort coverage. `vitest bench` discovers `*.bench.ts` itself.
//
// Goal: a runnable baseline for the reactive core and the `For` list reconciler so
// regressions are visible. Numbers are environment-relative (happy-dom, single
// thread); treat them as trend indicators, not absolute thresholds. A CI guard with
// hard budgets is intentionally out of scope here.

import { bench, describe } from "vitest";
import { signal, computed, effect, flushSync, createRoot, For, render } from "../src/dom.js";

// (a) signal write → effect flush throughput. One effect observing one signal; each
// iteration writes a new value and flushes synchronously, so the bench measures the
// mark → schedule → drain → rerun path end to end.
describe("signal write → effect flush", () => {
  bench("single signal, single effect", () => {
    createRoot((dispose) => {
      const s = signal(0);
      let seen = 0;
      effect(() => {
        seen = s.get();
      });
      flushSync();
      for (let i = 0; i < 1000; i++) {
        s.set(i);
        flushSync();
      }
      void seen;
      dispose();
    });
  });

  bench("one signal fanning out to 50 effects", () => {
    createRoot((dispose) => {
      const s = signal(0);
      for (let e = 0; e < 50; e++) {
        effect(() => void s.get());
      }
      flushSync();
      for (let i = 0; i < 200; i++) {
        s.set(i);
        flushSync();
      }
      dispose();
    });
  });
});

// (b) computed chain depth → updateIfNecessary. A linear chain of computeds where
// each reads the previous; writing the root and reading the tail exercises the
// pull-validated CHECK→DIRTY walk over the whole depth.
describe("computed chain updateIfNecessary", () => {
  const makeChain = (depth: number) => {
    const root = signal(0);
    let prev: { get: () => number } = root;
    for (let i = 0; i < depth; i++) {
      const p = prev;
      prev = computed(() => p.get() + 1);
    }
    return { root, tail: prev };
  };

  for (const depth of [4, 16, 64]) {
    bench(`chain depth ${depth}`, () => {
      createRoot((dispose) => {
        const { root, tail } = makeChain(depth);
        for (let i = 0; i < 500; i++) {
          root.set(i);
          void tail.get();
        }
        dispose();
      });
    });
  }
});

// (c) For: create / update / reorder (sort toggle) / remove on a sizeable list.
// `reorder` is the headline case for the LIS change — a full sort flip that the old
// back-to-front reconciler moved nearly every node for.
describe("For list reconcile", () => {
  const N = 1000;
  const ascending = Array.from({ length: N }, (_, i) => i);
  const descending = [...ascending].reverse();
  const withHead = [-1, ...ascending];
  const removedHalf = ascending.filter((_, i) => i % 2 === 0);

  // Mount a fresh For list into a detached <ul> under its own root. Returns the
  // list signal plus the root disposer so each bench tears its tree down.
  const mountListWith = (initial: number[]) => {
    const list = signal<readonly number[]>(initial);
    const ul = document.createElement("ul");
    const dispose = createRoot((d) => {
      render(
        For(
          list,
          (v) => {
            const li = document.createElement("li");
            li.textContent = String(v);
            return li;
          },
          { key: (v) => v },
        ),
        ul,
      );
      return d;
    });
    return { list, dispose };
  };

  bench("create 1000 rows", () => {
    const { list, dispose } = mountListWith([]);
    flushSync();
    list.set(ascending);
    flushSync();
    dispose();
  });

  bench("update values (same keys)", () => {
    const { list, dispose } = mountListWith(ascending);
    flushSync();
    for (let r = 0; r < 5; r++) {
      list.set(ascending.map((v) => v)); // same keys → reuse + index refresh
      flushSync();
    }
    dispose();
  });

  bench("reorder: ascending ↔ descending sort toggle", () => {
    const { list, dispose } = mountListWith(ascending);
    flushSync();
    for (let r = 0; r < 5; r++) {
      list.set(r % 2 === 0 ? descending : ascending);
      flushSync();
    }
    dispose();
  });

  bench("reorder: head insert (index full-shift)", () => {
    const { list, dispose } = mountListWith(ascending);
    flushSync();
    list.set(withHead);
    flushSync();
    dispose();
  });

  bench("remove half the rows", () => {
    const { list, dispose } = mountListWith(ascending);
    flushSync();
    list.set(removedHalf);
    flushSync();
    dispose();
  });
});
