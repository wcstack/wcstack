// S3, first slice (wiring design §8-2, decisions D12 / D13): the H1 receptacle in its decided
// shape — hooks are attached PER STATE ELEMENT when the state's declaration requires a feature,
// from a registry that install() fills; the hot path leaves through one `addressHooks === null`
// check — applied to the stream feature, whose three core → stream edges (getByAddress →
// argsTrace / streamNamespace, the get trap → streamNamespace) move into stream/addressHooks.ts.
// The readiness barrier (D13) is `requireFeature()`, called by the `_state` setter when `$streams`
// is declared; in the full bundle State.ts still imports the stream runtime (H3 is not extracted
// yet), so it installs the feature itself first and the barrier can only fire on a split entry.
// Applied to a sandbox copy of packages/state; every anchor must match exactly once.
//   node scripts/research/s3StreamSlicePatch.mjs <sandbox>/packages/state
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s3StreamSlicePatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, 'src', rel);
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

// 1. the receptacle: registry + per-state attachment
await mkdir(join(pkg, 'src/core'), { recursive: true });
await writeFile(join(pkg, 'src/core/addressHooks.ts'), `/**
 * core/addressHooks.ts — 読み書き境界の受け口（設計案 H1、S3）。
 *
 * 機能は \`install()\` でレジストリに hook 実装を置く（hot path には触れない）。state 要素は
 * 宣言が要求する機能の hook だけを \`attachAddressHooks\` で自分に付け、getByAddress /
 * setByAddress / get トラップは \`stateElement.addressHooks\` が null なら判定 1 回で抜ける
 * （調査 §10.8: 大域配列の走査は読み +40%、state ごとの門なら +0.1 ns）。
 * 宣言が要求する機能が未 install なら \`requireFeature\` が宣言時に throw する（readiness barrier、D13）。
 */
import type { IStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import type { IStateHandler } from "../proxy/types";
import { raiseError } from "../raiseError";

export const NOT_HANDLED: unique symbol = Symbol("wcs.notHandled");
export type ReadHook = (stateElement: IStateElement, address: IStateAddress, receiver: any, handler: IStateHandler) => unknown;
export type WriteHook = (stateElement: IStateElement, address: IStateAddress, value: unknown, receiver: any, handler: IStateHandler) => unknown;
export type GetHook = (handler: IStateHandler, prop: string, receiver: any) => unknown;
export interface IAddressHooks {
  readonly read?: ReadHook;
  readonly write?: WriteHook;
  readonly get?: GetHook;
}
/** state 要素に付いた hook 群（機能の登録順） */
export interface IAttachedHooks {
  readonly read: ReadHook[];
  readonly write: WriteHook[];
  readonly get: GetHook[];
}

const registry = new Map<string, IAddressHooks>();

/** 機能の install が呼ぶ（冪等）。hot path には触れない */
export function registerFeatureHooks(feature: string, hooks: IAddressHooks): void {
  registry.set(feature, hooks);
}

export function isFeatureRegistered(feature: string): boolean {
  return registry.has(feature);
}

/** 宣言 \`declaration\` が機能 \`feature\` を要求した: 未 install なら名指しで throw する（D13） */
export function requireFeature(feature: string, declaration: string): IAddressHooks {
  const hooks = registry.get(feature);
  if (typeof hooks === "undefined") {
    raiseError(\`[wcs/feature-not-installed] "\${declaration}" needs the "\${feature}" feature: install it before defining the state.\`);
  }
  return hooks;
}

export function createAttachedHooks(): IAttachedHooks {
  return { read: [], write: [], get: [] };
}

/** \`hooks\` を \`attached\` に足す（同じ実装は 1 回だけ） */
export function appendHooks(attached: IAttachedHooks, hooks: IAddressHooks): void {
  if (typeof hooks.read !== "undefined" && !attached.read.includes(hooks.read)) attached.read.push(hooks.read);
  if (typeof hooks.write !== "undefined" && !attached.write.includes(hooks.write)) attached.write.push(hooks.write);
  if (typeof hooks.get !== "undefined" && !attached.get.includes(hooks.get)) attached.get.push(hooks.get);
}
`);
console.log('wrote core/addressHooks.ts');

