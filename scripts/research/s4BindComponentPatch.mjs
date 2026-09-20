// S4, fourth slice (wiring design §3 H3): bind-component and the mount scope leave `State`.
// This is the largest remaining block of the element's wiring (~190 lines plus three branches), and
// it does not fit the "claim or don't" shape of the first slice: `_initializeBindWebComponent` runs
// for every element and only SOMETIMES short-circuits the rest of the connect (when it built a mount
// scope, the element has no tree of its own). So the receptacle gains a `preparing` phase:
// "do your pre-initialization work; say whether you have fully handled this element". It returns null
// when the feature is not interested, so a plain state still gains no microtask.
// The 190-line method is not retyped here: the script EXTRACTS it from State.ts and rewrites its
// `this.` references into the feature's ledger and the element's internal surface, then asserts that
// no `this.` reference survived. That keeps the move mechanical and reviewable.
// Applied to a sandbox copy carrying S3's three slices and S4's first three; anchors must match once.
//   node scripts/research/s4BindComponentPatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s4BindComponentPatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const edit of edits) {
    if (edit.length === 3 && typeof edit[2] === 'string') {
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

const statePath = join(pkg, 'src/components/State.ts');
const stateCode = (await readFile(statePath, 'utf8')).replaceAll('\r\n', '\n');
const featurePath = join(pkg, 'src/webComponent/bindComponentLifecycle.ts');
const alreadyDone = stateCode.includes('runPreparing(this)');

// 1. extract the method body out of State.ts and rewrite its `this.` references
const METHOD_START = '  private async _initializeBindWebComponent() {\n';
const METHOD_END = '\n  }\n\n\n  private async _callStateConnectedCallback';
let body = null;
if (!alreadyDone) {
  const s = stateCode.indexOf(METHOD_START);
  const e = stateCode.indexOf(METHOD_END, s);
  if (s === -1 || e === -1) throw new Error('State.ts: could not delimit _initializeBindWebComponent');
  body = stateCode.slice(s + METHOD_START.length, e);
  const rewrites = [
    ['this.hasAttribute(', 'el.hasAttribute('],
    ['this.getAttribute(', 'el.getAttribute('],
    ['this.querySelector', 'el.querySelector'],
    ['this.parentNode', 'el.parentNode'],
    // the fail-fast landing of a mount-scope configuration error (#257): same class as
    // `_failInitialization` — settle the promises, then let the error propagate
    ['            this._initializationLanded = true;\n            this._resolveInitialize?.();\n            this._resolveLoading?.();\n            this._resolveConnectedCallback?.();\n',
     '            element.landInitialization!();\n'],
    ['this._failInitialization(', 'failInitialization(element, '],
    ['      this._boundComponent = boundComponent;\n      this._boundComponentStateProp = boundComponentStateProp;\n',
     '      ledger.boundComponent = boundComponent;\n      ledger.boundComponentStateProp = boundComponentStateProp;\n      element.setBoundComponent!(boundComponent, boundComponentStateProp);\n'],
    ['this._mountRecord = record;', 'ledger.mountRecord = record;'],
    ['bindWebComponent(this, this._boundComponent, this._boundComponentStateProp, state);',
     'bindWebComponent(element, ledger.boundComponent!, ledger.boundComponentStateProp!, state);'],
  ];
  for (const [from, to] of rewrites) {
    if (!body.includes(from)) throw new Error(`method body: missing rewrite target: ${from.slice(0, 60)}`);
    body = body.replaceAll(from, to);
  }
  if (body.includes('this.')) {
    throw new Error(`method body still references the element through \`this.\`: ${body.slice(body.indexOf('this.') - 80, body.indexOf('this.') + 80)}`);
  }
}

// 2. the feature module
if (!alreadyDone) {
  await writeFile(featurePath, `/**
 * webComponent/bindComponentLifecycle.ts — \`bind-component\` とマウントスコープのライフサイクル
 * （設計案 H3、S4）。従来 \`State\` の \`_initializeBindWebComponent\` と、接続・再接続・切断の
 * マウント分岐だったもの。本体は State.ts から機械的に移しており、\`this.\` の参照だけを
 * 要素ごとの台帳（\`IBindLedger\`）と要素の内部面に書き換えてある。
 *
 * 引き取りの形が他の機能と違う: この処理は \`bind-component\` のある要素で必ず走り、
 * **マウントスコープを組んだときだけ**その後の初期化（独立ツリーの構築）を打ち切る。
 * そのため受け口は \`preparing\`（「前処理をして、この要素を丸ごと引き取ったかを返す」）。
 */
import type { IStateElement } from "../components/types";
import { ILifecycleHooks, registerLifecycleHooks } from "../core/lifecycleHooks";
import { config } from "../config";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry } from "../platform/customElementRegistry";
import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";
import { bindWebComponent, invokeStateReadyCallback } from "./bindWebComponent";
import { buildMountRecord, callMountLifecycleCallback, getRegisteredMountRecord, IMountRecord, warnMountedDollarDeclarations } from "./mount";
import { initializeMountScope, remountScopeBindings } from "./mountScope";
import { createPublicMountState } from "./overlay";
import { warnOwnKeyShadowsForMount } from "./ownKeyShadow";
import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from "./completeWebComponent";
import { getInjectedKeys, restoreOverwrittenValues, takeOverwrittenObject } from "./preCompletionWrites";
import { hasRootMountBinding } from "./rootMountBinding";
import { notifyExports } from "./exportIndex";

/** 要素ごとの控え（従来の \`State\` の private フィールド 3 つ） */
interface IBindLedger {
  boundComponent: Element | null;
  boundComponentStateProp: string | null;
  /** v2 マウント（Phase 2）: この bind-component 要素が構築したマウント記録 */
  mountRecord: IMountRecord | null;
}

const ledgerByElement = new WeakMap<IStateElement, IBindLedger>();

function ledgerOf(element: IStateElement): IBindLedger {
  let ledger = ledgerByElement.get(element);
  if (typeof ledger === "undefined") {
    ledger = { boundComponent: null, boundComponentStateProp: null, mountRecord: null };
    ledgerByElement.set(element, ledger);
  }
  return ledger;
}

/**
 * 設定エラーでの fail-fast（\`State._failInitialization\` と同じ着地）。initializePromise 等を
 * 解決してから raise する — 未解決のまま投げると waitForStateInitialize がこの要素を待ち続け、
 * **ページ全体が無言でウェッジする**。
 */
function failInitialization(element: IStateElement, message: string): never {
  element.landInitialization!();
  raiseError(message);
}

async function initializeBindWebComponent(element: IStateElement, ledger: IBindLedger): Promise<void> {
  const el = element as unknown as HTMLElement;
${body}
}

export const bindComponentLifecycleHooks: ILifecycleHooks = {
  // ボリューム（20）の後。従来の分岐順（設計案 H3）
  order: 30,
  preparing(element) {
    const el = element as unknown as HTMLElement;
    if (!el.hasAttribute("bind-component")) {
      return null;
    }
    const ledger = ledgerOf(element);
    return initializeBindWebComponent(element, ledger).then(() => {
      if (ledger.mountRecord === null) {
        // ホスト配線の無い plain Shadow 形: 独立ツリーを持つので core の初期化が続く
        return false;
      }
      // v2 マウント: この要素は独立ツリーを持たない（台帳エイリアスが親を指す）。
      // 名前登録・state ロード・$connectedCallback / $watch / $streams は行わない
      // （マウントスコープの $ 面は P2-9 — 設計書 §4-6）
      element.markInitialized!();
      element.settleInitialization!();
      return true;
    });
  },
  reconnecting(element) {
    const ledger = ledgerByElement.get(element);
    if (typeof ledger === "undefined" || ledger.mountRecord === null) {
      return false;
    }
    // マウント済みコンポーネントの再接続（行 content のプール再利用）: 現在の行の
    // listIndex でマウントスコープの台帳を張り直し、最新値を適用する（§1.9 の v2 版）。
    // microtask に遅らせるのは、この接続が親の行ループ（mountAfter）の最中に同期で発火し、
    // 新しいループ文脈は直後の activateContent が張るため — 同期で張り直すと旧行の
    // listIndex を読んでしまう
    const mountRecord = ledger.mountRecord;
    // Shadow DOM 形は shadowRoot、Light DOM 形はコンポーネント要素自身
    const scopeRoot = (element as unknown as HTMLElement).parentNode as ShadowRoot | Element;
    queueMicrotask(() => {
      if (element.connectedRootNode == null) return; // 再接続後すぐ切断された（プール返却）
      remountScopeBindings(mountRecord, scopeRoot);
    });
    // 接続ごとのライフサイクル（v1 の $connectedCallback 再実行と同じ意味論）
    callMountLifecycleCallback(mountRecord, "$connectedCallback");
    return true;
  },
  disconnecting(element) {
    const ledger = ledgerByElement.get(element);
    if (typeof ledger === "undefined" || ledger.mountRecord === null) {
      return false;
    }
    // v2 マウント: 名前登録・streams・watch を持たないので後始末は不要。
    // 台帳エイリアスは消さない（プール再利用の再接続が同じスコープに戻る）。
    // $disconnectedCallback だけは要素のライフサイクルとして呼ぶ（例外は隔離）
    callMountLifecycleCallback(ledger.mountRecord, "$disconnectedCallback");
    // 公開 getter の答えが消えた（X6）— 親の依存者を再評価させる。プール返却も
    // 恒久破棄もここを通る（行ごと消えた形は $postUpdate が届かず無視される）
    notifyExports(ledger.mountRecord);
    element.clearConnectedRootNode!();
    return true;
  },
};

let installed = false;
/** 冪等。full / auto では \`bootstrapState()\` の \`installVolumeGraft()\` が呼ぶ */
export function installBindComponentLifecycle(): void {
  if (installed) return;
  installed = true;
  registerLifecycleHooks("bindComponent", bindComponentLifecycleHooks);
}
`);
  console.log('wrote src/webComponent/bindComponentLifecycle.ts');
}

// 3. the receptacle gains `preparing`
await patch('src/core/lifecycleHooks.ts', 'PreparingHook', [
  [`/** 初期化済みの要素の再接続を引き取ったなら true */\n`,
   `/**\n * 接続の前処理。「興味が無い」は null、あるなら「この要素を丸ごと引き取ったか」を解決する Promise。\n * \`bind-component\` のように「必ず走るが、引き取るのは条件つき」という機能のための段。\n */\nexport type PreparingHook = (element: IStateElement) => Promise<boolean> | null;\n/** 初期化済みの要素の再接続を引き取ったなら true */\n`],
  [`  readonly connecting?: ConnectingHook;\n`, `  readonly connecting?: ConnectingHook;\n  readonly preparing?: PreparingHook;\n`],
  [`/** 初期化済みの要素の再接続を引き取る機能を探す。引き取られたら true */\n`,
   `/**\n * 接続の前処理を持つ機能を探す。1 つも無ければ null（素の state に microtask の境界を足さない）。\n * 解決値が true なら、その機能がこの要素を丸ごと引き取っている。\n */\nexport function runPreparing(element: IStateElement): Promise<boolean> | null {\n  for (let i = 0; i < ordered.length; i++) {\n    const prepared = ordered[i].preparing?.(element);\n    if (prepared != null) {\n      return prepared;\n    }\n  }\n  return null;\n}\n\n/** 初期化済みの要素の再接続を引き取る機能を探す。引き取られたら true */\n`],
]);

// 4. the scopes install takes it along
await patch('src/webComponent/volume.ts', 'installBindComponentLifecycle', [
  [`import { installVolumeLifecycle } from "./volumeLifecycle";\n`,
   `import { installVolumeLifecycle } from "./volumeLifecycle";\nimport { installBindComponentLifecycle } from "./bindComponentLifecycle";\n`],
  [`  installVolumeLifecycle();\n`, `  installVolumeLifecycle();\n  installBindComponentLifecycle();\n`],
]);

// 5. the element's internal surface
await patch('src/components/types.ts', 'landInitialization', [
  [`  setScanPaths?(paths: ReadonlySet<string> | null): void;\n`,
   `  setScanPaths?(paths: ReadonlySet<string> | null): void;\n` +
   `  /** 設定エラーの着地（初期化待ちの promise を解決し、二重着地の印を立てる） */\n  landInitialization?(): void;\n` +
   `  /** \`bind-component\` が束ねた相手（\`boundComponentStateProp\` の答えになる） */\n  setBoundComponent?(component: Element | null, stateProp: string | null): void;\n`],
]);

// 6. State: the method and the three branches leave
await patch('src/components/State.ts', 'runPreparing(this)', [
  [`import { bindWebComponent, invokeStateReadyCallback } from "../webComponent/bindWebComponent";\n`, ``],
  [`import { buildMountRecord, callMountLifecycleCallback, getRegisteredMountRecord, IMountRecord, warnMountedDollarDeclarations } from "../webComponent/mount";\n`, ``],
  [`import { initializeMountScope, remountScopeBindings } from "../webComponent/mountScope";\n`, ``],
  [`import { createPublicMountState } from "../webComponent/overlay";\n`, ``],
  [`import { warnOwnKeyShadowsForMount } from "../webComponent/ownKeyShadow";\n`, ``],
  [`import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from "../webComponent/completeWebComponent";\n`, ``],
  [`import { getInjectedKeys, restoreOverwrittenValues, takeOverwrittenObject } from "../webComponent/preCompletionWrites";\n`, ``],
  [`import { hasRootMountBinding } from "../webComponent/rootMountBinding";\n`, ``],
  [`import { notifyExports } from "../webComponent/exportIndex";\n`, ``],
  [`import { requireLifecycleFeature, runConnecting, runDisconnecting, runReconnecting, runReplacingState } from "../core/lifecycleHooks";\n`,
   `import { requireLifecycleFeature, runConnecting, runDisconnecting, runPreparing, runReconnecting, runReplacingState } from "../core/lifecycleHooks";\n`],
  // the mount record is the feature's ledger now
  [`  /** v2 マウント（Phase 2）: この bind-component 要素が構築したマウント記録 */\n  private _mountRecord: IMountRecord | null = null;\n`, ``],
  // the method itself
  [METHOD_START, `\n\n  private async _callStateConnectedCallback`, `\n\n  private async _callStateConnectedCallback`],
  // connect: prepare, and stop when a feature took the element over
  [`      try {\n        await this._initializeBindWebComponent();\n      } catch (error) {\n`,
   `        this._resolveConnectedCallback?.();\n        return;\n      }\n`,
   `      // 接続の前処理（設計案 H3 の preparing）。\`bind-component\` はここで走り、マウントスコープを\n` +
   `      // 組んだときだけこの要素を丸ごと引き取る（webComponent/bindComponentLifecycle.ts）\n` +
   `      let prepared = false;\n` +
   `      try {\n` +
   `        // 引き取り手が無くても await する: 従来この位置には必ず \`await this._initializeBindWebComponent()\`\n` +
   `        // があり、素の state でも microtask の境界が 1 つ入っていた。同期にすると、内包スクリプトの\n` +
   `        // ロードのようにその境界に依存する経路が時間切れになる（実測）。接続は 1 要素 1 回なので費用は無い\n` +
   `        prepared = await (runPreparing(this) ?? false);\n` +
   `      } catch (error) {\n` +
   `        // bind-component の raise も同じ着地に載せる（#257）。とりわけ「初期化に\n` +
   `        // 失敗した要素の再接続」は bindWebComponent → setInitialState の復旧不能\n` +
   `        // raise でここへ来る — _initialize の外なので、包まないと素通りする。\n` +
   `        // 自分で着地済みの fail-fast（_failInitialization / initializeMountScope）は\n` +
   `        // _failInitializeLoudly の先頭で弾かれ、従来どおり伝播するだけ\n` +
   `        this._failInitializeLoudly(error);\n` +
   `      }\n` +
   `      if (prepared) {\n` +
   `        return;\n` +
   `      }\n`],
  // reconnect: the mount branch is a `reconnecting` hook now (volume 20 → bindComponent 30)
  [`    } else if (this._mountRecord !== null) {\n`,
   `      this._resolveConnectedCallback?.();\n      return;\n    } else if (!this._dcc && getStateElement(this._rootNode) !== this) {`,
   `    } else if (!this._dcc && getStateElement(this._rootNode) !== this) {`],
  // disconnect: likewise
  [`    if (this._mountRecord !== null) {\n`,
   `      this._rootNode = null;\n      return;\n    }\n    if (this._rootNode !== null) {`,
   `    if (this._rootNode !== null) {`],
  // the internal surface
  [`  setScanPaths(paths: ReadonlySet<string> | null): void {\n    this._scanPaths = paths;\n  }\n`,
   `  setScanPaths(paths: ReadonlySet<string> | null): void {\n    this._scanPaths = paths;\n  }\n\n` +
   `  /** 設定エラーの着地（\`_failInitialization\` の raise を除いた部分）。引き取った機能が使う */\n` +
   `  landInitialization(): void {\n    this._initializationLanded = true;\n    this._resolveInitialize?.();\n    this._resolveLoading?.();\n    this._resolveConnectedCallback?.();\n  }\n\n` +
   `  setBoundComponent(component: Element | null, stateProp: string | null): void {\n    this._boundComponent = component;\n    this._boundComponentStateProp = stateProp;\n  }\n`],
]);
// 7. test-side: the unit tests drove bind-component through `State` の private メソッド。
// 入口が機能側へ移ったので、同じことをライフサイクル hook の `preparing` で行う
for (const rel of [
  '__tests__/components.State.test.ts',
  '__tests__/integration.bindComponentLightDom.test.ts',
  '__tests__/integration.bindComponentRootMount.test.ts',
]) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes('bindComponentLifecycleHooks')) {
    console.log('already patched', rel);
    continue;
  }
  const CALL = /\((\w+) as any\)\._initializeBindWebComponent\(\)/g;
  const hits = code.match(CALL);
  if (hits === null) throw new Error(`${rel}: no _initializeBindWebComponent call found`);
  code = code.replace(CALL, (_m, name) => `bindComponentLifecycleHooks.preparing!(${name} as any)!`);
  const anchor = code.match(/^import .*from ["']vitest["'];\n/m);
  if (anchor === null) throw new Error(`${rel}: could not anchor the import`);
  code = code.replace(anchor[0], () => anchor[0] + `import { bindComponentLifecycleHooks } from "../src/webComponent/bindComponentLifecycle";\n`);
  await writeFile(file, code);
  console.log('patched', rel, `(${hits.length} calls)`);
}
console.log('done');
