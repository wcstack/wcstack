// S5, third slice (wiring design §4, requirements B13 / D3 / D15): the split entries.
// The receptacles are in place, so the last step is to give the features an entry of their own and
// let a page compose them: `installFeatures([temporal, scopes])` before `bootstrapState()`.
//   * `core/features.ts` — the descriptor (`{ name, install }`) and `installFeatures`, idempotent.
//   * `core/featureEntries.ts` — the barrier messages name the ENTRY to import, not just the
//     internal feature name: a page that hits one needs to know what to add, and several internal
//     features (watch / scan / stream) live in one entry (temporal).
//   * `core/bootstrapCore.ts` — config + tag registration + binder, WITHOUT any install. The full
//     `bootstrapState()` becomes `installFeatures(ALL_FEATURES)` followed by it, so `@wcstack/state`
//     and `/auto` behave exactly as before.
//   * `src/features/{temporal,scopes,recursion,ssr,devtools}.ts` — one descriptor per entry.
//     `features/formats` waits for the filter registry (D16), which is not built yet.
//   * `src/entries/core.ts` — the `@wcstack/state/core` surface: bootstrapState (no installs),
//     installFeatures, defineState and the types, with no feature in its import graph.
//   * `rollup.split.config.js` — a multi-entry build (`dist-split/`) that shares ONE core chunk,
//     for measuring the entries and checking that no feature chunk re-bundles the core.
// Applied to a sandbox copy carrying S3's three slices, S4's eight and S5's first two.
//   node scripts/research/s5SplitEntriesPatch.mjs <sandbox>/packages/state
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s5SplitEntriesPatch.mjs <sandbox>/packages/state');
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
  await mkdir(join(pkg, rel, '..'), { recursive: true });
  await writeFile(file, content);
  console.log('created', rel);
}

// ---------------------------------------------------------------------------------------------
// 1. the descriptor and `installFeatures`
await create('src/core/features.ts', `/**
 * core/features.ts — 分割エントリの install（設計案 §4、要件 D15）。
 *
 * 機能のエントリは「名前と install を持つ記述子」を export し、ページは要るものだけを入れる:
 *
 * \`\`\`js
 * import { bootstrapState, installFeatures } from "@wcstack/state/core";
 * import temporal from "@wcstack/state/features/temporal";
 * installFeatures([temporal]);
 * bootstrapState();
 * \`\`\`
 *
 * full（\`@wcstack/state\`）と \`/auto\` は \`bootstrapState()\` が全機能を入れるので、利用者から見た
 * 挙動は変わらない。
 *
 * **冪等は機能側の \`install\` が持つ**（どれも \`installed\` フラグで 2 回目を弾く）。ここで名前を
 * 覚えて重複を弾く手もあるが、同じことを 2 箇所で持つだけで、しかも「\`bootstrapState()\` を
 * 2 回呼ぶと 2 回目は機能の install に届かない」という観測できる差が増える。core は素直に並べた順に呼ぶ。
 */
export interface IStateFeature {
  /** 機能の名前（受け口のレジストリのキーと同じ。barrier の文言が使う） */
  readonly name: string;
  /** 受け口へこの機能の実装を置く。**冪等であること** — core は 2 回呼ぶことがある */
  install(): void;
}

export function installFeatures(features: readonly IStateFeature[]): void {
  for (let i = 0; i < features.length; i++) {
    features[i].install();
  }
}
`);

