// S5, second slice (wiring design §3 H8): SSR leaves the core.
// Server rendering and hydration were four of the remaining core -> feature edges, and about 960
// lines (`components/Ssr.ts`, `hydrateBindings.ts`, `buildSsrDocument.ts`) that a page without SSR
// never runs. The three files move to `src/ssr/`, and the core keeps only what is its own:
//   * SSR MODE (`inSsr()` / `ssrMode`, the `@@wcs-*` comments the apply side writes) — H8 leaves that
//     in the core on purpose: it is a mode of rendering, not a module dependency.
//   * the `enable-ssr` ATTRIBUTE and the three points where the feature takes over, behind one
//     receptacle (`core/ssrHooks.ts`): hydrate (root registration), loadState (`<wcs-ssr>` data at
//     initialization) and emitSnapshot (the server writing `<wcs-ssr>` after the bindings are ready).
//   * `registerComponents` defines `<wcs-state>`; a feature's tag is registered as a DEFINER, and
//     definers run FIRST — `<wcs-ssr>` must be upgraded before a state element reads its data.
// `enable-ssr` with no SSR feature installed is a readiness barrier (H5 / D13), not silence.
// Applied to a sandbox copy carrying S3's three slices, S4's eight and S5's first; anchors must match once.
//   node scripts/research/s5SsrSplitPatch.mjs <sandbox>/packages/state
import { readFile, writeFile, rm, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s5SsrSplitPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const [anchor, replacement] of edits) {
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
/** move a file and rewrite the relative imports it makes from its new depth */
async function move(from, to, rewrites) {
  const target = join(pkg, to);
  try { await access(target); console.log('already moved', to); return; } catch { /* move */ }
  let code = (await readFile(join(pkg, from), 'utf8')).replaceAll('\r\n', '\n');
  for (const [a, b] of rewrites) code = code.replaceAll(a, b);
  if (/from "\.\/(?!Ssr|hydrateBindings|buildSsrDocument)/.test(code)) {
    throw new Error(`${to}: a sibling import survived the move: ${code.match(/from "\.\/[^"]*"/g).join(', ')}`);
  }
  await mkdir(join(pkg, 'src/ssr'), { recursive: true });
  await writeFile(target, code);
  await rm(join(pkg, from));
  console.log('moved', from, '->', to);
}

// ---------------------------------------------------------------------------------------------
// 1. the three modules move into the feature directory
await move('src/components/Ssr.ts', 'src/ssr/Ssr.ts', []);
// (the depth rewrite runs first; the sibling `Ssr` import is rewritten from its new, deeper form)
await move('src/hydrateBindings.ts', 'src/ssr/hydrateBindings.ts', [
  ['from "./', 'from "../'],
  ['from "../components/Ssr"', 'from "./Ssr"'],
]);
await move('src/buildSsrDocument.ts', 'src/ssr/buildSsrDocument.ts', [
  ['from "./', 'from "../'],
  ['from "../components/Ssr"', 'from "./Ssr"'],
]);

// 2. the receptacle
await create('src/core/ssrHooks.ts', `/**
 * core/ssrHooks.ts — SSR（サーバー描画とハイドレーション）の受け口（設計案 H8、S5）。
 *
 * core が持つのは SSR **モード**（config の \`inSsr()\` と apply 側が書く \`@@wcs-*\` コメント）と
 * \`enable-ssr\` 属性の判定だけ。\`<wcs-ssr>\` の読み書きとハイドレーションの実装は ssr 機能
 * （src/ssr/）が install で置く。core から機能への辺はこの 1 本の受け口に畳まれている。
 *
 * 受け口（core 側の呼び出し点）:
 *   hydrate       ルート登録（stateElementByName）で、\`enable-ssr\` のクライアント側
 *   loadState     \`_initialize\` の冒頭で、\`<wcs-ssr>\` に載った state データを読む
 *   emitSnapshot  サーバー側の \`connectedCallback\` の末尾で \`<wcs-ssr>\` を書き出す
 */
import { raiseError } from "../raiseError";

export interface ISsrHooks {
  /** クライアント: SSR 出力からバインディングを起こす。偽なら core が通常の構築へ倒す */
  hydrate(root: Document): Promise<boolean>;
  /** クライアント: この要素の前に置かれた \`<wcs-ssr>\` の state データ（無ければ null） */
  loadState(element: Element): Record<string, any> | null;
  /** サーバー: バインディング完了後に \`<wcs-ssr>\` を書き出す */
  emitSnapshot(element: Element): Promise<void>;
}

/** 置かれていなければ null。\`enable-ssr\` の無いページはここを一度も見ない */
export let ssrHooks: ISsrHooks | null = null;

/** 機能の install が呼ぶ（冪等 — 置き換え） */
export function setSsrHooks(hooks: ISsrHooks | null): void {
  ssrHooks = hooks;
}

/**
 * \`enable-ssr\` が SSR 機能を要求した: 未 install なら名指しで throw する（readiness barrier、H5 / D13）。
 * full / auto は \`bootstrapState()\` が install するので起きない。
 */
export function requireSsrHooks(declaration: string): ISsrHooks {
  if (ssrHooks === null) {
    raiseError(\`[wcs/feature-not-installed] \${declaration} needs the "ssr" feature: install it before connecting the element.\`);
  }
  return ssrHooks;
}
`);

// 3. the feature's install
await create('src/ssr/install.ts', `/**
 * ssr/install.ts — SSR 機能の install（設計案 H8、S5）。core の受け口（core/ssrHooks.ts と
 * registerComponents の definer）へこの機能の実装を置き、ssr-snapshot プロトコルを提供する。
 * 従来 \`State\` と \`stateElementByName\` と \`registerComponents\` に直書きされていた分岐で、
 * 理由のコメントは元の位置から移してある。
 */
import { config } from "../config";
import type { IStateElement } from "../components/types";
import { ISsrHooks, setSsrHooks } from "../core/ssrHooks";
import { registerComponentDefiner } from "../registerComponents";
import { getBindingsReady } from "../stateElementByName";
import { VERSION } from "../version";
import { registerSsrSnapshotBuilder } from "./buildSsrDocument";
import { hydrateBindings } from "./hydrateBindings";
import { Ssr } from "./Ssr";

export const ssrFeatureHooks: ISsrHooks = {
  hydrate: hydrateBindings,
  loadState(element) {
    const root = element.parentNode;
    if (!root) return null;
    const ssrEl = Ssr.find(root);
    if (!ssrEl) return null;
    const data = ssrEl.stateData;
    return Object.keys(data).length > 0 ? data : null;
  },
  async emitSnapshot(element) {
    await getBindingsReady((element as unknown as IStateElement).rootNode);
    const stateData = Ssr.extractStateData(element);
    const ssrEl = document.createElement(config.tagNames.ssr);
    ssrEl.setAttribute("version", VERSION);
    Ssr.buildContent(ssrEl, stateData);
    element.parentNode?.insertBefore(ssrEl, element);
  },
};

let installed = false;
/** 冪等。full / auto では \`bootstrapState()\` が呼ぶ */
export function installSsr(): void {
  if (installed) return;
  installed = true;
  setSsrHooks(ssrFeatureHooks);
  registerComponentDefiner((registry) => {
    if (!registry.get(config.tagNames.ssr)) {
      registry.define(config.tagNames.ssr, Ssr);
    }
  });
  // ssr-snapshot プロトコルの提供（docs/ssr-router-design.md §5）。renderToString が
  // \`<wcs-ssr>\` 生成をサーバー主導の最終パスへ回せるようにする。登録は冪等
  registerSsrSnapshotBuilder();
}
`);

// 4. core call sites
await patch('src/registerComponents.ts', 'registerComponentDefiner', [
  [`import { Ssr } from "./components/Ssr";\n`, ``],
  [`export function registerComponents(registry: CustomElementRegistry = customElements) {\n` +
   `  if (!registry.get(config.tagNames.ssr)) {\n` +
   `    registry.define(config.tagNames.ssr, Ssr);\n` +
   `  }\n`,
   `type ComponentDefiner = (registry: CustomElementRegistry) => void;\n\n` +
   `const definers: ComponentDefiner[] = [];\n\n` +
   `/**\n` +
   ` * 機能のタグの定義を登録する（冪等 — 同じ definer は 1 回だけ）。\`<wcs-ssr>\` は ssr/install.ts が登録する。\n` +
   ` * 機能のタグは \`<wcs-state>\` より**先**に定義される（下）。\n` +
   ` */\n` +
   `export function registerComponentDefiner(definer: ComponentDefiner): void {\n` +
   `  if (!definers.includes(definer)) {\n` +
   `    definers.push(definer);\n` +
   `  }\n` +
   `}\n\n` +
   `export function registerComponents(registry: CustomElementRegistry = customElements) {\n` +
   `  // 機能のタグを先に定義する: SSR 出力の \`<wcs-ssr>\` は state の接続が読むので、\n` +
   `  // 未 upgrade のまま state が先に動くと stateData が無い\n` +
   `  for (let i = 0; i < definers.length; i++) {\n` +
   `    definers[i](registry);\n` +
   `  }\n`],
]);
await patch('src/stateElementByName.ts', 'requireSsrHooks', [
  [`import { hydrateBindings } from "./hydrateBindings";\n`, `import { requireSsrHooks } from "./core/ssrHooks";\n`],
  [`                const success = await hydrateBindings(rootNode as Document);\n`,
   `                // ハイドレーションは SSR 機能（ssr/hydrateBindings.ts）。未 install なら名指しで落とす（H5 / D13）\n` +
   `                const success = await requireSsrHooks(\`the "enable-ssr" attribute\`).hydrate(rootNode as Document);\n`],
]);
await patch('src/components/State.ts', 'requireSsrHooks', [
  [`import { Ssr } from "./Ssr";\n`, ``],
  [`import { connectedCallbackSymbol, disconnectedCallbackSymbol } from "../proxy/symbols";\n`,
   `import { connectedCallbackSymbol, disconnectedCallbackSymbol } from "../proxy/symbols";\nimport { requireSsrHooks } from "../core/ssrHooks";\n`],
  [`  private _loadFromSsrElement(): IState | null {\n` +
   `    if (!this.hasAttribute('enable-ssr')) return null;\n` +
   `    const root = this.parentNode;\n` +
   `    if (!root) return null;\n` +
   `    const ssrEl = Ssr.find(root);\n` +
   `    if (!ssrEl) return null;\n` +
   `    const data = ssrEl.stateData;\n` +
   `    return Object.keys(data).length > 0 ? data : null;\n` +
   `  }\n`,
   `  private _loadFromSsrElement(): IState | null {\n` +
   `    if (!this.hasAttribute('enable-ssr')) return null;\n` +
   `    // \`<wcs-ssr>\` に載った state データの読み出しは SSR 機能（ssr/install.ts）。未 install なら名指しで落とす\n` +
   `    return requireSsrHooks(\`the "enable-ssr" attribute\`).loadState(this) as IState | null;\n` +
   `  }\n`],
  [`        await getBindingsReady(this.rootNode);\n\n` +
   `        const stateData = Ssr.extractStateData(this);\n` +
   `        const ssrEl = document.createElement(config.tagNames.ssr);\n` +
   `        ssrEl.setAttribute('version', VERSION);\n` +
   `        Ssr.buildContent(ssrEl, stateData);\n` +
   `        this.parentNode?.insertBefore(ssrEl, this);\n`,
   `        // \`<wcs-ssr>\` の生成は SSR 機能（ssr/install.ts）。バインディング完了を待つのも機能側\n` +
   `        await requireSsrHooks(\`the "enable-ssr" attribute\`).emitSnapshot(this);\n`],
]);
await patch('src/bootstrapState.ts', 'installSsr', [
  [`import { registerSsrSnapshotBuilder } from "./buildSsrDocument";\n`, `import { installSsr } from "./ssr/install";\n`],
  [`  installDccLifecycle();\n`, `  installDccLifecycle();\n  installSsr();\n`],
  [`  // ssr-snapshot プロトコルの提供（docs/ssr-router-design.md §5）。renderToString が\n` +
   `  // <wcs-ssr> 生成をサーバー主導の最終パスへ回せるようにする。登録は冪等。\n` +
   `  registerSsrSnapshotBuilder();\n`, ``],
]);
await patch('src/exports.ts', 'ssr/Ssr.js', [
  [`export { Ssr } from "./components/Ssr.js";\nexport type { ISsrElement } from "./components/Ssr.js";\n`,
   `export { Ssr } from "./ssr/Ssr.js";\nexport type { ISsrElement } from "./ssr/Ssr.js";\n`],
  [`import type { Ssr } from "./components/Ssr.js";\n`, `import type { Ssr } from "./ssr/Ssr.js";\n`],
]);

// 5. test-side: the import paths of the moved modules, and the installs that `bootstrapState()`
//    would have done for a test that drives the pieces directly
{
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(join(pkg, '__tests__'))).filter((f) => f.endsWith('.ts'));
  let rewritten = 0;
  for (const name of files) {
    const file = join(pkg, '__tests__', name);
    const code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
    const next = code
      .replaceAll('../src/components/Ssr', '../src/ssr/Ssr')
      .replaceAll('../src/hydrateBindings', '../src/ssr/hydrateBindings')
      .replaceAll('../src/buildSsrDocument', '../src/ssr/buildSsrDocument');
    if (next !== code) { await writeFile(file, next); rewritten++; }
  }
  console.log('rewrote SSR import paths in', rewritten, 'test files');
}

