// S4, eighth slice (wiring design §3 H3): the DCC branch leaves `State`. It was the last value
// import from the element into a feature (`defineDCC`). A `<wcs-state>` inside a
// `[data-wc-definition]` host builds no tree of its own: it loads its source, defines the host's
// custom element from the template (`defineDCC`) and is done. That is exactly the `connecting` shape
// of the first slice ("claim this connect, or return null"), at order 10 — ahead of the volume (20)
// and bind-component (30), which is the order the branches had in `connectedCallback`.
// Two things the branch did with private members become the element's internal surface:
//   * `_failInitializeLoudly(error)` — a DCC load failure lands like `_initialize`'s (#257), which a
//     volume's does not, so the landing cannot move into the core's `await claimed`;
//   * `_dcc = true` — "initialized without a tree of its own", which the reconnect branch reads to
//     skip re-registering the element as the root node's tree. It is a core notion, so the flag
//     stays in `State` under that name (`markTreeless`), and DCC is only its first user.
// The readiness barrier (D13) gains the DCC form next to `mount=`, in the same place and order.
// Applied to a sandbox copy carrying S3's three slices and S4's first seven; anchors must match once.
//   node scripts/research/s4DccLifecyclePatch.mjs <sandbox>/packages/state
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4DccLifecyclePatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const edit of edits) {
    if (edit.length === 3) {
      const [start, end, replacement] = edit;
      const s = code.indexOf(start);
      if (s === -1 || code.indexOf(start, s + 1) !== -1) throw new Error(`${rel}: start anchor not unique: ${start.slice(0, 70)}`);
      const e = code.indexOf(end, s);
      if (e === -1 || code.indexOf(end, e + 1) !== -1) throw new Error(`${rel}: end anchor not unique: ${end.slice(0, 70)}`);
      code = code.slice(0, s) + replacement + code.slice(e + end.length);
      continue;
    }
    const [anchor, replacement] = edit;
    const count = code.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${rel}: anchor found ${count} times: ${anchor.slice(0, 70)}`);
    code = code.replace(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}
async function create(rel, content) {
  const file = join(pkg, rel);
  try { await access(file); console.log('already created', rel); return; } catch { /* create */ }
  await writeFile(file, content);
  console.log('created', rel);
}

// 1. the feature module
await create('src/dcc/dccLifecycle.ts', `/**
 * dcc/dccLifecycle.ts — DCC 定義要素（\`[data-wc-definition]\` ホストの ShadowRoot 内の \`<wcs-state>\`）の
 * 接続（設計案 H3、S4）。この \`<wcs-state>\` は自分のツリーを持たない: ソースを読み、ホストの
 * テンプレートからカスタム要素を定義して（defineDCC）初期化を終える。
 *
 * 従来 \`State.connectedCallback\` の先頭の分岐と private メソッド \`_initializeDCC\` だったもの。
 * 聞く順は order 10 — ボリューム（20）・bind-component（30）より先という従来の分岐順を番号で固定する。
 * 要素から要るのは内部面の 5 つ（\`failInitializeLoudly\` / \`markTreeless\` / \`markInitialized\` /
 * \`clearConnectedRootNode\` / \`settleInitialization\`）だけ。
 */
import type { IStateElement } from "../components/types";
import { ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";
import { DCC_DEFINITION_ATTRIBUTE } from "../define";
import { raiseError } from "../raiseError";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { IState } from "../types";
import { defineDCC } from "./defineDCC";

async function loadDccState(el: HTMLElement, hostElement: Element): Promise<IState> {
  try {
    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src')!;
      if (src.endsWith('.js')) {
        return await loadFromScriptFile(src);
      }
      raiseError(\`DCC: Unsupported src type: \${src}\`);
    }
    const script = el.querySelector<HTMLScriptElement>('script[type="module"]');
    if (script) {
      return await loadFromInnerScript(script, hostElement.tagName.toLowerCase());
    }
    raiseError(\`DCC: No state source found for "\${hostElement.tagName.toLowerCase()}".\`);
  } catch (e) {
    raiseError(\`DCC: Failed to load state: \${e}\`);
  }
}

async function initializeDcc(element: IStateElement, hostElement: Element, shadowRoot: ShadowRoot): Promise<void> {
  const el = element as unknown as HTMLElement;
  try {
    // DCC と bind-component は排他。DCC の state はテンプレートに属し、
    // インスタンスごとにロードされるので、定義時点のホストのプロパティを
    // ソースにする bind-component とは両立しない。従来はこの return で
    // 無言に無視していた（docs/architecture-hardening/15 §3.1）。
    if (el.hasAttribute("bind-component")) {
      raiseError(\`"bind-component" cannot be used inside a [\${DCC_DEFINITION_ATTRIBUTE}] host. DCC state comes from the template, not from a component property.\`);
    }
    const state = await loadDccState(el, hostElement);
    defineDCC(hostElement, shadowRoot, state);
    // 自分のツリーを持たない: 再接続でこの rootNode のツリーとして登録し直さない
    element.markTreeless!();
    element.markInitialized!();
    element.clearConnectedRootNode!(); // disconnectedCallbackでのstate参照を防止
    element.settleInitialization!();
  } catch (error) {
    // _initialize と同じ着地（#257）。DCC のロード失敗もここまでは
    // 「throw が connectedCallback の外へ出るだけ」＝ 無言のハングだった
    element.failInitializeLoudly!(error);
  }
}

export const dccLifecycleHooks: ILifecycleHooks = {
  order: 10,
  connecting(element) {
    // DCC 検出: ShadowRoot 内かつホストに data-wc-definition がある場合
    const parentNode = (element as unknown as HTMLElement).parentNode;
    if (!(parentNode instanceof ShadowRoot) || !parentNode.host.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) {
      return null;
    }
    return initializeDcc(element, parentNode.host, parentNode);
  },
};

let installed = false;
/** 冪等。full / auto では \`bootstrapState()\` が呼ぶ */
export function installDccLifecycle(): void {
  if (installed) return;
  installed = true;
  registerLifecycleHooks("dcc", dccLifecycleHooks);
}
`);

// 2. the element's internal surface
await patch('src/components/types.ts', 'markTreeless', [
  [`  loadStateFromSource?(): Promise<Record<string, any>>;\n`,
   `  loadStateFromSource?(): Promise<Record<string, any>>;\n  /** 自分のツリーを持たずに初期化を終えた印（DCC 定義要素。再接続でこの rootNode のツリーとして登録し直さない） */\n  markTreeless?(): void;\n  /** 初期化失敗の着地（診断 1 件・connectedCallbackPromise の reject — #257）。常に throw する */\n  failInitializeLoudly?(error: unknown): never;\n`],
]);

// 3. State: the branch and the method go; the barrier and the flag stay (core notions)
await patch('src/components/State.ts', 'markTreeless()', [
  [`import { defineDCC } from "../dcc/defineDCC";\n`, ``],
  [`  private _dcc: boolean = false;\n`,
   `  // 自分のツリーを持たずに初期化を終えた（DCC 定義要素 — dcc/dccLifecycle.ts）。再接続でこの rootNode の\n  // ツリーとして登録し直さない\n  private _treeless: boolean = false;\n`],
  [`   * \`connectedCallback\` が \`_initialize\` より前に await する 2 つ\n   * （\`_initializeDCC\` / \`_initializeBindWebComponent\`）の raise も同じ着地に載る。\n`,
   `   * \`connectedCallback\` が \`_initialize\` より前に await する 2 つ\n   * （DCC の接続 — dcc/dccLifecycle.ts が内部面の \`failInitializeLoudly\` で載せる — と、\n   * \`bind-component\` の preparing）の raise も同じ着地に載る。\n`],
  [`  private async _initializeDCC(hostElement: Element, shadowRoot: ShadowRoot): Promise<void> {\n`,
   `    this._resolveConnectedCallback?.();\n  }\n\n  private _callStateDisconnectedCallback`,
   `  private _callStateDisconnectedCallback`],
  [`      // DCC 検出: ShadowRoot 内かつホストに data-wc-definition がある場合\n`,
   `      // この接続を引き取る機能（ボリューム \`mount=\` — webComponent/volumeLifecycle.ts。設計案 H3）。\n`,
   `      // この接続を引き取る機能（DCC 定義要素 — dcc/dccLifecycle.ts、ボリューム \`mount=\` —\n      // webComponent/volumeLifecycle.ts。設計案 H3。聞く順は DCC → ボリュームで、従来の分岐順どおり）。\n`],
  [`      if (this.hasAttribute("mount")) {\n        // 引き取り手の居ない \`mount=\` ＝ スコープ機能が未 install（readiness barrier、H5 / D13）。\n        // full / auto では bootstrapState() が install するので起きない\n        requireLifecycleFeature("scopes", \`the "mount" attribute\`);\n      }\n`,
   `      // 引き取り手の居ない宣言 ＝ その機能が未 install（readiness barrier、H5 / D13）。\n      // full / auto では bootstrapState() が install するので起きない\n      const parentNode = this.parentNode;\n      if (parentNode instanceof ShadowRoot && parentNode.host.hasAttribute(DCC_DEFINITION_ATTRIBUTE)) {\n        requireLifecycleFeature("dcc", \`a <\${config.tagNames.state}> inside a [\${DCC_DEFINITION_ATTRIBUTE}] host\`);\n      }\n      if (this.hasAttribute("mount")) {\n        requireLifecycleFeature("scopes", \`the "mount" attribute\`);\n      }\n`],
  [`    } else if (!this._dcc && getStateElement(this._rootNode) !== this) {\n      // 再接続（disconnect で名前登録が解除された後の再 connect）: 登録を復元する。\n`,
   `    } else if (!this._treeless && getStateElement(this._rootNode) !== this) {\n      // 再接続（disconnect で名前登録が解除された後の再 connect）: 登録を復元する。\n      // 自分のツリーを持たない要素（DCC 定義要素）は登録しない。\n`],
  [`  loadStateFromSource(): Promise<Record<string, any>> {\n    return this._loadStateFromSource();\n  }\n`,
   `  loadStateFromSource(): Promise<Record<string, any>> {\n    return this._loadStateFromSource();\n  }\n\n  markTreeless(): void {\n    this._treeless = true;\n  }\n\n  /** 初期化失敗の着地（\`_failInitializeLoudly\`）。接続を引き取った機能が自分の失敗を載せる */\n  failInitializeLoudly(error: unknown): never {\n    return this._failInitializeLoudly(error);\n  }\n`],
]);

// 4. the entry installs it (the connect of a DCC template's <wcs-state> can come before any binding)
await patch('src/bootstrapState.ts', 'installDccLifecycle', [
  [`import { installVolumeGraft } from "./webComponent/volume";\n`,
   `import { installVolumeGraft } from "./webComponent/volume";\nimport { installDccLifecycle } from "./dcc/dccLifecycle";\n`],
  [`  installVolumeGraft();\n  registerComponents(registry);\n`,
   `  installVolumeGraft();\n  installDccLifecycle();\n  registerComponents(registry);\n`],
]);

// 5. test-side: this unit test drives the element without `bootstrapState()`, so it installs the
//    feature itself — what a split entry's page does
await patch('__tests__/dcc.State.test.ts', 'installDccLifecycle', [
  [`import { installDccHooks } from "../src/dcc/addressHooks";\n`,
   `import { installDccHooks } from "../src/dcc/addressHooks";\nimport { installDccLifecycle } from "../src/dcc/dccLifecycle";\n`],
  [`if (!customElements.get(STATE_TAG)) {\n  customElements.define(STATE_TAG, State);\n}\n`,
   `if (!customElements.get(STATE_TAG)) {\n  customElements.define(STATE_TAG, State);\n}\n// bootstrapState() を経ないので、DCC の接続を引き取る機能を自分で install する（分割エントリのページと同じ）\ninstallDccLifecycle();\n`],
]);

// 6. two registry probes that earlier slices exported but nothing ever called (they were the only
//    functions the coverage run found unexecuted). The barrier asks "did anyone claim it", not
//    "is it registered", so they have no caller to wait for.
async function removeOnce(rel, text) {
  const file = join(pkg, rel);
  const code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  const count = code.split(text).length - 1;
  if (count === 0) { console.log('already removed', rel); return; }
  if (count !== 1) throw new Error(`${rel}: found ${count} times: ${text.slice(0, 70)}`);
  await writeFile(file, code.replace(text, ''));
  console.log('patched', rel);
}
await removeOnce('src/core/lifecycleHooks.ts', `export function isLifecycleFeatureRegistered(feature: string): boolean {\n  return registry.has(feature);\n}\n\n`);
await removeOnce('src/core/declarationHooks.ts', `export function isDeclarationFeatureRegistered(feature: string): boolean {\n  return registry.has(feature);\n}\n\n`);
// `CLAIMED` (first slice) was the one call initializer left at module evaluation, which the CI gate
// (`audit-state-tech-coupling.mjs --check`, evaluatedModules = ["auto.ts"]) would reject on the port
await patch('src/core/lifecycleHooks.ts', 'CLAIMED: Promise<void> = /*#__PURE__*/', [
  [`export const CLAIMED: Promise<void> = Promise.resolve();\n`,
   `export const CLAIMED: Promise<void> = /*#__PURE__*/ Promise.resolve();\n`],
]);

// 7. boundary test: the barrier for both lifecycle-claimed declarations, and the `order` contract
await create('__tests__/core.lifecycleHooks.test.ts', `import { describe, it, expect, vi, afterEach } from "vitest";
import { State } from "../src/components/State";
import { registerLifecycleHooks, runConnecting, CLAIMED } from "../src/core/lifecycleHooks";
import type { IStateElement } from "../src/components/types";

/**
 * ライフサイクルの受け口（core/lifecycleHooks.ts、設計案 H3・H5）の境界。
 * このファイルは bootstrapState() を呼ばないので、どの機能も install されていない
 * （＝ 分割エントリで機能を install し忘れたページと同じ）。
 */
const STATE_TAG = "wcs-state-lifecycle-boundary";
if (!customElements.get(STATE_TAG)) {
  customElements.define(STATE_TAG, State);
}

describe("core/lifecycleHooks — readiness barrier", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dcc 未 install で [data-wc-definition] ホスト内の <wcs-state> を接続すると名指しで落ちること", async () => {
    const host = document.createElement("x-lifecycle-dcc-host");
    host.setAttribute("data-wc-definition", "");
    const shadow = host.attachShadow({ mode: "open" });
    const stateEl = document.createElement(STATE_TAG) as State;
    shadow.appendChild(stateEl);
    await expect((stateEl as any).connectedCallback())
      .rejects.toThrow(/\\[wcs\\/feature-not-installed\\] a <wcs-state> inside a \\[data-wc-definition\\] host needs the "dcc" feature/);
  });

  it("scopes 未 install で mount= を接続すると名指しで落ちること", async () => {
    const stateEl = document.createElement(STATE_TAG) as State;
    stateEl.setAttribute("mount", "vol");
    document.body.appendChild(stateEl);
    await expect((stateEl as any).connectedCallback())
      .rejects.toThrow(/\\[wcs\\/feature-not-installed\\] the "mount" attribute needs the "scopes" feature/);
  });
});

describe("core/lifecycleHooks — order", () => {
  it("install の順ではなく order の昇順で聞き、最初に引き取った機能で確定すること", () => {
    const asked: string[] = [];
    const element = {} as IStateElement;
    registerLifecycleHooks("test-late", {
      order: 20,
      connecting: () => { asked.push("late"); return CLAIMED; },
    });
    registerLifecycleHooks("test-early", {
      order: 10,
      connecting: () => { asked.push("early"); return null; },
    });
    expect(runConnecting(element)).toBe(CLAIMED);
    expect(asked).toEqual(["early", "late"]);
  });

  it("同じ機能名の再登録は置き換えで、二重に聞かないこと（install の冪等）", () => {
    const connecting = vi.fn(() => null);
    registerLifecycleHooks("test-idempotent", { order: 5, connecting });
    registerLifecycleHooks("test-idempotent", { order: 5, connecting });
    runConnecting({} as IStateElement);
    expect(connecting).toHaveBeenCalledTimes(1);
  });
});
`);
console.log('done');
