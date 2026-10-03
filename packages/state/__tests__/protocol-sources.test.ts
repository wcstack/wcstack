/**
 * The 4.0 engine and the canonical protocol sources (/protocol/*.ts).
 *
 * State carries generated copies of two of them only (binder, transition-runner — kept in step by
 * `scripts/sync-protocol-types.mjs --check`). It reads wc-bindable declarations in src/dom/wc.ts and
 * installs the SSR snapshot builder in src/ssr/ssr.ts with constants of its own, so nothing else
 * notices those drifting from the canonical sources. And the build shortens the property names
 * listed in mangle.mjs: a protocol key added there breaks every bundle while the tests on src pass
 * (the binder's `range` was checked against src only). Here the canonical readers run against
 * state's real objects, and every member of the canonical interfaces is checked against mangle.mjs.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
// @ts-ignore — a plain ES module next to build.mjs
import { MANGLE_PROPS } from "../mangle.mjs";
import { installFeatures, ssr } from "../src/index";
import { readBindable } from "../src/dom/wc";

const PROTOCOL_DIR = resolve(__dirname, "..", "..", "..", "protocol");
// The canonical sources, loaded as modules (vitest transforms the TypeScript). `as string` keeps tsc
// from resolving them: they are outside this package's rootDir (TS6059).
const ssrSnapshot = (): Promise<any> => import("../../../protocol/ssr-snapshot.ts" as string);
const wcBindableReader = (): Promise<any> => import("../../../protocol/wc-bindable-reader.ts" as string);

/** Canonical sources whose shapes never cross state's bundle (every other one does). */
const NOT_SPOKEN_BY_STATE: Readonly<Record<string, string>> = {
  "wc-bindable-reader.ts":
    "the reader's own result types; state reads declarations itself (src/dom/wc.ts), with the keys of wc-bindable.ts",
  "upgrade-properties.ts": "a helper for the I/O node shells; it declares no shape",
};

/** The member names of every interface in a canonical source, by interface. */
function interfaceMembers(file: string): Map<string, string[]> {
  const source = ts.createSourceFile(file, readFileSync(resolve(PROTOCOL_DIR, file), "utf8"), ts.ScriptTarget.Latest, true);
  const out = new Map<string, string[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node)) {
      const names: string[] = [];
      for (const m of node.members) {
        if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name !== undefined && ts.isIdentifier(m.name)) names.push(m.name.text);
      }
      out.set(node.name.text, names);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const spokenSources = (): string[] =>
  readdirSync(PROTOCOL_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !(f in NOT_SPOKEN_BY_STATE));

describe("正本のプロトコルのキーは、ビルドが縮める名前（mangle.mjs）に入らない", () => {
  it("state が話すプロトコルのインターフェースのメンバは、どれも縮める名前に当たらない", () => {
    const shortened: string[] = [];
    const checked = new Set<string>();
    for (const file of spokenSources()) {
      for (const [iface, names] of interfaceMembers(file)) {
        for (const name of names) {
          checked.add(name);
          if (MANGLE_PROPS.test(name)) shortened.push(`${file} ${iface}.${name}`);
        }
      }
    }
    expect(shortened).toEqual([]);
    // the table is not empty: the binder's keys, the transition runner's, the SSR builder's, wc-bindable's
    for (const name of ["bind", "range", "run", "accepts", "naming", "build", "reset", "properties", "inputs", "commands", "semantics"]) {
      expect(checked.has(name), name).toBe(true);
    }
  });

  it("state が話さないとした正本は、まだあって、理由が書いてある", () => {
    const files = readdirSync(PROTOCOL_DIR);
    for (const file of Object.keys(NOT_SPOKEN_BY_STATE)) expect(files, file).toContain(file);
  });
});