// the SSR install needs the definer receptacle, so a mock of the core module must offer it
await patch('__tests__/src.bootstrapState.test.ts', 'registerComponentDefiner', [
  [`vi.mock('../src/registerComponents', () => ({\n  registerComponents: vi.fn()\n}));\n`,
   `vi.mock('../src/registerComponents', () => ({\n  registerComponents: vi.fn(),\n  registerComponentDefiner: vi.fn()\n}));\n`],
]);
// `<wcs-ssr>` is the SSR feature's tag now: it reaches the registry through the feature's install
await patch('__tests__/src.registerComponents.test.ts', 'installSsr', [
  [`import { registerComponents } from '../src/registerComponents';\n`,
   `import { registerComponents, registerComponentDefiner } from '../src/registerComponents';\n`],
  [`import { bootstrapState } from '../src/bootstrapState';\n`,
   `import { bootstrapState } from '../src/bootstrapState';\nimport { installSsr } from '../src/ssr/install';\n`],
  // the definer receptacle's two guards (idempotent registration, already-defined tag)
  [`  it('bootstrapStateがregistryを素通しすること', () => {\n`,
   `  it('定義済みのレジストリには機能のタグも state も define しないこと', () => {\n` +
   `    installSsr();\n` +
   `    const defined = {\n` +
   `      get: vi.fn(() => class extends HTMLElement {}),\n` +
   `      define: vi.fn(),\n` +
   `    } as unknown as CustomElementRegistry;\n\n` +
   `    registerComponents(defined);\n\n` +
   `    expect(defined.define).not.toHaveBeenCalled();\n` +
   `  });\n\n` +
   `  it('同じ definer の再登録は 1 回として扱うこと（機能の install は冪等）', () => {\n` +
   `    const definer = vi.fn();\n` +
   `    registerComponentDefiner(definer);\n` +
   `    registerComponentDefiner(definer);\n` +
   `    const scoped = {\n` +
   `      get: vi.fn(() => undefined),\n` +
   `      define: vi.fn(),\n` +
   `    } as unknown as CustomElementRegistry;\n\n` +
   `    registerComponents(scoped);\n\n` +
   `    expect(definer).toHaveBeenCalledTimes(1);\n` +
   `  });\n\n` +
   `  it('bootstrapStateがregistryを素通しすること', () => {\n`],
  [`  it('registryを渡すとglobalではなくそちらへdefineされること', () => {\n` +
   `    // scoped registry は global の定義を継承しないので、そのツリーで使うには\n` +
   `    // そのレジストリ自身への define が要る。\n`,
   `  it('registryを渡すとglobalではなくそちらへdefineされること', () => {\n` +
   `    // scoped registry は global の定義を継承しないので、そのツリーで使うには\n` +
   `    // そのレジストリ自身への define が要る。\n` +
   `    // \`<wcs-ssr>\` は SSR 機能のタグなので、機能の install がレジストリへ届ける（設計案 H8）。\n` +
   `    // full / auto では bootstrapState() が呼ぶ\n` +
   `    installSsr();\n`],
]);