// 2. the element type and State: per-state hooks, attached from the declaration
await patch('components/types.ts', 'addressHooks', [
  [`  readonly hasGraftedVolumes?: boolean;
  markHasGraftedVolumes?(): void;`, `  readonly hasGraftedVolumes?: boolean;
  markHasGraftedVolumes?(): void;
  /**
   * 読み書き境界の hook（core/addressHooks.ts、設計案 H1）。宣言が要求する機能の分だけ
   * \`attachAddressHooks\` で付く。無い state は null 判定 1 個で抜ける。optional はモック互換
   */
  readonly addressHooks?: import("../core/addressHooks").IAttachedHooks | null;
  attachAddressHooks?(feature: string, declaration: string): void;`],
]);

await patch('components/State.ts', '_addressHooks', [
  [`import { startStreams } from "../stream/streamRuntime";`, `import { installStreamRuntime, startStreams } from "../stream/streamRuntime";
import { STATE_STREAMS_NAME as STATE_STREAMS_DECLARATION } from "../define";
import { appendHooks, createAttachedHooks, IAttachedHooks, requireFeature } from "../core/addressHooks";`],
  [`  private _hasGraftedVolumes: boolean = false;`, `  private _hasGraftedVolumes: boolean = false;
  /** 読み書き境界の hook（設計案 H1）。宣言が要求する機能の分だけ付く */
  private _addressHooks: IAttachedHooks | null = null;`],
  [`  get hasGraftedVolumes(): boolean {
    return this._hasGraftedVolumes;
  }`, `  get hasGraftedVolumes(): boolean {
    return this._hasGraftedVolumes;
  }

  get addressHooks(): IAttachedHooks | null {
    return this._addressHooks;
  }

  /** 宣言 \`declaration\` が要求する機能 \`feature\` の hook をこの state に付ける（未 install なら throw、D13） */
  attachAddressHooks(feature: string, declaration: string): void {
    const hooks = requireFeature(feature, declaration);
    if (this._addressHooks === null) {
      this._addressHooks = createAttachedHooks();
    }
    appendHooks(this._addressHooks, hooks);
  }`],
  [`    clearStreamNamespace(this);
    clearStreamRegistry(this);
    processStreamsDeclaration(this, value);`, `    clearStreamNamespace(this);
    clearStreamRegistry(this);
    processStreamsDeclaration(this, value);
    // hook は要素の寿命の間は付いたまま（再 set で $streams が消えても、残った $streamStatus /
    // $streamError の束縛は名前空間の null を読む — 従来の core 直結と同じ振る舞い）
    if (typeof (value as Record<string, unknown>)[STATE_STREAMS_DECLARATION] !== "undefined") {
      // full エントリでは State が stream runtime を静的に import しているので、ここで install する
      // （H3 の切り出し後は分割エントリの \`install\` が担い、未 install は requireFeature が落とす）
      installStreamRuntime();
      this.attachAddressHooks("streams", STATE_STREAMS_DECLARATION);
    }`],
]);