// 2. the barrier names the entry to import
await create('src/core/featureEntries.ts', `/**
 * core/featureEntries.ts — 受け口の機能名 → 利用者が入れるエントリ（設計案 §3 H5・§4）。
 *
 * barrier に当たったページが要るのは「どの import を足すか」であって内部の機能名ではない。
 * 内部では別々の機能（watch / scan / stream）が 1 つのエントリ（temporal）に載るので、
 * 対応表は 1 箇所に置き、3 つの barrier（addressHooks・lifecycleHooks・ssrHooks）が共有する。
 */
const ENTRY_BY_FEATURE: Record<string, string> = {
  watch: "temporal",
  scan: "temporal",
  stream: "temporal",
  scopes: "scopes",
  dcc: "scopes",
  bindComponent: "scopes",
  recursion: "recursion",
  ssr: "ssr",
  devtools: "devtools",
};

/** 未 install の機能を宣言が要求したときの文言（readiness barrier、H5 / D13） */
export function featureNotInstalledMessage(feature: string, declaration: string): string {
  const entry = ENTRY_BY_FEATURE[feature] ?? feature;
  return \`[wcs/feature-not-installed] \${declaration} needs the "\${feature}" feature: \` +
    \`install it with installFeatures([...]) from "@wcstack/state/features/\${entry}" before the state is defined.\`;
}
`);
await patch('src/core/addressHooks.ts', 'featureNotInstalledMessage', [
  [`import { raiseError } from "../raiseError";\n`,
   `import { raiseError } from "../raiseError";\nimport { featureNotInstalledMessage } from "./featureEntries";\n`],
  [`    raiseError(\`[wcs/feature-not-installed] "\${declaration}" needs the "\${feature}" feature: install it before defining the state.\`);\n`,
   `    raiseError(featureNotInstalledMessage(feature, \`"\${declaration}"\`));\n`],
]);
await patch('src/core/lifecycleHooks.ts', 'featureNotInstalledMessage', [
  [`import { raiseError } from "../raiseError";\n`,
   `import { raiseError } from "../raiseError";\nimport { featureNotInstalledMessage } from "./featureEntries";\n`],
  [`  return raiseError(\n    \`[wcs/feature-not-installed] \${declaration} needs the "\${feature}" feature: install it before connecting the element.\`,\n  );\n`,
   `  return raiseError(featureNotInstalledMessage(feature, declaration));\n`],
]);
await patch('src/core/ssrHooks.ts', 'featureNotInstalledMessage', [
  [`import { raiseError } from "../raiseError";\n`,
   `import { raiseError } from "../raiseError";\nimport { featureNotInstalledMessage } from "./featureEntries";\n`],
  [`    raiseError(\`[wcs/feature-not-installed] \${declaration} needs the "ssr" feature: install it before connecting the element.\`);\n`,
   `    raiseError(featureNotInstalledMessage("ssr", declaration));\n`],
]);

// 3. the feature entries
await create('src/features/temporal.ts', `/**
 * features/temporal.ts — \`$watch\` / \`$scan\` / \`$streams\`（@wcstack/state/features/temporal）。
 */
import type { IStateFeature } from "../core/features";
import { installScanDeclarations } from "../scan/declarations";
import { installStreamRuntime } from "../stream/streamRuntime";
import { installWatchRuntime } from "../watch/watchRuntime";

export const temporal: IStateFeature = {
  name: "temporal",
  install(): void {
    installWatchRuntime();
    installScanDeclarations();
    installStreamRuntime();
  },
};
export default temporal;
`);
await create('src/features/scopes.ts', `/**
 * features/scopes.ts — \`bind-component\` のマウント・\`mount=\` のボリューム・オーバーレイ・DCC
 * （@wcstack/state/features/scopes）。要素のスコープを作る機能をひとまとめにする。
 */
import type { IStateFeature } from "../core/features";
import { installDccLifecycle } from "../dcc/dccLifecycle";
import { installVolumeGraft } from "../webComponent/volume";

export const scopes: IStateFeature = {
  name: "scopes",
  install(): void {
    // 接ぎ木の実体・スコープの hook・ボリューム / bind-component のライフサイクル
    installVolumeGraft();
    installDccLifecycle();
  },
};
export default scopes;
`);
await create('src/features/recursion.ts', `/**
 * features/recursion.ts — \`$recursion\` と \`**\`（@wcstack/state/features/recursion）。
 */
import type { IStateFeature } from "../core/features";
import { installRecursionDeclarations } from "../recursion/declarations";

export const recursion: IStateFeature = {
  name: "recursion",
  install(): void {
    installRecursionDeclarations();
  },
};
export default recursion;
`);
await create('src/features/ssr.ts', `/**
 * features/ssr.ts — サーバー描画とハイドレーション（@wcstack/state/features/ssr）。
 */
import type { IStateFeature } from "../core/features";
import { installSsr } from "../ssr/install";

export const ssr: IStateFeature = {
  name: "ssr",
  install(): void {
    installSsr();
  },
};
export default ssr;
`);
await create('src/features/devtools.ts', `/**
 * features/devtools.ts — DevTools Hook Protocol への source 登録（@wcstack/state/features/devtools）。
 */
import type { IStateFeature } from "../core/features";
import { registerDevtoolsSource } from "../devtools/bridge";

export const devtools: IStateFeature = {
  name: "devtools",
  install(): void {
    registerDevtoolsSource();
  },
};
export default devtools;
`);

