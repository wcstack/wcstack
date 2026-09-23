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
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNTIME_TYPES = resolve(__dirname, "..", "..", "state", "src", "devtools", "types.ts");
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
    // 見つからないときは skip せず落とす — 番人が黙って空振りするほうが有害
    // （このリポジトリでは packages/state は常に隣にある）。
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
