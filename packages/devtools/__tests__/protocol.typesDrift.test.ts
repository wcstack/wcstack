/**
 * DevTools Hook Protocol の両側の型宣言のドリフト番人。
 *
 * このプロトコルは `/protocol/` に正本ファイルを持たず、`scripts/sync-protocol-types.mjs`
 * の対象でもない — ランタイム側（`@wcstack/state` の `src/devtools/types.ts`）と消費側
 * （このパッケージの `src/protocol/types.ts`）が**独立に手で構造的型付けを持つ**設計
 * （docs/devtools-hook-protocol.md §2 / 原則 4）。構造的型付けなので「片側だけフィールドが
 * 増えた」ドリフトはコンパイルでも実行でも一切落ちない：devtools 側は増えたフィールドを
 * 知らないまま黙って描かなくなるだけ。実際に `IMountOverlaySummary.exports`（D10）が
 * 約 2 週間このパッケージに届いていなかった。
 *
 * ここでは両ソースを**テキストとして**読み、対応するインターフェースのメンバ名集合を
 * 突き合わせる。型そのものは比較しない — 片側が `IStateElement`、もう片側が `unknown`
 * なのは設計どおりで、`?` の有無（旧ランタイム耐性）も同様。捕まえるのは名前の欠落だけ。
 *
 * ランタイム側の型宣言は 3.x の `packages/state/src/devtools/types.ts` にあった。4.0 の state
 * （4.0 の差し替えで packages/state）はプロトコル v2 のまま話すが、型宣言を持たない
 * （`src/devtools/devtools.ts` がイベントを素のオブジェクトで送る）。そこで v2 の型宣言は 3.5.4 の写し
 * （`__tests__/fixtures/state-3.5.4-devtools-types.ts.txt`、凍結）と突き合わせ、4.0 のランタイムとは
 * プロトコル版とグローバル名をテキストで突き合わせたうえで、**実物の形**を確かめる: 4.0 の
 * devtools の後付けを happy-dom の上で入れて（`packages/state/src` の全部入りの入口）、送られた
 * イベントと引いた要約・ソース・レジストリのキーが、消費側の宣言するメンバを含むかを見る
 * （末尾の describe）。型宣言の無い 4.0 の側で、名前の欠落を捕まえるのはこれだけ。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeContract, bootstrapState, getBindingsReady } from "../../state/src/exports";

/** The protocol v2 declaration of the runtime side: 3.x's src/devtools/types.ts as of 3.5.4 (frozen). */
const RUNTIME_TYPES = resolve(__dirname, "fixtures", "state-3.5.4-devtools-types.ts.txt");
/** The 4.0 runtime, which speaks v2 without type declarations of its own. */
const RUNTIME_4 = resolve(__dirname, "..", "..", "state", "src", "devtools", "devtools.ts");
const CONSUMER_TYPES = resolve(__dirname, "..", "src", "protocol", "types.ts");

/**
 * `*Like` を名乗る消費側インターフェースと、その正本になるランタイム側インターフェース。
 * 新しい要約型をプロトコルに足したらここにも 1 行足す（足し忘れは下の網羅テストが落とす）。
 */
const INTERFACE_PAIRS: readonly (readonly [runtime: string, consumer: string])[] = [
  ["IStateElementSummary", "IStateElementSummaryLike"],
  ["IMountOverlaySummary", "IMountOverlaySummaryLike"],
  ["IKeyedSubscriptionSummary", "IKeyedSubscriptionSummaryLike"],
  ["IDeclaredFilter", "IDeclaredFilterLike"],
  ["IDeclaredBindingInfo", "IDeclaredBindingLike"],
  ["IDevtoolsSource", "IDevtoolsSourceLike"],
  ["IDevtoolsListener", "IDevtoolsListenerLike"],
  ["IDevtoolsHookRegistry", "IDevtoolsHookRegistryLike"],
];