// 4. bootstrap: the core half (no installs) and the full half (all features, then the core half)
{
  const file = join(pkg, 'src/bootstrapState.ts');
  const code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes('bootstrapCore')) {
    console.log('already patched src/bootstrapState.ts');
  } else {
    const start = code.indexOf('/**\n * `<html lang>` を既定ロケールとして採る。');
    const end = code.indexOf('export function bootstrapState(');
    if (start === -1 || end === -1) throw new Error('bootstrapState.ts: could not delimit the locale helpers');
    const helpers = code.slice(start, end);
    await create('src/core/bootstrapCore.ts', `/**
 * core/bootstrapCore.ts — 機能を 1 つも入れない bootstrap（設計案 §4、\`@wcstack/state/core\`）。
 *
 * 設定の解決・タグの登録・binder プロトコルの提供だけを行う。機能の install は
 * \`installFeatures([...])\` の仕事で、full / auto の \`bootstrapState()\` が全部入れてから
 * これを呼ぶ（従来と同じ順序 — install は要素の定義より前）。
 */
import { setConfig } from "../config";
import { registerBinder } from "../bindings/binder";
import { registerComponents } from "../registerComponents";
import { IWritableConfig } from "../types";

${helpers}export function bootstrapCore(config?: IWritableConfig, registry?: CustomElementRegistry): void {
  const resolved = resolveConfig(config);
  if (resolved) {
    setConfig(resolved);
  }
  registerComponents(registry);
  // binder プロトコルの提供（docs/binder-protocol-design.md）。router が後から
  // 差し込むノードをバインドできるようにする。登録は冪等。
  registerBinder();
}
`);
    await writeFile(file, `import { bootstrapCore } from "./core/bootstrapCore";
import { installFeatures, IStateFeature } from "./core/features";
import devtools from "./features/devtools";
import recursion from "./features/recursion";
import scopes from "./features/scopes";
import ssr from "./features/ssr";
import temporal from "./features/temporal";
import { IWritableConfig } from "./types";

/**
 * full / auto が入れる機能（設計案 §4）。分割エントリの利用者は、このうち要るものだけを
 * \`installFeatures([...])\` で入れる。並びは install 順だが、受け口の呼び出し順は
 * \`order\` と優先度が決めるので、この並びに契約は無い。
 */
export const ALL_FEATURES: readonly IStateFeature[] = [temporal, recursion, scopes, ssr, devtools];

/**
 * 全機能を入れてから core を立ち上げる（従来の \`bootstrapState()\` と同じ挙動）。
 * install は要素の定義（connectedCallback が走り得る）より前に行う。いずれも冪等。
 */
export function bootstrapState(config?: IWritableConfig, registry?: CustomElementRegistry): void {
  installFeatures(ALL_FEATURES);
  bootstrapCore(config, registry);
}
`);
    console.log('patched src/bootstrapState.ts');
  }
}

