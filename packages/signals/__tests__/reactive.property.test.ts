// Tier2 — プロパティベーステスト（fast-check）。
//
// ランダムな依存 DAG（signal / computed / effect をランダムに結線）とランダムな更新列を
// 生成し、ライブラリのリアクティブ不変条件を検証する。検証する性質:
//   - glitch-free / 収束: flush 後、各 computed/effect の観測値が「その時点の signal 値から
//     同期的に再計算した期待値（テスト側の素朴な参照実装）」と常に一致する。
//   - 収束: flush 後に再 flush しても値が変わらない（pendingEffects 由来の未処理が残らない）。
//   - 菱形依存（diamond）で同一 effect が一度だけ実行される（過剰実行なし）。
//
// DAG は computed が「既存ノードのみ」を参照するように生成するためサイクルは作られない。
// 期待値は signal 値から計算する純粋関数（参照実装）で、ライブラリ出力と突合する。

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { signal, computed, effect, createRoot, flushSync, WriteSignal } from "../src/reactive.js";

// --- DAG 仕様（生成される構造の純粋な記述） ---------------------------------
//
// ノードは添字 0..n-1。各ノードは signal か computed のいずれか。computed は自分より
// 小さい添字のノードだけを 2 つ参照し（k = 加算 / 減算 / max を適用）、サイクルにならない。

type NodeSpec =
  | { kind: "signal"; value: number }
  | { kind: "computed"; a: number; b: number; op: "add" | "sub" | "max" };

interface DagSpec {
  nodes: NodeSpec[];
  // 観測対象（effect を張る computed/signal の添字）。重複あり＝同一ノードを複数 effect が観測。
  effects: number[];
  // 更新列: [signal の添字（signal ノードのみ）, 新しい値] の並び。
  updates: { index: number; value: number }[];
}

function applyOp(op: "add" | "sub" | "max", a: number, b: number): number {
  if (op === "add") return a + b;
  if (op === "sub") return a - b;
  return Math.max(a, b);
}

// 参照実装: signal の現在値（values[]）から、全ノードの期待値を素朴に再計算する純粋関数。
// 添字が単調増加（computed は小さい添字のみ参照）なので前方から一度走査すれば確定する。
function referenceEval(nodes: NodeSpec[], signalValues: number[]): number[] {
  const out: number[] = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const spec = nodes[i];
    if (spec.kind === "signal") {
      out[i] = signalValues[i];
    } else {
      out[i] = applyOp(spec.op, out[spec.a], out[spec.b]);
    }
  }
  return out;
}

// --- 生成器 -----------------------------------------------------------------

function dagArbitrary(): fc.Arbitrary<DagSpec> {
  return fc
    .integer({ min: 2, max: 12 })
    .chain((n) => {
      // ノード列: 先頭は必ず signal（computed が参照できる土台を保証）。
      const nodeArbs: fc.Arbitrary<NodeSpec>[] = [];
      for (let i = 0; i < n; i++) {
        if (i === 0) {
          nodeArbs.push(fc.integer({ min: -20, max: 20 }).map((value) => ({ kind: "signal", value }) as NodeSpec));
        } else {
          // signal にするか computed にするか。computed は 0..i-1 を 2 つ参照。
          const computedArb: fc.Arbitrary<NodeSpec> = fc
            .record({
              a: fc.integer({ min: 0, max: i - 1 }),
              b: fc.integer({ min: 0, max: i - 1 }),
              op: fc.constantFrom("add" as const, "sub" as const, "max" as const),
            })
            .map(({ a, b, op }) => ({ kind: "computed", a, b, op }) as NodeSpec);
          const signalArb: fc.Arbitrary<NodeSpec> = fc
            .integer({ min: -20, max: 20 })
            .map((value) => ({ kind: "signal", value }) as NodeSpec);
          nodeArbs.push(fc.oneof(signalArb, computedArb));
        }
      }
      return fc.tuple(...nodeArbs).map((nodes) => ({ nodes, n }));
    })
    .chain(({ nodes, n }) => {
      const signalIndices = nodes.map((s, i) => (s.kind === "signal" ? i : -1)).filter((i) => i >= 0);
      const effectsArb = fc.array(fc.integer({ min: 0, max: n - 1 }), { minLength: 0, maxLength: 6 });
      // 更新は signal ノードに対してのみ。signal が無いことはない（添字 0 は必ず signal）。
      const updateArb = fc.record({
        index: fc.constantFrom(...signalIndices),
        value: fc.integer({ min: -20, max: 20 }),
      });
      const updatesArb = fc.array(updateArb, { minLength: 0, maxLength: 10 });
      return fc.record({
        nodes: fc.constant(nodes),
        effects: effectsArb,
        updates: updatesArb,
      });
    });
}

