/**
 * behavior-features.test.ts — 状態の `$behavior`（その木の振る舞い）と、
 * `bootstrapState` の設定の検査（docs/state-engine-rewrite/config-impl-plan.ja.md §2）。
 * 後付けは入れない（core だけ）。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState, DirtyStrategy, Engine } from "../src/index";
import { config, getConfig, setConfig } from "../src/config";
import { hooks } from "../src/hooks";
import { M } from "../src/messages";

// the core's own message (no diagnostics add-on here): [@wcstack/state] [wcs/<code>] #<number> <values>
const core = (id: M) => new RegExp(String.raw`^\[@wcstack/state\] (\[wcs/[\w-]+\] )?#${id}( |$)`);

const make = (state: Record<string, any>) => new Engine(state, new DirtyStrategy());

beforeAll(() => {
  bootstrapState();
});

describe("$behavior", () => {
  it("書かなければ 3 つとも true、書いたものだけが変わる", () => {
    const d = make({});
    expect([d.mustache, d.guard, d.directional]).toEqual([true, true, true]);
    const e = make({ $behavior: { enableMustache: false, enableDirectionalInitialSync: false } });
    expect([e.mustache, e.guard, e.directional]).toEqual([false, true, false]);
  });

  it("知らないキー・boolean でない値・オブジェクトでない $behavior は投げる", () => {
    expect(() => make({ $behavior: { debug: true } })).toThrow(core(M.OptionInvalid));
    expect(() => make({ $behavior: { debug: true } })).toThrow('"$behavior" "debug"');
    expect(() => make({ $behavior: { sameValueGuard: "no" } })).toThrow('"$behavior" "sameValueGuard"');
    expect(() => make({ $behavior: 5 })).toThrow('"state" "$behavior"');
    expect(make({ $behavior: null }).guard).toBe(true);
  });

  it("再セットは同じ $behavior なら通り、変わる（省いて既定に戻るのも）と投げる", () => {
    const e = make({ n: 1, $behavior: { sameValueGuard: false } });
    e.reset({ n: 2, $behavior: { sameValueGuard: false } });
    expect(e.proxy.n).toBe(2);
    expect(() => e.reset({ n: 3 })).toThrow(core(M.BehaviorChanged));
    expect(() => e.reset({ n: 3, $behavior: { sameValueGuard: true } })).toThrow(core(M.BehaviorChanged));
    const d = make({ n: 1 });
    d.reset({ n: 2, $behavior: { enableMustache: true } });
    expect(d.proxy.n).toBe(2);
  });

  it("sameValueGuard: false の木は同じ値の書き込みも通す（木ごとに違ってよい）", () => {
    const on = make({ n: 1 });
    const off = make({ n: 1, $behavior: { sameValueGuard: false } });
    const landed: Engine[] = [];
    hooks.written = (engine) => { landed.push(engine); };
    try {
      on.proxy.n = 1;
      off.proxy.n = 1;
    } finally {
      hooks.written = null;
    }
    expect(landed).toEqual([off]);
  });
});

describe("bootstrapState の設定", () => {
  const DEFAULTS = { ...getConfig(), tagNames: { ...getConfig().tagNames } };
  afterEach(() => {
    setConfig(DEFAULTS);
  });

  it("undefined の値は飛ばし、tagNames はオブジェクトだけを受ける", () => {
    setConfig({ locale: undefined, commentForPrefix: "x-for" });
    expect(config.locale).toBe(DEFAULTS.locale);
    expect(config.commentForPrefix).toBe("x-for");
    expect(() => setConfig({ tagNames: "my-state" as any })).toThrow('"bootstrapState" "tagNames"');
    expect(config.tagNames).toEqual(DEFAULTS.tagNames);
  });

  it.each(["enableMustache", "sameValueGuard", "enableDirectionalInitialSync", "debug", "commentTextPrefix", "enablePropagationContext"])(
    "4.0 で $behavior へ移ったキー・消えたキー（%s）は投げる",
    (key) => {
      expect(() => setConfig({ [key]: true } as any)).toThrow(core(M.OptionInvalid));
    },
  );
});