/** 行コメント・ブロックコメントを落とす（コメント内の `:` を誤ってメンバ名と読まないため）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** `open` から始まる対応括弧までの中身（括弧自身は含めない）。 */
function balancedBody(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces from index ${open}`);
}

/** `interface <name> {` の本文。 */
function interfaceBody(source: string, name: string): string {
  const header = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(source);
  if (header === null) throw new Error(`interface ${name} not found`);
  return balancedBody(source, header.index + header[0].length - 1);
}

/** 深さ 0 の `;` で区切った宣言の列（ネストしたオブジェクト型の中の `;` では切らない）。 */
function statementsOf(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === ";" && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

const MEMBER_HEAD = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*[:(]/;

/** 宣言 1 つのメンバ名と、その型に含まれる最初のネストしたオブジェクト型の本文。 */
function memberOf(statement: string): { name: string; nested: string | null } | null {
  const head = MEMBER_HEAD.exec(statement);
  if (head === null) return null;
  const open = statement.indexOf("{");
  return { name: head[1], nested: open === -1 ? null : balancedBody(statement, open) };
}

function membersOf(body: string): Map<string, string | null> {
  const members = new Map<string, string | null>();
  for (const statement of statementsOf(body)) {
    const member = memberOf(statement);
    if (member !== null) members.set(member.name, member.nested);
  }
  return members;
}

/** ネストも含めてメンバ名を突き合わせる。`label` は差分メッセージの読み手向けの見出し。 */
function expectSameMembers(label: string, runtimeBody: string, consumerBody: string): void {
  const runtime = membersOf(runtimeBody);
  const consumer = membersOf(consumerBody);
  expect([...consumer.keys()].sort(), label).toEqual([...runtime.keys()].sort());
  for (const [name, runtimeNested] of runtime) {
    const consumerNested = consumer.get(name) ?? null;
    if (runtimeNested === null && consumerNested === null) continue;
    expect(consumerNested !== null, `${label}.${name}: ネストしたオブジェクト型の有無`).toBe(
      runtimeNested !== null
    );
    expectSameMembers(`${label}.${name}`, runtimeNested ?? "", consumerNested ?? "");
  }
}

/** `export type <name> =` から深さ 0 の `;` までの本文。 */
function unionBody(source: string, name: string): string {
  const header = new RegExp(`\\btype\\s+${name}\\s*=`).exec(source);
  if (header === null) throw new Error(`type ${name} not found`);
  const rest = source.slice(header.index + header[0].length);
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    else if (rest[i] === "}") depth--;
    else if (rest[i] === ";" && depth === 0) return rest.slice(0, i);
  }
  throw new Error(`unterminated type ${name}`);
}

/** union の各枝（`{ … }`）を `type` のリテラル値で引ける表にする。 */
function variantsByType(body: string): Map<string, string> {
  const variants = new Map<string, string>();
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "{") continue;
    const inner = balancedBody(body, i);
    const type = /readonly\s+type\s*:\s*"([^"]+)"/.exec(inner);
    if (type === null) throw new Error(`a DevtoolsEvent variant has no literal type: ${inner}`);
    variants.set(type[1], inner);
    i += inner.length + 1;
  }
  return variants;
}

describe("DevTools Hook Protocol 両側の型宣言のドリフト", () => {
  const runtimeSource = (() => {
    // 見つからないときは skip せず落とす — 番人が黙って空振りするほうが有害。
    expect(existsSync(RUNTIME_TYPES), `${RUNTIME_TYPES} が読めない`).toBe(true);
    return stripComments(readFileSync(RUNTIME_TYPES, "utf8"));
  })();
  const consumerSource = stripComments(readFileSync(CONSUMER_TYPES, "utf8"));

  it("プロトコル版とグローバル名が両側で一致すること", () => {
    const constant = (source: string, name: string): string => {
      const found = new RegExp(`${name}\\s*=\\s*([^;]+);`).exec(source);
      expect(found, name).not.toBeNull();
      return found![1].trim();
    };
    for (const name of ["DEVTOOLS_PROTOCOL_VERSION", "DEVTOOLS_HOOK_GLOBAL"]) {
      expect(constant(consumerSource, name), name).toBe(constant(runtimeSource, name));
    }
  });

  it("4.0 のランタイム（packages/state）もプロトコル版とグローバル名が同じであること", () => {
    expect(existsSync(RUNTIME_4), `${RUNTIME_4} が読めない`).toBe(true);
    const runtime4 = stripComments(readFileSync(RUNTIME_4, "utf8"));
    const constant = (source: string, name: string): string => {
      const found = new RegExp(`\\b${name}\\s*=\\s*([^;]+);`).exec(source);
      expect(found, name).not.toBeNull();
      return found![1].trim();
    };
    expect(constant(runtime4, "PROTOCOL"), "PROTOCOL").toBe(constant(consumerSource, "DEVTOOLS_PROTOCOL_VERSION"));
    expect(constant(runtime4, "HOOK"), "HOOK").toBe(constant(consumerSource, "DEVTOOLS_HOOK_GLOBAL"));
  });

  it.each(INTERFACE_PAIRS)("%s と %s のフィールド名が一致すること", (runtime, consumer) => {
    expectSameMembers(
      consumer,
      interfaceBody(runtimeSource, runtime),
      interfaceBody(consumerSource, consumer)
    );
  });

  it("ランタイム側の *Summary / *Info インターフェースが対応表から漏れていないこと", () => {
    const declared = [...runtimeSource.matchAll(/\binterface\s+(I[A-Za-z0-9_]+)\b/g)].map((m) => m[1]);
    const mapped = new Set(INTERFACE_PAIRS.map(([runtime]) => runtime));
    expect(declared.filter((name) => !mapped.has(name))).toEqual([]);
  });

  it("DevtoolsEvent の種別集合が一致すること", () => {
    const runtime = variantsByType(unionBody(runtimeSource, "DevtoolsEvent"));
    const consumer = variantsByType(unionBody(consumerSource, "DevtoolsEventLike"));
    expect([...consumer.keys()].sort()).toEqual([...runtime.keys()].sort());
  });

  it("DevtoolsEvent の枝ごとの payload フィールド名が一致すること", () => {
    const runtime = variantsByType(unionBody(runtimeSource, "DevtoolsEvent"));
    const consumer = variantsByType(unionBody(consumerSource, "DevtoolsEventLike"));
    for (const [type, runtimeBody] of runtime) {
      expectSameMembers(type, runtimeBody, consumer.get(type) ?? "");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4.0 のランタイムの実物の形
// ---------------------------------------------------------------------------------------------

interface TypedMember {
  readonly optional: boolean;
  readonly method: boolean;
  /** `:` の後ろの型の原文（メソッドは空） */
  readonly type: string;
  readonly nested: string | null;
}

const MEMBER_FULL = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*([:(])([\s\S]*)$/;

/** メンバ名ごとの `?` の有無・メソッドか・型の原文・ネストしたオブジェクト型の本文。 */
function typedMembersOf(body: string): Map<string, TypedMember> {
  const members = new Map<string, TypedMember>();
  for (const statement of statementsOf(body)) {
    const m = MEMBER_FULL.exec(statement);
    if (m === null) continue;
    const open = statement.indexOf("{");
    members.set(m[1], {
      optional: m[2] === "?",
      method: m[3] === "(",
      type: m[3] === ":" ? m[4].trim() : "",
      nested: open === -1 ? null : balancedBody(statement, open),
    });
  }
  return members;
}

/**
 * 4.0 が持たないと決めたメンバ（消費側はどれも optional 扱い、または読まない）。ここに書いたものは、
 * 実物に**現れないこと**も確かめる — 4.0 が足したらこの表から外して形の検査に載せる。
 */
const ABSENT_IN_4: Readonly<Record<string, string>> = {
  "IDevtoolsSourceLike.getDeclaredBindings":
    "4.0 は宣言レベルのバインディングを引く口を持たない。devtools は自前の declaredScan に倒れる（optional）",
  "IListIndexLike.index":
    "4.0 の listIndex は indexes だけ。devtools が読むのも indexes だけ（DevtoolsCore の address.listIndex?.indexes）",
};

/** 消費側が知っているが 4.0 が送らないイベントの種別。送ったら落ちる（この表から外して形の検査に載せる）。 */
const NOT_EMITTED_BY_4: Readonly<Record<string, string>> = {
  "state:binding-cleared": "4.0 の台帳は binding-added / binding-removed の差分だけで、まとめて消す通知を持たない",
  "propagation:suppressed": "4.0 は enablePropagationContext を外した（双方向の伝播の文脈が無い）",
  "propagation:coalesced": "同上",
  "propagation:hop-limit": "同上",
};

/**
 * INTERFACE_PAIRS の消費側インターフェースを、4.0 の実物でどう確かめるか。"shape" は実物の値の
 * キーと突き合わせる、"called" はランタイムが呼ぶ側（聞き手）なので、呼ばれたメンバと突き合わせる。
 * それ以外の文字列は 4.0 が作らない理由。対応表に足したらここにも 1 行要る（下の網羅テストが落とす）。
 */
const RUNTIME_4_CHECK: Readonly<Record<string, string>> = {
  IStateElementSummaryLike: "shape",
  IKeyedSubscriptionSummaryLike: "shape",
  IDevtoolsSourceLike: "shape",
  IDevtoolsHookRegistryLike: "shape",
  IDevtoolsListenerLike: "called",
  IMountOverlaySummaryLike: "4.0 はマウントのオーバーレイのアドレス空間を持たず、overlays() はいつも空配列",
  IDeclaredFilterLike: "getDeclaredBindings の中にだけ現れる（4.0 に無い、ABSENT_IN_4）",
  IDeclaredBindingLike: "getDeclaredBindings の中にだけ現れる（4.0 に無い、ABSENT_IN_4）",
};

describe("4.0 のランタイム（packages/state の devtools の後付け）の実物の形が、消費側のメンバを含むこと", () => {
  const consumerSource = stripComments(readFileSync(CONSUMER_TYPES, "utf8"));
  const consumerVariants = variantsByType(unionBody(consumerSource, "DevtoolsEventLike"));
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  let seq = 0;

  /** 見出し（インターフェース名・`event <type>`・ネストの経路）ごとの、実物に現れたキーの和と、宣言。 */
  const seen = new Map<string, { keys: Set<string>; members: Map<string, TypedMember> }>();
  /** 必須（`?` の無い）メンバが欠けた値。 */
  const missingRequired: string[] = [];
  const events: Record<string, unknown>[] = [];
  const called = new Set<string>();
  let registry: any;
  let source: any;
  let root: ShadowRoot;

  const itemsOf = (v: unknown): unknown[] =>
    v instanceof Set || Array.isArray(v) ? [...v] : v instanceof Map ? [...v.values()] : [v];

  function visit(label: string, value: unknown, members: Map<string, TypedMember>): void {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
    let entry = seen.get(label);
    if (entry === undefined) seen.set(label, (entry = { keys: new Set(), members }));
    const object = value as Record<string, unknown>;
    for (const [name, member] of members) {
      if (!(name in object)) {
        if (!member.optional) missingRequired.push(`${label}.${name}`);
        continue;
      }
      entry.keys.add(name);
      const v = object[name];
      if (member.nested !== null) {
        for (const item of itemsOf(v)) visit(`${label}.${name}`, item, typedMembersOf(member.nested));
      }
      const ref = member.method ? null : /\b(I[A-Za-z0-9_]+Like)\b/.exec(member.type);
      if (ref !== null) {
        for (const item of itemsOf(v)) visit(ref[1], item, typedMembersOf(interfaceBody(consumerSource, ref[1])));
      }
    }
  }
  const visitInterface = (name: string, value: unknown): void =>
    visit(name, value, typedMembersOf(interfaceBody(consumerSource, name)));

  async function page(html: string, state: Record<string, unknown>) {
    const host = document.createElement(`types-drift-host-${seq++}`);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<wcs-state></wcs-state>${html}`;
    const el = shadow.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(host);
    await el.connectedCallbackPromise;
    await getBindingsReady(shadow);
    await flush();
    const write = async (fn: (s: any) => void): Promise<void> => {
      el.createState("writable", fn);
      for (let i = 0; i < 3; i++) await flush();
    };
    return { host, shadow, el, write };
  }

  beforeAll(async () => {
    const quiet = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
    ];
    try {
      // 全部入りの入口: devtools・temporal・diagnostics を含むすべての後付けを入れる
      bootstrapState({ enableContractAnalyzer: true });
      registry = (globalThis as any)["__WCSTACK_DEVTOOLS_HOOK__"];
      registry.addListener({
        onSourceRegistered: (s: unknown) => {
          called.add("onSourceRegistered");
          source ??= s;
        },
        onSourceUnregistered: () => {
          called.add("onSourceUnregistered");
        },
        onEvent: (_id: string, e: Record<string, unknown>) => {
          called.add("onEvent");
          events.push(e);
        },
      });

      const throwing = `types-drift-throw-${seq++}`;
      customElements.define(throwing, class extends HTMLElement {
        set val(v: number) {
          if (v === 2) throw new Error("no 2");
        }
      });
      const main = await page(
        `<p>{{ title }}</p><p>{{ user.nmae }}</p><${throwing} data-wcs="val: n"></${throwing}>` +
          `<ul><template data-wcs="for: items"><li data-wcs="class.sel: .sel">{{ .v }}</li></template></ul>`,
        {
          title: "t",
          n: 1,
          selected: 1,
          user: { name: "a" },
          items: [{ id: 1, v: 1 }, { id: 2, v: 2 }],
          get "items.*.sel"() {
            return (this as any).$eq("selected", (this as any)["items.*.id"]);
          },
          $commandTokens: ["go"],
          $eventTokens: ["done"],
          $listKeys: { items: "id" },
          $watch: {
            n(cur: number) {
              if (cur === 3) throw new Error("bad handler");
            },
            "user.agee"() {},
          },
        },
      );
      root = main.shadow;
      // write / update-batch / 行の binding-added（行の添字つきのアドレス）/ binding-apply-error / watch-fired
      await main.write((s) => {
        s.items = [...s.items, { id: 3, v: 3 }];
        s.n = 2;
      });
      // 行の中の書き込み（listIndex つきの write）
      await main.write((s) => {
        s.$resolve("items.*.v", [0], 9);
      });
      // binding-removed / watch-error（handler）
      await main.write((s) => {
        s.items = s.items.slice(0, 1);
        s.n = 3;
      });
      main.el.createState("readonly", (s: any) => {
        s.$command.go.emit(1, 2);
      });

      // watch-chain-limit
      const chain = await page(`<p>{{ m }}</p>`, {
        m: 0,
        $watch: {
          m(this: any, cur: number) {
            this.m = cur + 1;
          },
        },
      });
      await chain.write((s) => {
        s.m = 1;
      });
      for (let i = 0; i < 5; i++) await flush();
      // render-chain-limit: $renderedCallback が毎回書き込む
      const render = await page(`<p>{{ k }}</p>`, {
        k: 0,
        $renderedCallback(this: any) {
          this.k = this.k + 1;
        },
      });
      await render.write((s) => {
        s.k = 1;
      });
      for (let i = 0; i < 10; i++) await flush();

      // contract:*（enableContractAnalyzer）
      const contracted = `types-drift-contract-${seq++}`;
      customElements.define(contracted, class extends HTMLElement {
        static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: "drift:status" }] };
      });
      analyzeContract({
        manifestExtensions: {
          "example.unknown": {},
          "wcstack.types": {
            components: {
              "types-drift-not-defined": {},
              [contracted]: { observables: { status: { event: "drift:other" }, missing: {} } },
            },
          },
        },
      });

      // element-unregistered
      chain.host.remove();
      render.host.remove();
      await flush();

      // ランタイムが作ったレジストリの unregister が聞き手を呼ぶこと（ダミーのソースで）
      registry.register({ id: "types-drift-dummy", _setSink() {} });
      registry.unregister("types-drift-dummy");
    } finally {
      for (const spy of quiet) spy.mockRestore();
    }

    for (const e of events) {
      const variant = consumerVariants.get(String(e.type));
      if (variant !== undefined) visit(`event ${String(e.type)}`, e, typedMembersOf(variant));
    }
    visitInterface("IDevtoolsHookRegistryLike", registry);
    for (const summary of source.getStateElements()) visitInterface("IStateElementSummaryLike", summary);
    for (const keyed of source.keyedSubscriptions(root)) visitInterface("IKeyedSubscriptionSummaryLike", keyed);
  });

  afterAll(() => {
    document.body.replaceChildren();
  });

  it("シナリオが要約・鍵付き購読・イベントを実際に作った（空振りしていない）", () => {
    expect(source.getStateElements().length).toBeGreaterThan(0);
    expect(source.keyedSubscriptions(root).length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
  });

  it("4.0 が送るイベントの種別は、どれも消費側が知っている", () => {
    const unknown = [...new Set(events.map((e) => String(e.type)))].filter((t) => !consumerVariants.has(t));
    expect(unknown).toEqual([]);
  });

  it("消費側のイベントの種別は、4.0 が送ったか、送らない理由が書いてある（書いたものは送られない）", () => {
    const sent = new Set(events.map((e) => String(e.type)));
    const unexplained = [...consumerVariants.keys()].filter((t) => !sent.has(t) && !(t in NOT_EMITTED_BY_4));
    expect(unexplained).toEqual([]);
    expect(Object.keys(NOT_EMITTED_BY_4).filter((t) => sent.has(t))).toEqual([]);
  });

  it("どの値も、消費側が必須（? なし）とするメンバを持つ", () => {
    expect([...new Set(missingRequired)].filter((m) => !(m in ABSENT_IN_4))).toEqual([]);
  });

  it("送られた・引いた形のキーの和が、消費側の宣言するメンバをすべて含む（4.0 に無いと書いたものを除き、それは現れない）", () => {
    const gaps: string[] = [];
    const present: string[] = [];
    for (const [label, { keys, members }] of seen) {
      for (const name of members.keys()) {
        const id = `${label}.${name}`;
        if (id in ABSENT_IN_4) {
          if (keys.has(name)) present.push(id);
        } else if (!keys.has(name)) {
          gaps.push(id);
        }
      }
    }
    expect(gaps).toEqual([]);
    expect(present).toEqual([]);
    // 4.0 に無いと書いたメンバの持ち主は、実物で確かめた（表が空振りしていない）
    for (const id of Object.keys(ABSENT_IN_4)) expect(seen.has(id.slice(0, id.lastIndexOf("."))), id).toBe(true);
  });

  it("INTERFACE_PAIRS の消費側インターフェースはどれも、実物で確かめたか、確かめない理由が書いてある", () => {
    expect(Object.keys(RUNTIME_4_CHECK).sort()).toEqual(INTERFACE_PAIRS.map(([, consumer]) => consumer).sort());
    for (const [consumer, check] of Object.entries(RUNTIME_4_CHECK)) {
      if (check === "shape") expect(seen.has(consumer), consumer).toBe(true);
    }
  });

  it("聞き手（IDevtoolsListenerLike）のメンバは、どれもランタイムのレジストリから呼ばれる", () => {
    const members = [...typedMembersOf(interfaceBody(consumerSource, "IDevtoolsListenerLike")).keys()].sort();
    expect([...called].sort()).toEqual(members);
  });

  it("4.0 が作らないと書いた形は、実物でも作られない", () => {
    expect(source.overlays(root)).toEqual([]);
    expect(source.getDeclaredBindings).toBeUndefined();
  });
});