// --- ライブラリでの DAG 構築 ------------------------------------------------
//
// spec.nodes を順に signal / computed として実体化し、各ノードの ReadSignal を `sources`
// に積む（computed は小さい添字のみ参照するので前方参照だけで結線できる）。effect は
// 観測対象ノードの get() を読み、値と実行回数を記録する。

interface Built {
  sources: { get(): number; peek(): number }[];
  writers: (WriteSignal<number> | null)[];
  effectValues: number[];
  effectRuns: number[];
  signalValues: number[]; // signal ノードの現在値（computed は無視されるダミー）。
  dispose: () => void;
}

function buildDagImpl(spec: DagSpec): Built {
  const sources: { get(): number; peek(): number }[] = [];
  const writers: (WriteSignal<number> | null)[] = [];
  const effectValues: number[] = [];
  const effectRuns: number[] = [];
  const signalValues: number[] = [];

  const dispose = createRoot((d) => {
    for (let i = 0; i < spec.nodes.length; i++) {
      const node = spec.nodes[i];
      if (node.kind === "signal") {
        const s = signal(node.value);
        writers.push(s);
        sources.push(s);
        signalValues.push(node.value);
      } else {
        const a = node.a;
        const b = node.b;
        const op = node.op;
        const c = computed(() => applyOp(op, sources[a].get(), sources[b].get()));
        writers.push(null);
        sources.push(c);
        signalValues.push(0); // computed 用ダミー
      }
    }

    spec.effects.forEach((target, ei) => {
      effectValues.push(NaN);
      effectRuns.push(0);
      effect(() => {
        effectValues[ei] = sources[target].get();
        effectRuns[ei]++;
      });
    });

    return d;
  });

  return { sources, writers, effectValues, effectRuns, signalValues, dispose };
}

describe("プロパティベース: ランダム DAG のリアクティブ不変条件", () => {
  it("flush 後、全 computed/effect の観測値が参照実装と一致し、再 flush で収束する", () => {
    fc.assert(
      fc.property(dagArbitrary(), (spec) => {
        const built = buildDagImpl(spec);
        flushSync();

        // 更新列を適用する。各ステップごとに flush し、観測値・収束を検証。
        const signalValues = built.signalValues.slice();
        const checkConverged = (): void => {
          flushSync();
          const expected = referenceEval(spec.nodes, signalValues);
          // computed の peek 値が参照実装と一致（glitch-free）。
          for (let i = 0; i < spec.nodes.length; i++) {
            expect(built.sources[i].peek()).toBe(expected[i]);
          }
          // effect の観測値が参照実装と一致。
          spec.effects.forEach((target, ei) => {
            expect(built.effectValues[ei]).toBe(expected[target]);
          });
          // 再 flush しても値が変わらない（収束済み = pending 残なし）。
          const runsBefore = built.effectRuns.slice();
          flushSync();
          for (let i = 0; i < spec.nodes.length; i++) {
            expect(built.sources[i].peek()).toBe(expected[i]);
          }
          // 再 flush で effect が走り直さない。
          expect(built.effectRuns).toEqual(runsBefore);
        };

        checkConverged();

        for (const upd of spec.updates) {
          signalValues[upd.index] = upd.value;
          built.writers[upd.index]!.set(upd.value);
          checkConverged();
        }

        built.dispose();
      }),
      { numRuns: 200 },
    );
  });

  it("菱形依存（diamond）で同一 effect は signal 1 回更新につき高々 1 回しか実行されない", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -50, max: 50 }), { minLength: 1, maxLength: 20 }), (writes) => {
        // a → (b, c) → d、d を観測する effect。glitch があれば d が中間状態で複数回走る。
        const runs = { count: 0 };
        let lastSeen = NaN;
        const dispose = createRoot((d) => {
          const a = signal(0);
          const b = computed(() => a.get() + 1);
          const c = computed(() => a.get() * 2);
          const dd = computed(() => b.get() + c.get());
          effect(() => {
            lastSeen = dd.get();
            runs.count++;
          });
          flushSync();
          // 初回実行 1 回。
          expect(runs.count).toBe(1);

          for (const w of writes) {
            const before = runs.count;
            a.set(w);
            flushSync();
            // 1 回の set につき effect は高々 1 回（同値 set は 0 回）。
            expect(runs.count - before).toBeLessThanOrEqual(1);
            // 収束値は参照実装と一致。
            expect(lastSeen).toBe(w + 1 + w * 2);
          }
          return d;
        });
        dispose();
      }),
      { numRuns: 100 },
    );
  });
});