// 5. the `@wcstack/state/core` entry
await create('src/entries/core.ts', `/**
 * entries/core.ts — \`@wcstack/state/core\`（設計案 §4）。
 *
 * core だけの公開面。機能（watch / scan / streams・スコープ・再帰・SSR・devtools）は 1 つも
 * import しない — ページが \`installFeatures([...])\` で入れる。full（\`@wcstack/state\`）は
 * この面に機能と \`Ssr\` などを足したもので、公開 API は従来どおり。
 */
export { bootstrapCore as bootstrapState } from "../core/bootstrapCore.js";
export { installFeatures } from "../core/features.js";
export type { IStateFeature } from "../core/features.js";

export { getConfig } from "../config.js";
export { getBindingsReady } from "../stateElementByName.js";
export { buildBindings } from "../buildBindings.js";
export { getTrustedTypesPolicy, setTrustedTypesPolicy, TRUSTED_TYPES_POLICY_SLOT } from "../trustedTypes.js";
export type { IWcsTrustedTypesPolicy } from "../trustedTypes.js";

export { defineState } from "../defineState.js";
export type {
  WcsStateApi, WcsThis,
  WcsPaths, WcsPathValue,
} from "../defineState.js";
export type {
  IWritableConfig, IWritableTagNames, IBindingErrorInfo
} from "../types.js";

export { VERSION } from "../version.js";

import type { State } from "../components/State.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-state": State;
  }
}
`);

// 5b. the authoring-only entry (requirements N2): `defineState` and the types, zero value imports
await create('src/entries/define.ts', `/**
 * entries/define.ts — \`@wcstack/state/define\`（設計案 §4、要件 N2）。
 *
 * \`defineState\` と型だけの入口。値の import は 0 本で、ここを import しても
 * ランタイムは 1 バイトも起動しない（\`scripts/audit-state-tech-helper-import.mjs\` が門で固定する）。
 * オーサリング時に型を付けるだけのファイル（ビルド無しのページの \`<script type="module">\` や、
 * TypeScript から state オブジェクトを書く側）はこの入口を使う。
 */
export { defineState } from "../defineState.js";
export type {
  WcsStateApi, WcsThis,
  WcsPaths, WcsPathValue,
} from "../defineState.js";
`);

// 6. a multi-entry build for measuring: one shared core chunk, features beside it.
//    Skipped once the package's own rollup.config.js builds the split entries (after the port).
const mainConfig = (await readFile(join(pkg, 'rollup.config.js'), 'utf8')).replaceAll('\r\n', '\n');
if (mainConfig.includes(`dir: 'dist/split'`)) {
  console.log('rollup.config.js already builds the split entries; skipping the prototype config');
} else await create('rollup.split.config.js', `// 分割エントリの試作ビルド（設計案 §4・要件 B13）。dist-split/ に core と features/* を出し、
// 共有部分は 1 つの core チャンクに畳む（機能ごとに core を再同梱しないことの確認と、サイズの実測）。
// 本体のビルド（rollup.config.js）には影響しない: \`npx rollup -c rollup.split.config.js\` で使う。
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

export default {
  input: {
    'core': 'src/entries/core.ts',
    'features/temporal': 'src/features/temporal.ts',
    'features/scopes': 'src/features/scopes.ts',
    'features/recursion': 'src/features/recursion.ts',
    'features/ssr': 'src/features/ssr.ts',
    'features/devtools': 'src/features/devtools.ts',
  },
  output: {
    dir: 'dist-split',
    format: 'esm',
    sourcemap: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name].js',
    minifyInternalExports: true,
  },
  plugins: [
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, outDir: undefined }),
    terser(),
  ],
};
`);