// 6. boundary test: the barrier, and that a page without `enable-ssr` never asks for the feature
await create('__tests__/core.ssrHooks.test.ts', `import { describe, it, expect, vi } from "vitest";
import { State } from "../src/components/State";
import { registerComponents } from "../src/registerComponents";
import { ssrHooks } from "../src/core/ssrHooks";

/**
 * SSR の受け口（core/ssrHooks.ts、設計案 H8・H5）の境界。
 * このファイルは \`bootstrapState()\` を呼ばないので SSR 機能は install されていない
 * （＝ 分割エントリで \`features/ssr\` を入れないページ）。
 */
const STATE_TAG = "wcs-state-ssr-boundary";
if (!customElements.get(STATE_TAG)) {
  customElements.define(STATE_TAG, State);
}

describe("core/ssrHooks — 未 install", () => {
  it("受け口は空で、\`<wcs-ssr>\` も定義されないこと", () => {
    expect(ssrHooks).toBeNull();
    const registry = { get: vi.fn(() => undefined), define: vi.fn() } as unknown as CustomElementRegistry;
    registerComponents(registry);
    expect(vi.mocked(registry.define).mock.calls.map((call) => call[0])).toEqual(["wcs-state"]);
  });

  it("enable-ssr を宣言した state の接続は名指しで落ちること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const stateEl = document.createElement(STATE_TAG) as State;
      stateEl.setAttribute("enable-ssr", "");
      stateEl.setAttribute("state", '{"message":"hi"}');
      document.body.appendChild(stateEl);
      await expect(stateEl.connectedCallbackPromise)
        .rejects.toThrow(/\\[wcs\\/feature-not-installed\\] the "enable-ssr" attribute needs the "ssr" feature/);
      stateEl.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("enable-ssr の無い state は受け口を一度も見ないこと", async () => {
    const stateEl = document.createElement(STATE_TAG) as State;
    stateEl.setAttribute("state", '{"message":"hi"}');
    document.body.appendChild(stateEl);
    await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
    stateEl.remove();
  });
});
`);
console.log('done');
