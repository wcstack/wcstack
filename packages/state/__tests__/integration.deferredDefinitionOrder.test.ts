import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

let counter = 0;
function uniqueTag(prefix: string): string {
  return `${prefix}-${++counter}`;
}

async function flushUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const writes: string[] = [];

/** name: two-way（出力 ＋ 入力）、status: 出力専用。setter への書き込みを記録する */
function probeClass(tag: string): CustomElementConstructor {
  return class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [
        { name: "status", event: `${tag}:status` },
        { name: "name", event: `${tag}:name` },
      ],
      inputs: [{ name: "name" }],
    };
    set name(v: unknown) {
      writes.push(`name=${String(v)}`);
      (this as any)._n = v;
      this.textContent = `hello ${v}`;
    }
    get name(): unknown { return (this as any)._n ?? "EL-NAME"; }
    set status(v: unknown) {
      writes.push(`status=${String(v)}`);
      (this as any)._s = v;
    }
    get status(): unknown { return (this as any)._s ?? "EL-STATUS"; }
  };
}

/**
 * 1 つのタグだけ「後から定義される」registry（integration.deferredDefinitionReconnect.test.ts と同じ形）。
 * 文書の中で registry を引かれた要素は、定義の後なら upgrade しておく（ブラウザの差し込み時の upgrade を模す）。
 */
function lateRegistry(tag: string) {
  const cls = probeClass(tag);
  let defined = false;
  let resolve!: (c: CustomElementConstructor) => void;
  const promise = new Promise<CustomElementConstructor>((r) => { resolve = r; });
  const registry = {
    get: (name: string) => (name === tag ? (defined ? cls : undefined) : customElements.get(name)),
    whenDefined: (name: string) => (name === tag ? promise : customElements.whenDefined(name)),
    upgrade: (root: Node) => {
      if (defined && (root as Element).localName === tag) Object.setPrototypeOf(root, cls.prototype);
    },
  };
  Object.defineProperty(HTMLElement.prototype, "customElementRegistry", {
    configurable: true,
    get(this: Element) {
      if (this.localName !== tag) return undefined;
      if (this.isConnected) registry.upgrade(this);
      return registry;
    },
  });
  return { define(): void { defined = true; resolve(cls); } };
}

async function mount(html: string) {
  const host = document.createElement(uniqueTag("x-order-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = html;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flushUpdates();
  return { host, shadowRoot, stateEl };
}

function read(stateEl: State, path: string): unknown {
  let value: unknown;
  stateEl.createState("readonly", (state: any) => {
    value = JSON.parse(JSON.stringify(state[path]));
  });
  return value;
}

async function write(stateEl: State, fn: (state: any) => void): Promise<void> {
  stateEl.createState("writable", fn);
  await flushUpdates();
}

/** 要素が値を持つ側のメンバー: 定義されても state の値を要素へ書かない。要素の値が state に入る（init=none は入らない） */
const MEMBERS = [
  { label: "出力専用メンバー", bind: (p: string) => `status: ${p}`, key: "st", state: "S", element: "EL-STATUS" },
  { label: "#init=element", bind: (p: string) => `name#init=element: ${p}`, key: "nm", state: "S", element: "EL-NAME" },
  { label: "#init=none", bind: (p: string) => `name#init=none: ${p}`, key: "nm", state: "S", element: null },
] as const;

/**
 * 後から定義される要素の二つの待ち — two-way・イベントを付けて初期同期する待ち（createContent で登録）と、
 * 値の遅延適用（活性化で登録）— は登録した順に走らなければならない。#357 の修正で前者だけを microtask に回したら
 * 順序が逆になり、初期同期の前に state の値が要素へ書かれた（`<wcs-storage value#init=element>` なら
 * 保存済みの値が state の初期値で上書きされる）。ノードごとの登録順を保つ。
 */
describe("後から定義される要素の初期同期と遅延適用の順序", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as any).customElementRegistry;
  });

  for (const member of MEMBERS) {
    it(`最初から真の if の中身: ${member.label} へ state の値を書かないこと`, async () => {
      const tag = uniqueTag("x-order");
      const late = lateRegistry(tag);
      const { host, shadowRoot, stateEl } = await mount(`
        <wcs-state json='{"show":true,"${member.key}":"${member.state}"}'></wcs-state>
        <template data-wcs="if: show"><${tag} data-wcs="${member.bind(member.key)}"></${tag}></template>
      `);
      writes.length = 0;
      late.define();
      await flushUpdates();
      expect(writes).toEqual([]);
      expect(read(stateEl, member.key)).toBe(member.element ?? member.state);
      expect(shadowRoot.querySelector(tag)).not.toBeNull();
      host.remove();
    });

    it(`定義の前に足した行: ${member.label} へ state の値を書かないこと`, async () => {
      const tag = uniqueTag("x-order");
      const late = lateRegistry(tag);
      const { host, stateEl } = await mount(`
        <wcs-state json='{"items":[{"${member.key}":"${member.state}0"}]}'></wcs-state>
        <ul><template data-wcs="for: items"><li><${tag} data-wcs="${member.bind(`.${member.key}`)}"></${tag}></li></template></ul>
      `);
      await write(stateEl, (s) => { s.items = [...s.items, { [member.key]: `${member.state}1` }]; });
      writes.length = 0;
      late.define();
      await flushUpdates();
      expect(writes).toEqual([]);
      expect((read(stateEl, "items") as any[]).map((item) => item[member.key])).toEqual(
        member.element === null ? [`${member.state}0`, `${member.state}1`] : [member.element, member.element],
      );
      host.remove();
    });
  }
});

/**
 * #352 の適用し直し・待ち直しは、その行が生きているときだけ。行から取り出した要素を、行が消えて（プールに入って）
 * から文書に戻しても、消えた行の値で適用・展開しない（エラーも出さない）。行が生きていれば、その行の値が入る。
 */
describe("行から取り出した要素を文書に戻す", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as any).customElementRegistry;
  });

  for (const [form, rowBind] of [["プロパティの束縛", "name: .name"], ["spread", "...: ."]] as const) {
    for (const rowAlive of [false, true]) {
      it(`${form}: 行が${rowAlive ? "生きている" : "消えた"}ときに戻してから定義すると、${rowAlive ? "その行の値が入る" : "適用も展開もせず、エラーも出さない"}こと`, async () => {
        const tag = uniqueTag("x-order");
        const late = lateRegistry(tag);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const { host, shadowRoot, stateEl } = await mount(`
          <wcs-state json='{"late":[{"name":"a"},{"name":"b"}]}'></wcs-state>
          <ul id="late"><template data-wcs="for: late"><li><${tag} data-wcs="${rowBind}"></${tag}></li></template></ul>
          <div id="park"></div>
        `);
        const el = shadowRoot.querySelector(`#late ${tag}`)!;
        document.createElement("div").append(el);
        await flushUpdates();
        if (!rowAlive) await write(stateEl, (s) => { s.late = [{ name: "b" }]; });
        shadowRoot.getElementById("park")!.append(el);
        await flushUpdates();

        writes.length = 0;
        late.define();
        await flushUpdates();
        expect(el.textContent).toBe(rowAlive ? "hello a" : "");
        expect(Array.from(shadowRoot.querySelectorAll(`#late ${tag}`)).map((node) => node.textContent)).toEqual(["hello b"]);
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
        host.remove();
      });
    }
  }
});