// 3. the stream feature's hooks, registered by installStreamRuntime()
await writeFile(join(pkg, 'src/stream/addressHooks.ts'), `/**
 * stream/addressHooks.ts — \`$streams\` を宣言した state に付く読み書き境界の hook（設計案 H1、S3）。
 * 従来 core（getByAddress / get トラップ）が直接 import していた 3 辺（argsTrace・streamNamespace）を
 * ここへ移し、\`$streams\` の無い state では一切走らない。
 */
import { STATE_STREAM_ERROR_NAMESPACE_NAME, STATE_STREAM_STATUS_NAMESPACE_NAME } from "../define";
import { NOT_HANDLED, IAddressHooks } from "../core/addressHooks";
import { collectStreamDependency } from "./argsTrace";
import { getStreamErrorNamespace, getStreamStatusNamespace } from "./streamNamespace";

/** namespace 配下のパスは raw state を持たないため namespace オブジェクトを辿る（getByAddress の walkNamespace と同じ規約） */
function walkNamespace(namespace: object, segments: string[]): any {
  let value: any = namespace;
  for (let i = 1; i < segments.length; i++) {
    if (Object(value) !== value) {
      return undefined;
    }
    value = Reflect.get(value, segments[i]);
  }
  return value;
}

export const streamAddressHooks: IAddressHooks = {
  read(stateElement, address) {
    // $streams の args トレース中のみ絶対アドレスを捕捉（collector 非活性なら即 return）
    collectStreamDependency(stateElement, address);
    const firstSegment = address.pathInfo.segments[0];
    if (firstSegment === STATE_STREAM_STATUS_NAMESPACE_NAME) {
      return walkNamespace(getStreamStatusNamespace(stateElement), address.pathInfo.segments);
    }
    if (firstSegment === STATE_STREAM_ERROR_NAMESPACE_NAME) {
      return walkNamespace(getStreamErrorNamespace(stateElement), address.pathInfo.segments);
    }
    return NOT_HANDLED;
  },
  get(handler, prop) {
    if (prop === STATE_STREAM_STATUS_NAMESPACE_NAME) {
      return getStreamStatusNamespace(handler.stateElement);
    }
    if (prop === STATE_STREAM_ERROR_NAMESPACE_NAME) {
      return getStreamErrorNamespace(handler.stateElement);
    }
    return NOT_HANDLED;
  },
};
`);
console.log('wrote stream/addressHooks.ts');

await patch('stream/streamRuntime.ts', 'registerFeatureHooks', [
  [`import { registerUpdateBatchListener } from "../updater/updater";`, `import { registerUpdateBatchListener } from "../updater/updater";
import { registerFeatureHooks } from "../core/addressHooks";
import { streamAddressHooks } from "./addressHooks";`],
  [`  streamRuntimeInstalled = true;
  registerUpdateBatchListener(restartStreamsOnUpdateBatch, STREAM_LISTENER_PRIORITY);`, `  streamRuntimeInstalled = true;
  registerFeatureHooks("streams", streamAddressHooks);
  registerUpdateBatchListener(restartStreamsOnUpdateBatch, STREAM_LISTENER_PRIORITY);`],
]);

// 4. core: the receptacle loops replace the stream branches
await patch('proxy/methods/getByAddress.ts', 'addressHooks', [
  [`import { collectStreamDependency } from "../../stream/argsTrace";
import { getStreamErrorNamespace, getStreamStatusNamespace } from "../../stream/streamNamespace";
`, `import { NOT_HANDLED } from "../../core/addressHooks";
`],
  [`  if (firstSegment === STATE_STREAM_STATUS_NAMESPACE_NAME) {
    // $streamStatus / $streamError 名前空間: キーは宣言済み stream 名
    // （registry entry が正本の thin gateway、docs/state-streams-design.md §4-2）。
    // setByAddress の親走査もここを通るため、子への Reflect.set が namespace proxy の
    // raiseError に到達する = 書き込み防御（S11）もこの分岐で成立する。
    return walkNamespace(getStreamStatusNamespace(stateElement), address.pathInfo.segments);
  }
  if (firstSegment === STATE_STREAM_ERROR_NAMESPACE_NAME) {
    return walkNamespace(getStreamErrorNamespace(stateElement), address.pathInfo.segments);
  }
`, `  // $streamStatus / $streamError は stream/addressHooks.ts の read hook が答える（$streams を宣言した state だけに付く）
`],
  [`  // $streams の args トレース中のみ絶対アドレスを捕捉（collector 非活性なら即 return）
  collectStreamDependency(handler.stateElement, address);
  const stateElement = handler.stateElement;`, `  const stateElement = handler.stateElement;
  // 読み書き境界の hook（設計案 H1）: 宣言が要求した機能の分だけ state に付いている。無ければ判定 1 回
  const hooks = stateElement.addressHooks;
  if (hooks) {
    const readHooks = hooks.read;
    for (let i = 0; i < readHooks.length; i++) {
      const handled = readHooks[i](stateElement, address, receiver, handler);
      if (handled !== NOT_HANDLED) return handled;
    }
  }`],
]);

