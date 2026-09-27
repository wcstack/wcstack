/**
 * integration.elementSwapFuzz.test.ts — 要素書き込みの入れ替えと一覧の置き換えのランダム差分テスト
 * （#335・#337）。
 *
 * 1 手は 1〜3 個の操作を 1 バッチに並べる: 要素の差し替え・2 行の入れ替え・別の行の値の写し
 * （入れ替えの片側だけ）・push・同じ中身の写し・逆順・1 行削除・丸ごとの置き換え・空にする、
 * `if` の切り替え（同じリストを描く 2 つ目の `for` を出し入れする形）。25 手ごとに
 *  - 状態を、同じ操作を素の配列に当てたモデルと突き合わせ（書き込みが別の位置に着地しないこと）、
 *  - 描いた値と `$1` を状態と突き合わせ、
 *  - console.error（`binding "for: items" failed to apply`）が出ないことを見る。
 * 行はオブジェクト（同一性で入れ替わる）と、値の少ないプリミティブ（同じ値の行が頻繁にできる）の 2 通り。
 *
 * 修理前の実装では、形ごとに 100 seed で 95 / 95 / 100 seed が食い違った（最初に食い違った手で状態
 * そのものも食い違っていた — 書き込みが別の位置に着地した・読みが投げた — のが 7 / 8 / 25 seed）。
 * 1 seed あたりの検出率が高いので既定は形ごとに 6 seed。追い込むときは SWAP_FUZZ_SEEDS で増やす。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("swap-fuzz-host");
const SEEDS = Number(process.env.SWAP_FUZZ_SEEDS ?? "6");
const STEPS = 25;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Variant = "object" | "objectWithIf" | "primitive";

const ROW = (value: string) => `<li><b>{{ ${value} }}</b><i>{{ $1 }}</i></li>`;
const MARKUP: Record<Variant, string> = {
  object: `<ul><template data-wcs="for: items">${ROW(".id")}</template></ul>`,
  objectWithIf:
    `<ul><template data-wcs="for: items">${ROW(".id")}</template></ul>` +
    `<div><template data-wcs="if: show"><ol><template data-wcs="for: items">${ROW(".id")}</template></ol></template></div>`,
  primitive: `<ul><template data-wcs="for: items">${ROW(".")}</template></ul>`,
};

type Op = (s: any) => void;

async function runSeed(variant: Variant, seed: number): Promise<string[]> {
  const random = rng(seed * 7919 + variant.length);
  const int = (n: number) => Math.floor(random() * n);
  let nextId = 100;
  const newValue = (): unknown => variant === "primitive" ? int(4) : { id: nextId++ };
  const label = (value: any): string => String(variant === "primitive" ? value : value.id);
  const initial = variant === "primitive" ? { items: [0, 1, 2, 1] } : { show: true, items: [{ id: 1 }, { id: 2 }, { id: 3 }] };

  // 同じ操作を素の配列に当てるモデル（`s["items.3"]` は items[3]）
  const model: any = { show: true, items: [...initial.items] };
  const modelProxy = new Proxy({}, {
    get: (_t, key: string) => { const m = /^items\.(\d+)$/.exec(key); return m ? model.items[+m[1]] : model[key]; },
    set: (_t, key: string, value) => {
      const m = /^items\.(\d+)$/.exec(key);
      if (m) { model.items[+m[1]] = value; } else { model[key] = value; }
      return true;
    },
  });

  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(String(args[0])); });
  const { host, shadowRoot, stateEl } = await mount(initial, MARKUP[variant]);
  const failures: string[] = [];
  try {
    for (let step = 0; step < STEPS && failures.length === 0; step++) {
      const names: string[] = [];
      const ops: Op[] = [];
      let length: number = model.items.length;
      for (let k = 1 + int(3); k > 0; k--) {
        const kind = int(variant === "objectWithIf" ? 12 : 11);
        if (kind <= 2 && length > 0) {
          const i = int(length);
          const value = newValue();
          names.push(`set ${i}=${label(value)}`);
          ops.push((s) => { s[`items.${i}`] = value; });
        } else if (kind <= 4 && length > 1) {
          const i = int(length);
          const j = int(length);
          names.push(`swap ${i},${j}`);
          ops.push((s) => { const a = s[`items.${i}`]; s[`items.${i}`] = s[`items.${j}`]; s[`items.${j}`] = a; });
        } else if (kind === 5 && length > 1) {
          const i = int(length);
          const j = int(length);
          names.push(`copy ${j}->${i}`);
          ops.push((s) => { s[`items.${i}`] = s[`items.${j}`]; });
        } else if (kind === 6) {
          const value = newValue();
          names.push("push");
          ops.push((s) => { s.items = [...s.items, value]; });
          length++;
        } else if (kind === 7) {
          names.push("same");
          ops.push((s) => { s.items = [...s.items]; });
        } else if (kind === 8) {
          names.push("reverse");
          ops.push((s) => { s.items = [...s.items].reverse(); });
        } else if (kind === 9 && length > 0) {
          const i = int(length);
          names.push(`remove ${i}`);
          ops.push((s) => { s.items = s.items.filter((_: unknown, k: number) => k !== i); });
          length--;
        } else if (kind === 10) {
          const values = int(4) === 0 ? [] : Array.from({ length: int(5) }, newValue);
          names.push(`replace ${values.length}`);
          ops.push((s) => { s.items = [...values]; });
          length = values.length;
        } else if (kind === 11) {
          names.push("toggle");
          ops.push((s) => { s.show = !s.show; });
        }
      }
      for (const op of ops) op(modelProxy);
      write(stateEl, (s: any) => { for (const op of ops) op(s); });
      await flush();

      const expected: string[] = model.items.map(label);
      const state = read(stateEl, (s: any) => s.items.map(label));
      const where = `${variant} seed ${seed} step ${step} [${names.join("; ")}]`;
      if (state.join() !== expected.join()) {
        failures.push(`${where}: state ${state} / model ${expected}`);
      }
      // `if` で消えている `ol` は描かれない（戻したときに追いつくことを次の手で見る）
      const lists = variant === "objectWithIf" && model.show ? ["ul", "ol"] : ["ul"];
      for (const list of lists) {
        const rows = Array.from(shadowRoot.querySelectorAll(`${list} > li`));
        const drawn = rows.map((li) => li.querySelector("b")?.textContent);
        const indexes = rows.map((li) => li.querySelector("i")?.textContent);
        if (drawn.join() !== state.join() || indexes.join() !== state.map((_: unknown, i: number) => i).join()) {
          failures.push(`${where}: <${list}> ${drawn} ($1 ${indexes}) / state ${state}`);
        }
      }
      if (errors.length > 0) {
        failures.push(`${where}: ${errors[0].slice(0, 160)}`);
      }
    }
  } finally {
    spy.mockRestore();
    host.remove();
  }
  return failures;
}

describe("要素書き込みの入れ替えと一覧の置き換えのランダム差分（#335・#337）", () => {
  for (const variant of ["object", "objectWithIf", "primitive"] as Variant[]) {
    it(`${variant}: 状態がモデルと、描画と $1 が状態と一致し、エラーが出ないこと`, async () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        failures.push(...await runSeed(variant, seed));
      }
      expect(failures).toEqual([]);
    }, 120000);
  }
});