describe("state が自前で持つプロトコルの定数は、正本と一致する", () => {
  it("SSR のスナップショットの builder: 正本の読み手（getSsrSnapshotBuilder）が、state の入れた builder を受け取る", async () => {
    const proto = await ssrSnapshot();
    expect(proto.SSR_SNAPSHOT_BUILDER_KEY).toBe(Symbol.for("wcstack.ssr.snapshotBuilder"));
    const before = (globalThis as any)[proto.SSR_SNAPSHOT_BUILDER_KEY];
    expect(before).toBeUndefined();
    installFeatures([ssr]);
    const builder = proto.getSsrSnapshotBuilder();
    expect(builder).not.toBeNull();
    expect(builder).toBe((globalThis as any)[proto.SSR_SNAPSHOT_BUILDER_KEY]);
    // the optional member the renderer calls as `builder.reset?.()`
    expect(typeof builder.reset).toBe("function");
    // state's own declaration (src/ssr/ssr.ts) names the same key
    expect(readFileSync(resolve(__dirname, "..", "src", "ssr", "ssr.ts"), "utf8")).toContain(`Symbol.for("${proto.SSR_SNAPSHOT_BUILDER_KEY.description}")`);
  });

  describe("wc-bindable の宣言の読み方: 正本の読み手（readBindableDeclaration）と state の readBindable", () => {
    const getter = (e: Event): unknown => (e as CustomEvent).detail;
    const declare = (wcBindable: unknown) => class extends EventTarget {
      static wcBindable = wcBindable;
    };
    const full = {
      protocol: "wc-bindable",
      version: 1,
      properties: [
        { name: "value", event: "x:value", getter },
        { name: "pressed", event: "x:pressed", semantics: "event" },
        { name: "stream", event: "x:stream", semantics: "handle" },
      ],
      inputs: [{ name: "src", attribute: "src" }, { name: "mode" }],
      commands: [{ name: "start", async: true }, { name: "stop" }],
    };

    it("正本の宣言のキーは、state が読むキー（と、読まない async）のまま", () => {
      const members = interfaceMembers("wc-bindable.ts");
      expect(members.get("IWcBindable")).toEqual(["protocol", "version", "properties", "inputs", "commands"]);
      expect(members.get("IWcBindableProperty")).toEqual(["name", "event", "getter", "semantics"]);
      expect(members.get("IWcBindableInput")).toEqual(["name", "attribute"]);
      // state calls a command and does not await it (the command-token protocol), so `async` is not read
      expect(members.get("IWcBindableCommand")).toEqual(["name", "async"]);
      // state treats `semantics: "event"` as an occurrence (written even when equal): a canonical value
      const text = readFileSync(resolve(PROTOCOL_DIR, "wc-bindable.ts"), "utf8");
      expect(text).toMatch(/type WcBindableSemantics = [^;]*"event"/);
    });

    it("同じ宣言から、同じプロパティ（イベント・getter・event の意味）・入力（属性）・コマンドを読む", async () => {
      const { readBindableDeclaration } = await wcBindableReader();
      const Fixture = declare(full);
      const ref = readBindableDeclaration(new Fixture());
      const own = readBindable(Fixture as unknown as CustomElementConstructor)!;
      expect(ref).not.toBeNull();
      expect(own).not.toBeNull();
      expect([...own.properties.keys()]).toEqual([...ref.knownProperties.keys()]);
      for (const [name, p] of ref.knownProperties) {
        const mine = own.properties.get(name)!;
        expect(mine.event, name).toBe(p.event);
        expect(mine.getter, name).toBe(p.getter ?? null);
        expect(mine.occurrence, name).toBe(p.semantics === "event");
      }
      expect([...own.inputs]).toEqual([...ref.declaredInputs].map(([name, i]: [string, any]) => [name, { attribute: i.attribute ?? null }]));
      expect([...own.commands]).toEqual([...ref.declaredCommands.keys()]);
    });

    it("protocol の名前と版の下限で、同じ宣言を受け付け、同じ宣言を拒む", async () => {
      const { readBindableDeclaration, MIN_WC_BINDABLE_VERSION } = await wcBindableReader();
      const cases: [string, unknown, boolean][] = [
        ["版の下限ちょうど", { protocol: "wc-bindable", version: MIN_WC_BINDABLE_VERSION, properties: [] }, true],
        ["版の下限より上", { protocol: "wc-bindable", version: MIN_WC_BINDABLE_VERSION + 1, properties: [] }, true],
        ["版の下限より下", { protocol: "wc-bindable", version: MIN_WC_BINDABLE_VERSION - 1, properties: [] }, false],
        ["整数でない版", { protocol: "wc-bindable", version: MIN_WC_BINDABLE_VERSION + 0.5, properties: [] }, false],
        ["別の protocol", { protocol: "wcs-bindable", version: MIN_WC_BINDABLE_VERSION, properties: [] }, false],
        ["宣言が無い", undefined, false],
      ];
      for (const [label, decl, accepted] of cases) {
        const Fixture = declare(decl);
        expect(readBindableDeclaration(new Fixture()) !== null, `${label}（正本）`).toBe(accepted);
        expect(readBindable(Fixture as unknown as CustomElementConstructor) !== null, `${label}（state）`).toBe(accepted);
      }
    });
  });
});