await patch('proxy/traps/get.ts', 'addressHooks', [
  [`import { getStreamErrorNamespace, getStreamStatusNamespace } from "../../stream/streamNamespace";
`, `import { NOT_HANDLED } from "../../core/addressHooks";
`],
  [`  if (typeof prop === "string") {
    if (prop[0] === '$') {`, `  if (typeof prop === "string") {
    // 読み書き境界の hook（設計案 H1）: $streamStatus / $streamError などの名前空間は機能側が答える
    const hooks = handler.stateElement?.addressHooks;
    if (hooks) {
      const getHooks = hooks.get;
      for (let i = 0; i < getHooks.length; i++) {
        const handled = getHooks[i](handler, prop, receiver);
        if (handled !== NOT_HANDLED) return handled;
      }
    }
    if (prop[0] === '$') {`],
  [`        case STATE_STREAM_STATUS_NAMESPACE_NAME: {
          return getStreamStatusNamespace(handler.stateElement);
        }
        case STATE_STREAM_ERROR_NAMESPACE_NAME: {
          return getStreamErrorNamespace(handler.stateElement);
        }
`, ``],
]);

await patch('proxy/methods/setByAddress.ts', 'addressHooks', [
  [`import { walkDependency } from "../../dependency/walkDependency";`, `import { walkDependency } from "../../dependency/walkDependency";
import { NOT_HANDLED } from "../../core/addressHooks";`],
  [`  const stateElement = handler.stateElement;
  const path = address.pathInfo.path;
  // D22 後段:`, `  const stateElement = handler.stateElement;
  const path = address.pathInfo.path;
  // 読み書き境界の hook（設計案 H1、書き側）。無ければ判定 1 回
  const hooks = stateElement.addressHooks;
  if (hooks) {
    const writeHooks = hooks.write;
    for (let i = 0; i < writeHooks.length; i++) {
      const handled = writeHooks[i](stateElement, address, value, receiver, handler);
      if (handled !== NOT_HANDLED) return handled;
    }
  }
  // D22 後段:`],
]);

// test-side: the argsTrace unit test builds a mock state element by hand; it now carries the
// stream hooks the real element attaches on `$streams` (the one adaptation the record mentions)
{
  const file = join(pkg, '__tests__/stream.argsTrace.test.ts');
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes('streamAddressHooks')) {
    console.log('already patched __tests__/stream.argsTrace.test.ts');
  } else {
    for (const [anchor, replacement] of [
      [`import { collectStreamDependency, traceArgs } from "../src/stream/argsTrace";\n`,
       `import { collectStreamDependency, traceArgs } from "../src/stream/argsTrace";\nimport { streamAddressHooks } from "../src/stream/addressHooks";\n`],
      [`    bindableEventMap: {},\n`,
       `    bindableEventMap: {},\n    addressHooks: { read: [streamAddressHooks.read!], write: [], get: [streamAddressHooks.get!] },\n`],
    ]) {
      const count = code.split(anchor).length - 1;
      if (count !== 1) throw new Error(`stream.argsTrace.test.ts: anchor found ${count} times: ${anchor.slice(0, 70)}`);
      code = code.replace(anchor, () => replacement);
    }
    await writeFile(file, code);
    console.log('patched __tests__/stream.argsTrace.test.ts');
  }
}