// 7. the imports the slices left behind. Every one of them was the last user of its module leaving
//    `State.ts` (and the stream namespaces leaving `getByAddress`); they are dead weight in the
//    import graph and the only lint warnings the port produced.
await patch('src/components/State.ts', 'import { STATE_WATCH_NAME, STATE_BINDABLES_NAME }', [
  [`import { STATE_RECURSION_NAME, STATE_WATCH_NAME, STATE_BINDABLES_NAME } from "../define";\n`,
   `import { STATE_WATCH_NAME, STATE_BINDABLES_NAME } from "../define";\n`],
  [`import { getCustomElementRegistry } from "../platform/customElementRegistry";\n`, ``],
  [`import { getBindingsByNode } from "../bindings/getBindingsByNode";\n`, ``],
  [`import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";\n`, ``],
  [`import { getCustomElement } from "../getCustomElement";\n`, ``],
  [`import { VERSION } from "../version";\n`, ``],
]);
await patch('src/proxy/methods/getByAddress.ts', 'import { STATE_COMMAND_NAMESPACE_NAME, WILDCARD }', [
  [`import { STATE_COMMAND_NAMESPACE_NAME, STATE_STREAM_ERROR_NAMESPACE_NAME, STATE_STREAM_STATUS_NAMESPACE_NAME, WILDCARD } from "../../define";\n`,
   `import { STATE_COMMAND_NAMESPACE_NAME, WILDCARD } from "../../define";\n`],
]);
{
  // both declaration modules kept a type import that their last extraction made unused
  const unusedTypes = [
    ['src/recursion/declarations.ts', `import type { IStateElement } from "../components/types";\n`],
    ['src/scan/declarations.ts', `import type { IStateElement } from "../components/types";\n`],
    ['src/scan/declarations.ts', `import type { IState } from "../types";\n`],
  ];
  for (const [rel, line] of unusedTypes) {
    const file = join(pkg, rel);
    const code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
    if (!code.includes(line)) { console.log('already trimmed', rel, line.trim().slice(0, 40)); continue; }
    await writeFile(file, code.replace(line, ''));
    console.log('trimmed', rel);
  }
}

// 8. boundary test: the composition itself
await create('__tests__/core.features.test.ts', `import { describe, it, expect, vi } from "vitest";
import { installFeatures } from "../src/core/features";
import { featureNotInstalledMessage } from "../src/core/featureEntries";

/**
 * 分割エントリの install（core/features.ts、設計案 §4・D15）の境界。
 */
describe("core/features — installFeatures", () => {
  it("記述子の install をそのまま呼ぶこと（冪等は機能側が持つ）", () => {
    let installed = false;
    const install = vi.fn(() => { installed = true; });
    const idempotent = { name: "test-feature", install: () => { if (!installed) install(); } };
    installFeatures([idempotent, idempotent]);
    installFeatures([idempotent]);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("並べた順に入れること", () => {
    const order: string[] = [];
    installFeatures([
      { name: "test-first", install: () => order.push("first") },
      { name: "test-second", install: () => order.push("second") },
    ]);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("core/featureEntries — barrier の文言", () => {
  it("内部の機能名と、足すべきエントリの両方を名指しすること", () => {
    expect(featureNotInstalledMessage("stream", '"\$streams"'))
      .toBe('[wcs/feature-not-installed] "\$streams" needs the "stream" feature: ' +
        'install it with installFeatures([...]) from "@wcstack/state/features/temporal" before the state is defined.');
  });

  it("対応表に無い名前はそのままエントリ名として使うこと", () => {
    expect(featureNotInstalledMessage("no-such-feature", '"\$nothing"'))
      .toContain('"@wcstack/state/features/no-such-feature"');
  });
});
`);

// the core entry must not only BUILD without features — it must run
await create('__tests__/entries.core.test.ts', `import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/entries/core";
import type { State } from "../src/components/State";

/**
 * \`@wcstack/state/core\` だけのページ（設計案 §4）。機能は 1 つも install しない。
 * 素の state — 束縛・更新・リスト描画 — がそれだけで動くことを固定する。
 */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve));

beforeAll(() => {
  bootstrapState();
});

describe("entries/core — 機能を 1 つも入れないページ", () => {
  it("束縛・更新・リスト描画が core だけで動くこと", async () => {
    const host = document.createElement("core-entry-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      \`<p data-wcs="textContent: message"></p>\` +
      \`<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*"></li></template></ul>\` +
      \`<wcs-state></wcs-state>\`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ message: "hi", items: ["a", "b"] });
    await stateEl.connectedCallbackPromise;
    await (stateEl.constructor as typeof State).getBindingsReady(shadowRoot);

    expect(shadowRoot.querySelector("p")!.textContent).toBe("hi");
    expect([...shadowRoot.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b"]);

    stateEl.createState("writable", (state: any) => {
      state.message = "bye";
      state.items = ["c"];
    });
    await flush();

    expect(shadowRoot.querySelector("p")!.textContent).toBe("bye");
    expect([...shadowRoot.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["c"]);
    host.remove();
  });
});
`);
console.log('done');
