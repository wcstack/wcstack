// S3, third slice (wiring design §8-2): after the stream slice and the recursion / dcc / watch slice,
// move the 13 remaining webComponent hot-path edges (mount overlay / public getters / volume slots
// in getByAddress and setByAddress, the `$n` shift in the get trap, the handler index scope, the
// loop-context hop across a mounted ShadowRoot, the reserved-slot diagnostic, the volume-relative
// `$updatedCallback`, and the pending-volume drain on root registration) into
// webComponent/addressHooks.ts, attached per state element when it learns it has a mount or a
// volume (`markHasMounts` / `markHasVolume` / `markHasGraftedVolumes`; a volume reserved before its
// root registers attaches through the registration listener). Two receptacles are not per state:
// list/loopContextByNode.ts takes a resolver for the ShadowRoot hop, and stateElementByName.ts
// takes registration listeners (both walked only at a boundary, never per read).
// Applied to a sandbox copy of packages/state that carries the two earlier slices; every anchor
// must match exactly the expected number of times.
//   node scripts/research/s3ScopesSlicePatch.mjs <sandbox>/packages/state
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pkg = process.argv[2];
if (!pkg) throw new Error('usage: s3ScopesSlicePatch.mjs <sandbox>/packages/state');
async function patch(rel, marker, edits) {
  const file = join(pkg, rel);
  let code = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  if (code.includes(marker)) { console.log('already patched', rel); return; }
  for (const edit of edits) {
    if (edit.length === 3 && typeof edit[2] === 'string') {
      // [startAnchor, endAnchor, replacement]: replace from the start anchor through the end anchor
      const [start, end, replacement] = edit;
      const s = code.indexOf(start);
      if (s === -1 || code.indexOf(start, s + 1) !== -1) throw new Error(`${rel}: start anchor not unique: ${start.slice(0, 70)}`);
      const e = code.indexOf(end, s);
      if (e === -1 || code.indexOf(end, e + 1) !== -1) throw new Error(`${rel}: end anchor not unique: ${end.slice(0, 70)}`);
      code = code.slice(0, s) + replacement + code.slice(e + end.length);
      continue;
    }
    const [anchor, replacement, expected = 1] = edit;
    const count = code.split(anchor).length - 1;
    if (count !== expected) throw new Error(`${rel}: anchor found ${count} times (expected ${expected}): ${anchor.slice(0, 70)}`);
    code = expected === 1 ? code.replace(anchor, () => replacement) : code.replaceAll(anchor, () => replacement);
  }
  await writeFile(file, code);
  console.log('patched', rel);
}
async function writeOnce(rel, content) {
  const file = join(pkg, rel);
  const existing = await readFile(file, 'utf8').catch(() => null);
  if (existing !== null && existing.replaceAll('\r\n', '\n').includes(content.slice(0, 200))) { console.log('already written', rel); return; }
  await writeFile(file, content);
  console.log('wrote', rel);
}

// 1. one more hook kind on the core bundle: the binding-time diagnostic suppression
await patch('src/core/addressHooks.ts', 'suppressPathDiagnostic', [
  [` *   updated      \`$updatedCallback\` の後。相対配送する機能が読む\n`,
   ` *   updated      \`$updatedCallback\` の後。相対配送する機能が読む\n *   suppressPathDiagnostic  束縛時の未宣言パス診断を黙らせるか（予約済みスロットの配下など）\n`],
  [`export type UpdatedHook = (stateElement: IStateElement, refs: IAbsoluteStateAddress[], receiver: any) => void;\n`,
   `export type UpdatedHook = (stateElement: IStateElement, refs: IAbsoluteStateAddress[], receiver: any) => void;\nexport type SuppressPathDiagnosticHook = (stateElement: IStateElement, path: string) => boolean;\n`],
  [`  readonly updated?: UpdatedHook;\n`, `  readonly updated?: UpdatedHook;\n  readonly suppressPathDiagnostic?: SuppressPathDiagnosticHook;\n`],
  [`  "get", "indexShift", "handlerScope", "updated",\n`, `  "get", "indexShift", "handlerScope", "updated", "suppressPathDiagnostic",\n`],
  [`    get: [], indexShift: [], handlerScope: [], updated: [],\n`, `    get: [], indexShift: [], handlerScope: [], updated: [], suppressPathDiagnostic: [],\n`],
]);

// 2. the scopes feature's hooks
await writeOnce('src/webComponent/addressHooks.ts', `/**
 * webComponent/addressHooks.ts — スコープ機能（bind-component のマウント・\`mount=\` のボリューム）を
 * 持つ state に付く hook（設計案 H1、S3）。従来 core（getByAddress / setByAddress / get トラップ /
 * event/handler / pathDiagnostics / updatedCallback）が直接 import していた分岐をここへ移し、
 * マウントもボリュームも無い state では一切走らない。
 *
 * 付ける時点: マウント記録の登録（State.markHasMounts）・ボリュームのスロット予約と接ぎ木
 * （State.markHasVolume / markHasGraftedVolumes）。ルートより先に予約されたボリュームは、ルートの
 * 登録時（stateElementByName の登録 listener — volume.ts の installVolumeGraft）に付く。
 * hook は要素の寿命の間は付いたままなので、各 hook は従来どおり \`hasMounts\` / \`hasGraftedVolumes\` の
 * boolean で自分の分岐を守る。
 */
import { DELIMITER } from "../define";
import { IAddressHooks, NOT_HANDLED, registerFeatureHooks } from "../core/addressHooks";
import { getScopedIndexes } from "../list/wildcardLevel";
import { raiseError } from "../raiseError";
import { resolveExport } from "./exportIndex";
import { findMountRecordForNode, getIndexShiftForMarkerPath, getMountRecordByPath } from "./mount";
import { createOverlayValue, readExportedAccessor, writeExportedAccessor } from "./overlay";
import { createVolumeChroot, findGraftedSlotUnder, getVolumeUpdatedCallbacks, isPathUnderReservedVolume } from "./volumeShared";

export const scopeAddressHooks: IAddressHooks = {
  // マウントのオーバーレイ dispatch（Phase 2・D20）。掛かるのは「マーカーで終わるパス」だけで、
  // その下（私有キー・getter・メソッド）の読み書きは通常の親ウォークが返された proxy への
  // 素の Reflect.get / Reflect.set として続く（overlay.ts）
  read(stateElement, address, receiver, handler) {
    if (stateElement.hasMounts === true && address.pathInfo.lastSegment.charCodeAt(0) === 35 /* '#' */) {
      const mountRecord = getMountRecordByPath(stateElement, address.pathInfo.path);
      if (mountRecord !== null) {
        return createOverlayValue(mountRecord, address, receiver, handler);
      }
    }
    return NOT_HANDLED;
  },
  readMissing(stateElement, address, parentValue, receiver, handler) {
    if (parentValue === null) {
      // 予約済みのボリュームスロット（D22）: ロード前の読みは undefined が正で、深いパスの
      // 親歩きがルート欠落に落ちても騒がない。読みは createState セッション内でしか起きず、
      // その間 rootNode は必ず有効（切断で null 化されるのは disconnectedCallback — セッション外）
      if (isPathUnderReservedVolume((stateElement as { rootNode?: Node }).rootNode ?? null, address.pathInfo.path)) {
        return undefined;
      }
      return NOT_HANDLED;
    }
    // 公開 getter の dispatch（docs/state-overlay-export-design.md §2-1）: 掛かるのは
    // 「ツリーの未存在キー」の分岐だけ（X1 — 命中する読みは無改造）
    if (stateElement.hasMounts === true) {
      const exported = resolveExport(stateElement, address.parentAddress!.pathInfo.path, address.pathInfo.lastSegment, address.listIndex);
      if (exported !== null) {
        return readExportedAccessor(exported.record, exported.entry, address.listIndex, receiver, handler);
      }
    }
    return NOT_HANDLED;
  },
  // D22 後段: 接ぎ木済みボリュームのマウントポイントを**含む親**の丸ごと書きは throw
  // （設計書 §4-2）。黙って通すと接ぎ木データが消え、quoted-path アクセサだけが
  // 宙に浮いて原因の見えない undefined / TypeError になる。スロット自身への書き込みは
  // 通常のデータ差し替えとして通す
  write(stateElement, address) {
    if (stateElement.hasGraftedVolumes === true) {
      const path = address.pathInfo.path;
      const shadowedSlot = findGraftedSlotUnder(stateElement, path);
      if (shadowedSlot !== null) {
        raiseError(
          \`Cannot replace "\${path}" wholesale: a volume is mounted at "\${shadowedSlot}" under it (D22). \` +
          \`Replacing an ancestor of a mount point silently discards the grafted data while its accessors remain. \` +
          \`Write "\${shadowedSlot}" itself, or individual fields inside "\${path}", instead.\`,
        );
      }
    }
    return NOT_HANDLED;
  },
  // 公開 getter への書き込み（docs/state-overlay-export-design.md X9）: 未存在キーへの
  // 書き込みは今日「ツリーに作る」が、その位置に公開 getter があると以後ツリーが勝ち
  // （X1）getter を無言で隠す。setter があれば setter、無ければ raise（overlay の set）
  writeMissing(stateElement, address, _parentValue, _key, value, receiver, handler) {
    if (stateElement.hasMounts === true) {
      const exported = resolveExport(stateElement, address.parentAddress!.pathInfo.path, address.pathInfo.lastSegment, address.listIndex);
      if (exported !== null) {
        return writeExportedAccessor(exported.record, exported.entry, address.listIndex, value, receiver, handler);
      }
    }
    return NOT_HANDLED;
  },
  // マウントのアクセサ評価中（マーカーパスが push されている）はスコープ相対の Δ を
  // 足す（設計書 §4-4: \`$n → listIndex.at(Δ + n - 1)\`。テンプレート側の \`$n\` は
  // 変換時に織り込み済み — mount.ts の translateInnerPath）
  indexShift(handler, lastAddress) {
    const stateElement = handler.stateElement;
    const lastPath = lastAddress.pathInfo.path;
    if (stateElement.hasMounts === true && lastPath.indexOf('#') !== -1) {
      const mountRecord = getMountRecordByPath(stateElement, lastPath);
      if (mountRecord !== null) {
        return getIndexShiftForMarkerPath(mountRecord, lastPath);
      }
    }
    return 0;
  },
  // マウントされたスコープ（v2）: 作者のハンドラが受ける添字は自スコープの
  // ループ分だけ（§4-4 / P2-9）。翻訳で増えたワイルドカード数を落とす。
  // 翻訳された for の台帳に無いループ文脈は外側スコープのもの（境界ホップで
  // 借りた行）なので、作者から見える添字は 0 本。
  // 記録の解決はノードから（findMountRecordForNode）— Shadow 形は rootNode
  // （shadowRoot）で直に引け、Light DOM 形はスコープ根がコンポーネント要素
  // 自身なので祖先走査が要る（rootNode だけ見ると Light DOM で外側の添字が漏れる）
  handlerScope(stateElement, node, rootNode, loopContext, wildcardCount) {
    if (stateElement.hasMounts !== true) {
      return wildcardCount;
    }
    const mountRecord = findMountRecordForNode(node, rootNode);
    if (mountRecord === null) {
      return wildcardCount;
    }
    const shift = mountRecord.indexShiftByLoopElementPath.get(loopContext.pathInfo.path);
    return typeof shift !== "undefined" ? wildcardCount - shift : 0;
  },
  // ボリュームの相対 $updatedCallback（volume.ts）: 自分の接頭辞配下の更新だけを相対パスで受ける。
  // 呼び出し順はルート自身の $updatedCallback の**後**（$watch の order 規約と同じ
  // 「ルート宣言が先」の向き）。ルートのコールバックが async でも待たない（順序の契約は呼び出し順のみ）
  updated(stateElement, refs, receiver) {
    const volumeCallbacks = getVolumeUpdatedCallbacks(stateElement);
    for (const volume of volumeCallbacks) {
      const prefix = volume.mountPath + DELIMITER;
      const relativePaths: Set<string> = new Set();
      const relativeIndexes: Record<string, Array<number[]>> = {};
      for (const ref of refs) {
        if (ref.absolutePathInfo.stateElement !== stateElement) {
          continue;
        }
        const path = ref.absolutePathInfo.pathInfo.path;
        if (path !== volume.mountPath && !path.startsWith(prefix)) {
          continue;
        }
        // マーカーパス（マウント私有キー）はボリューム相対配送にも漏らさない（D20/D21）
        if (path.indexOf("#") !== -1) {
          continue;
        }
        const relative = path === volume.mountPath ? "" : path.slice(prefix.length);
        if (relative === "") {
          continue; // マウントポイント自身（接ぎ木そのもの）は相対で表せない
        }
        relativePaths.add(relative);
        const wildcardCount = ref.absolutePathInfo.pathInfo.wildcardCount;
        if (wildcardCount > 0 && ref.listIndex !== null) {
          const indexes = getScopedIndexes(ref.listIndex, wildcardCount);
          (relativeIndexes[relative] ??= []).push(indexes);
        }
      }
      if (relativePaths.size > 0) {
        try {
          volume.callback.call(createVolumeChroot(volume.mountPath, receiver), Array.from(relativePaths), relativeIndexes);
        } catch (error) {
          console.error(\`[@wcstack/state] volume "\${volume.mountPath}" $updatedCallback threw.\`, error);
        }
      }
    }
  },
  // 予約済みのボリュームスロット配下はロード完了まで undefined が正（D22）。切断中の要素には
  // rootNode が無い（State の getter は投げる）ので予約を引かない — 切断中の再セットも経路情報を
  // 作り直してここへ来る（#267）
  suppressPathDiagnostic(stateElement, path) {
    const rootNode = stateElement.isConnected === false
      ? null
      : (stateElement as { rootNode?: Node }).rootNode ?? null;
    return isPathUnderReservedVolume(rootNode, path);
  },
};

let installed = false;
/** 冪等。full エントリでは State（markHasMounts / markHasVolume）と volume.ts の installVolumeGraft が呼ぶ */
export function installScopeHooks(): void {
  if (installed) return;
  installed = true;
  registerFeatureHooks("scopes", scopeAddressHooks);
}
`);

// 3. the loop-context hop across a mounted ShadowRoot becomes an injected resolver
await writeOnce('src/list/loopContextByNode.ts', `import { ILoopContext } from "./types";

const loopContextByNode = new WeakMap<Node, ILoopContext>();

// 親を持たない ShadowRoot で探索を続けるか。マウントされたスコープ根はホストへ抜ける
// （webComponent/mount.ts が記録の登録時に注入する）。未注入なら従来どおり境界で止まる —
// 走るのは探索が ShadowRoot に達した 1 回だけなので、大域の受け口でも hot path には載らない
let mountedScopeHost: ((root: ShadowRoot) => Node | null) | null = null;

export function setMountedScopeHost(resolver: (root: ShadowRoot) => Node | null): void {
  mountedScopeHost = resolver;
}

export function getLoopContextByNode(node: Node): ILoopContext | null {
  let paramNode: Node | null = node;
  while (paramNode) {
    const loopContext = loopContextByNode.get(paramNode);
    if (loopContext) {
      return loopContext;
    }
    let next: Node | null = paramNode.parentNode;
    if (next === null && mountedScopeHost !== null && paramNode instanceof ShadowRoot) {
      // マウントされた ShadowRoot はホストのループ文脈を継承する（impl-plan §3-0 の 3）。
      // ホスト行の listIndex [i] が子スコープの \`for\` の親になり、内側の行は [i, j] を
      // 作る — 絶対パスのワイルドカード数 ＝ listIndex 段数（設計書 §4-4）がこれで成立し、
      // v1 の crossBoundaryAddress / baseListIndex（Δ の帳簿）は要らなくなる。
      // マウントされていない ShadowRoot（plain コンポーネント・通常の Shadow ツリー）は
      // 従来どおり境界で止まる（resolver が null を返す）。
      next = mountedScopeHost(paramNode);
    }
    paramNode = next;
  }
  return null;
}

export function setLoopContextByNode(node: Node, loopContext: ILoopContext | null): void {
  if (loopContext === null) {
    loopContextByNode.delete(node);
    return;
  }
  loopContextByNode.set(node, loopContext);
}
`);

await patch('src/webComponent/mount.ts', 'setMountedScopeHost', [
  [`import { IStateElement } from "../components/types";\n`, `import { IStateElement } from "../components/types";\nimport { setMountedScopeHost } from "../list/loopContextByNode";\n`],
  [`export function registerMountRecord(scopeRoot: Node, record: IMountRecord): void {\n  mountRecordByScopeRoot.set(scopeRoot, record);\n`,
   `// ループ文脈の探索がマウントされた ShadowRoot でホストへ抜ける受け口（list/loopContextByNode.ts）。
// 最初の記録の登録で 1 回だけ注入する（マウントの無いページでは探索は境界で止まったまま）
let scopeHostInstalled = false;
function installMountedScopeHost(): void {
  if (scopeHostInstalled) return;
  scopeHostInstalled = true;
  setMountedScopeHost((root) => mountRecordByScopeRoot.has(root) ? root.host : null);
}

export function registerMountRecord(scopeRoot: Node, record: IMountRecord): void {
  installMountedScopeHost();
  mountRecordByScopeRoot.set(scopeRoot, record);\n`],
]);

// 4. root registration listeners replace the direct drain of pending volumes
await patch('src/stateElementByName.ts', 'onStateElementRegistered', [
  [`import { drainPendingVolumes } from "./webComponent/volumeShared";\n`, ``],
  [`export function getLiveStateElements(): ReadonlySet<IStateElement> {\n`,
   `// ルートの登録を待つ機能（先に接続されたボリュームの引き取り — webComponent/volume.ts）の受け口。
// 登録は 1 ルートにつき 1 回なので大域の listener 列で足りる（hot path には載らない）
type StateElementRegisteredListener = (rootNode: Node, element: IStateElement) => void;
const registeredListeners: StateElementRegisteredListener[] = [];

export function onStateElementRegistered(listener: StateElementRegisteredListener): void {
  if (!registeredListeners.includes(listener)) {
    registeredListeners.push(listener);
  }
}

export function getLiveStateElements(): ReadonlySet<IStateElement> {\n`],
  [`    // ルートの登録は、先に接続されて保留中のボリュームを引き取る\n    //（webComponent/volume.ts・ロード順に依存しない — V5）\n    drainPendingVolumes(rootNode, element);\n`,
   `    // ルートの登録を待っていた機能へ（先に接続されて保留中のボリュームの引き取り — ロード順に依存しない、V5）\n    for (let i = 0; i < registeredListeners.length; i++) {\n      registeredListeners[i](rootNode, element);\n    }\n`],
]);

await patch('src/webComponent/volumeShared.ts', 'hasReservedVolumeSlots', [
  [`  for (const slot of slots.keys()) {\n    if (path === slot || path.startsWith(slot + DELIMITER) || slot.startsWith(path + DELIMITER)) {\n      return true;\n    }\n  }\n  return false;\n}\n`,
   `  for (const slot of slots.keys()) {\n    if (path === slot || path.startsWith(slot + DELIMITER) || slot.startsWith(path + DELIMITER)) {\n      return true;\n    }\n  }\n  return false;\n}\n\n/** このルートに予約（手放した枠も台帳に残る）があるか — ルート登録時にスコープ機能の hook を付ける判定 */\nexport function hasReservedVolumeSlots(rootNode: Node): boolean {\n  const slots = reservedSlotsByRootNode.get(rootNode);\n  return typeof slots !== "undefined" && slots.size > 0;\n}\n`],
  [`  callbacks.push(entry);\n}\n\nexport function getVolumeUpdatedCallbacks`,
   `  callbacks.push(entry);\n  // 相対配送はルートに付いた updated hook が行う（接ぎ木が途中で落ちても配送先は付いている）\n  stateElement.markHasVolume?.();\n}\n\nexport function getVolumeUpdatedCallbacks`],
]);

await patch('src/webComponent/volume.ts', 'adoptVolumesOnRootRegistered', [
  [`import { addVolumeUpdatedCallback, createVolumeChroot, IPendingVolumeRequest, IVolumeUpdatedCallback, queuePendingVolume, recordGraftedSlot, setVolumeGraftHandler } from "./volumeShared";\n`,
   `import { addVolumeUpdatedCallback, createVolumeChroot, drainPendingVolumes, hasReservedVolumeSlots, IPendingVolumeRequest, IVolumeUpdatedCallback, queuePendingVolume, recordGraftedSlot, setVolumeGraftHandler } from "./volumeShared";\nimport { onStateElementRegistered } from "../stateElementByName";\nimport { installScopeHooks } from "./addressHooks";\n`],
  [`export function installVolumeGraft(): void {\n  if (volumeGraftInstalled) return;\n  volumeGraftInstalled = true;\n  setVolumeGraftHandler(graftIsolated);\n}\n`,
   `export function installVolumeGraft(): void {\n  if (volumeGraftInstalled) return;\n  volumeGraftInstalled = true;\n  installScopeHooks();\n  setVolumeGraftHandler(graftIsolated);\n  onStateElementRegistered(adoptVolumesOnRootRegistered);\n}\n\n// ルートの登録: 先に予約されたボリュームがあればスコープ機能の hook を付け、保留中の接ぎ木を引き取る\nfunction adoptVolumesOnRootRegistered(rootNode: Node, element: IStateElement): void {\n  if (hasReservedVolumeSlots(rootNode)) {\n    element.markHasVolume?.();\n  }\n  drainPendingVolumes(rootNode, element);\n}\n`],
]);

await patch('src/components/types.ts', 'markHasVolume', [
  [`  markHasGraftedVolumes?(): void;\n`, `  markHasGraftedVolumes?(): void;\n  /** ボリュームがこのルートに予約・接ぎ木された: スコープ機能の hook を付ける（webComponent/addressHooks.ts） */\n  markHasVolume?(): void;\n`],
]);

// 5. State: the element learns it has a mount / a volume and attaches the scopes hooks
await patch('src/components/State.ts', '_attachScopeHooks', [
  [`import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from "../webComponent/completeWebComponent";\n`,
   `import { markWebComponentAsComplete, markWebComponentStatePropDeclared } from "../webComponent/completeWebComponent";\nimport { installScopeHooks } from "../webComponent/addressHooks";\n`],
  [`import { callVolumeLifecycle, clearFailedRootNode, failPendingVolumes, graftOrQueueVolume, IVolumeGraftInfo, releaseVolumeSlot, reserveVolumeSlot, validateVolumeMountPath } from "../webComponent/volume";\n`,
   `import { callVolumeLifecycle, clearFailedRootNode, failPendingVolumes, graftOrQueueVolume, installVolumeGraft, IVolumeGraftInfo, releaseVolumeSlot, reserveVolumeSlot, validateVolumeMountPath } from "../webComponent/volume";\n`],
  [`  markHasMounts(): void {\n    this._hasMounts = true;\n  }\n`,
   `  markHasMounts(): void {\n    this._hasMounts = true;\n    this._attachScopeHooks("bind-component");\n  }\n`],
  [`  markHasGraftedVolumes(): void {\n    this._hasGraftedVolumes = true;\n  }\n`,
   `  markHasGraftedVolumes(): void {\n    this._hasGraftedVolumes = true;\n    this._attachScopeHooks("mount");\n  }\n\n  /** ボリュームがこのルートに予約された（接ぎ木前でも、予約下の読みは undefined が正 — D22） */\n  markHasVolume(): void {\n    this._attachScopeHooks("mount");\n  }\n\n  /** スコープ機能（マウント・ボリューム）の hook をこの state に付ける（冪等） */\n  private _attachScopeHooks(declaration: string): void {\n    installScopeHooks();\n    this.attachAddressHooks("scopes", declaration);\n  }\n`],
  [`  private async _initializeVolume(): Promise<void> {\n    const rootNode = this._rootNode!;\n    const mountPath = this.getAttribute("mount")!;\n`,
   `  private async _initializeVolume(): Promise<void> {\n    const rootNode = this._rootNode!;\n    const mountPath = this.getAttribute("mount")!;\n    // 予約より前に登録 listener を配線する（ルートがこの後で登録される形は listener が hook を付ける）\n    installVolumeGraft();\n`],
  [`      reserveVolumeSlot(rootNode, mountPath, this);\n      this._volumeMountPath = mountPath;\n`,
   `      reserveVolumeSlot(rootNode, mountPath, this);\n      // ルートが既に居れば今すぐ、まだなら登録時に（volume.ts の adoptVolumesOnRootRegistered）hook を付ける\n      getStateElement(rootNode)?.markHasVolume?.();\n      this._volumeMountPath = mountPath;\n`],
  [`              reserveVolumeSlot(this._rootNode!, this._volumeMountPath!, this);\n              this._volumeSlotRootNode = this._rootNode;\n`,
   `              reserveVolumeSlot(this._rootNode!, this._volumeMountPath!, this);\n              getStateElement(this._rootNode!)?.markHasVolume?.();\n              this._volumeSlotRootNode = this._rootNode;\n`],
  [`    this._volumeSlotRootNode = rootNode;\n    return true;\n`,
   `    getStateElement(rootNode)?.markHasVolume?.();\n    this._volumeSlotRootNode = rootNode;\n    return true;\n`],
]);

// 6. core receptacles
await patch('src/proxy/methods/getByAddress.ts', 'function readMissing(', [
  [`import { isPathUnderReservedVolume } from "../../webComponent/volumeShared";\n`, ``],
  [`import { getMountRecordByPath } from "../../webComponent/mount";\nimport { createOverlayValue, readExportedAccessor } from "../../webComponent/overlay";\nimport { resolveExport } from "../../webComponent/exportIndex";\n`, ``],
  [`function _getByAddress(\n`,
   `// 「ツリーに意見が無い」読み（親が無い・親にそのキーが無い）を機能に聞く（設計案 H1 の readMissing）。
// 親が無ければ parentValue は null。hook の無い state は判定 1 個で抜ける
function readMissing(
  stateElement: IStateElement,
  address: IStateAddress,
  parentValue: object | null,
  receiver: any,
  handler: IStateHandler,
): unknown {
  const hooks = stateElement.addressHooks;
  if (hooks) {
    const missing = hooks.readMissing;
    for (let i = 0; i < missing.length; i++) {
      const handled = missing[i](stateElement, address, parentValue, receiver, handler);
      if (handled !== NOT_HANDLED) return handled;
    }
  }
  return NOT_HANDLED;
}

function _getByAddress(\n`],
  [`  // $streamStatus / $streamError は stream/addressHooks.ts の read hook が答える（$streams を宣言した state だけに付く）\n  // マウントのオーバーレイ dispatch（Phase 2・D20）。掛かるのは「マーカーで終わる\n  // パス」だけで、その下（私有キー・getter・メソッド）の読み書きは通常の親ウォークが\n  // 返された proxy への素の Reflect.get / Reflect.set として続く（webComponent/overlay.ts）。\n  // マウントの無い state は boolean 判定 1 個で抜ける（D18）\n  if (stateElement.hasMounts === true && address.pathInfo.lastSegment.charCodeAt(0) === 35 /* '#' */) {\n    const mountRecord = getMountRecordByPath(stateElement, address.pathInfo.path);\n    if (mountRecord !== null) {\n      return createOverlayValue(mountRecord, address, receiver, handler);\n    }\n  }\n`,
   `  // $streamStatus / $streamError（stream/addressHooks.ts）とマーカーで終わるパスのオーバーレイ\n  // （webComponent/addressHooks.ts）は getByAddress の read hook が先に答える（宣言・マウントのある state だけに付く）\n`],
  [`    // 予約済みのボリュームスロット（D22）: ロード前の読みは undefined が正で、\n    // 深いパスの親歩きがここに落ちても騒がない\n    if (address.parentAddress === null\n      && isPathUnderReservedVolume(safeVolumeRootNode(stateElement), address.pathInfo.path)) {\n      return undefined;\n    }\n    const parentAddress = address.parentAddress ?? raiseError(\n      missingRootPathMessage(address.pathInfo.path, target, stateElement.getterPaths),\n    );\n`,
   `    // 親が無い（＝ ルート欠落）: ツリーに意見が無いので readMissing hook（予約済みボリューム\n    // スロットの配下なら undefined — D22）に先に聞き、無ければ raise する\n    if (address.parentAddress === null) {\n      const missing = readMissing(stateElement, address, null, receiver, handler);\n      if (missing !== NOT_HANDLED) {\n        return missing;\n      }\n      raiseError(missingRootPathMessage(address.pathInfo.path, target, stateElement.getterPaths));\n    }\n    const parentAddress = address.parentAddress;\n`],
  [`    // 公開 getter の dispatch（docs/state-overlay-export-design.md §2-1）: 掛かるのは\n    // 「ツリーの未存在キー」の分岐だけ（X1 — 命中する読みは無改造）。マウントの無い\n    // state は boolean 1 個で抜ける（D18）\n    if (stateElement.hasMounts === true && lastSegment !== WILDCARD\n      && !(lastSegment in Object(parentValue))) {\n      const exported = resolveExport(stateElement, parentAddress.pathInfo.path, lastSegment, address.listIndex);\n      if (exported !== null) {\n        return readExportedAccessor(exported.record, exported.entry, address.listIndex, receiver, handler);\n      }\n    }\n`,
   `    // 「ツリーの未存在キー」の分岐だけ readMissing hook（公開 getter の dispatch など）に聞く\n    // （X1 — 命中する読みは無改造）。hook の無い state は判定 1 個で抜ける\n    const hooks = stateElement.addressHooks;\n    if (hooks && hooks.readMissing.length !== 0 && lastSegment !== WILDCARD\n      && !(lastSegment in Object(parentValue))) {\n      const missing = readMissing(stateElement, address, Object(parentValue), receiver, handler);\n      if (missing !== NOT_HANDLED) {\n        return missing;\n      }\n    }\n`],
  [`\nfunction safeVolumeRootNode(stateElement: { rootNode?: Node }): Node | null {\n  // 読みは createState セッション内でしか起きず、その間 rootNode は必ず有効\n  //（切断で null 化されるのは disconnectedCallback — セッション外）\n  return stateElement.rootNode ?? null;\n}\n`, ``],
]);

await patch('src/proxy/methods/setByAddress.ts', 'hooks.writeMissing', [
  [`import { findGraftedSlotUnder } from "../../webComponent/volumeShared";\nimport { resolveExport } from "../../webComponent/exportIndex";\nimport { writeExportedAccessor } from "../../webComponent/overlay";\n`, ``],
  [`  // D22 後段: 接ぎ木済みボリュームのマウントポイントを**含む親**の丸ごと書きは throw\n  // （設計書 §4-2）。黙って通すと接ぎ木データが消え、quoted-path アクセサだけが\n  // 宙に浮いて原因の見えない undefined / TypeError になる。スロット自身への書き込みは\n  // 通常のデータ差し替えとして通す。ボリュームの無い state は boolean 判定 1 個で抜ける（D18）\n  if (stateElement.hasGraftedVolumes === true) {\n    const shadowedSlot = findGraftedSlotUnder(stateElement, path);\n    if (shadowedSlot !== null) {\n      raiseError(\n        \`Cannot replace "\${path}" wholesale: a volume is mounted at "\${shadowedSlot}" under it (D22). \` +\n        \`Replacing an ancestor of a mount point silently discards the grafted data while its accessors remain. \` +\n        \`Write "\${shadowedSlot}" itself, or individual fields inside "\${path}", instead.\`,\n      );\n    }\n  }\n`,
   `  // D22 後段（接ぎ木済みボリュームの親の丸ごと書き禁止）は webComponent/addressHooks.ts の write hook が担う\n`],
  [`        // 公開 getter への書き込み（docs/state-overlay-export-design.md X9）: 未存在キーへの\n        // 書き込みは今日「ツリーに作る」が、その位置に公開 getter があると以後ツリーが勝ち\n        // （X1）getter を無言で隠す。setter があれば setter、無ければ raise（overlay の set）\n        if (stateElement.hasMounts === true && lastSegment !== WILDCARD && !(key in parentValue)) {\n          const exported = resolveExport(stateElement, address.parentAddress.pathInfo.path, lastSegment, address.listIndex);\n          if (exported !== null) {\n            dispatchedExport = true;\n            return writeExportedAccessor(exported.record, exported.entry, address.listIndex, value, receiver, handler);\n          }\n        }\n`,
   `        // 「親にそのキーが無い」書き込みは writeMissing hook（公開 getter への書き込み — X9）に先に聞く。\n        // hook の無い state は判定 1 個で抜ける。hook が throw しても（setter の無い公開 getter）\n        // 代入値をキャッシュに固定しないよう、呼ぶ前に印を立て、素通しなら戻す\n        if (hooks && hooks.writeMissing.length !== 0 && lastSegment !== WILDCARD && !(key in parentValue)) {\n          const missing = hooks.writeMissing;\n          for (let i = 0; i < missing.length; i++) {\n            dispatchedExport = true;\n            const handled = missing[i](stateElement, address, parentValue, key, value, receiver, handler);\n            if (handled !== NOT_HANDLED) {\n              return handled;\n            }\n            dispatchedExport = false;\n          }\n        }\n`],
]);

await patch('src/proxy/traps/get.ts', 'shiftHooks.indexShift', [
  [`import { getIndexShiftForMarkerPath, getMountRecordByPath } from "../../webComponent/mount";\n`, ``],
  [`    // マウントのアクセサ評価中（マーカーパスが push されている）はスコープ相対の Δ を\n    // 足す（設計書 §4-4: \`$n → listIndex.at(Δ + n - 1)\`。テンプレート側の \`$n\` は\n    // 変換時に織り込み済み — webComponent/mount.ts の translateInnerPath）\n    if (handler.stateElement?.hasMounts === true && lastPathInfo.path.indexOf('#') !== -1) {\n      const mountRecord = getMountRecordByPath(handler.stateElement, lastPathInfo.path);\n      if (mountRecord !== null) {\n        scopedIndex = index + getIndexShiftForMarkerPath(mountRecord, lastPathInfo.path);\n      }\n    }\n`,
   `    // スコープ相対の Δ（マウントのアクセサ評価中 — 設計書 §4-4）は indexShift hook が足す\n    // （webComponent/addressHooks.ts。hook の無い state は判定 1 個で抜ける）\n    const shiftHooks = handler.stateElement?.addressHooks;\n    if (shiftHooks) {\n      const shifts = shiftHooks.indexShift;\n      for (let i = 0; i < shifts.length; i++) {\n        scopedIndex += shifts[i](handler, lastAddress!);\n      }\n    }\n`],
]);

await patch('src/event/handler.ts', 'hooks.handlerScope', [
  [`import { findMountRecordForNode } from "../webComponent/mount";\n`, ``],
  [`      let scopedWildcardCount = loopContext !== null ? loopContext.pathInfo.wildcardCount : 0;\n      if (loopContext !== null && stateElement.hasMounts === true) {\n        const mountRecord = findMountRecordForNode(node, rootNode);\n        if (mountRecord !== null) {\n          const shift = mountRecord.indexShiftByLoopElementPath.get(loopContext.pathInfo.path);\n          scopedWildcardCount = typeof shift !== "undefined" ? scopedWildcardCount - shift : 0;\n        }\n      }\n`,
   `      let scopedWildcardCount = loopContext !== null ? loopContext.pathInfo.wildcardCount : 0;\n      if (loopContext !== null) {\n        // 添字の段数はスコープ機能の handlerScope hook（webComponent/addressHooks.ts）が決める。\n        // hook の無い state は判定 1 個で抜ける\n        const hooks = stateElement.addressHooks;\n        if (hooks) {\n          const scopes = hooks.handlerScope;\n          for (let i = 0; i < scopes.length; i++) {\n            scopedWildcardCount = scopes[i](stateElement, node, rootNode, loopContext, scopedWildcardCount);\n          }\n        }\n      }\n`],
]);

await patch('src/pathDiagnostics.ts', 'hooks.suppressPathDiagnostic', [
  [`import { isPathUnderReservedVolume } from "./webComponent/volumeShared";\n`, ``],
  [`  // 予約済みのボリュームスロット配下はロード完了まで undefined が正（D22）。切断中の要素には\n  // rootNode が無い（State の getter は投げる）ので予約を引かない — 切断中の再セットも経路情報を\n  // 作り直してここへ来る（#267）\n  const rootNode = stateElement.isConnected === false\n    ? null\n    : (stateElement as { rootNode?: Node }).rootNode ?? null;\n  if (isPathUnderReservedVolume(rootNode, path)) {\n    return;\n  }\n`,
   `  // 機能が黙らせる領域（予約済みボリュームスロットの配下 — D22。webComponent/addressHooks.ts）は\n  // suppressPathDiagnostic hook に聞く。hook の無い state は判定 1 個で抜ける\n  const hooks = stateElement.addressHooks;\n  if (hooks) {\n    const suppress = hooks.suppressPathDiagnostic;\n    for (let i = 0; i < suppress.length; i++) {\n      if (suppress[i](stateElement, path)) {\n        return;\n      }\n    }\n  }\n`],
]);

await patch('src/proxy/apis/updatedCallback.ts', 'hooks.updated', [
  [`import { DELIMITER } from "../../define";\nimport { createVolumeChroot, getVolumeUpdatedCallbacks } from "../../webComponent/volumeShared";\n`, ``],
  [`  // ボリュームの相対 $updatedCallback（webComponent/volume.ts）: 自分の接頭辞配下の\n`, `  return result;\n}\n`,
   `  // ルートのコールバックの**後**に配送する機能（ボリュームの相対 $updatedCallback — webComponent/addressHooks.ts）は\n  // updated hook が受ける。hook の無い state は判定 1 個で抜ける\n  const hooks = handler.stateElement?.addressHooks;\n  if (hooks) {\n    const updated = hooks.updated;\n    for (let i = 0; i < updated.length; i++) {\n      updated[i](handler.stateElement, refs, receiver);\n    }\n  }\n  return result;\n}\n`],
]);

// 7. test-side: a mock root that registers a volume callback carries the scopes hooks, and a test
// that reserves a slot directly on the ledger (bypassing the volume element) marks the root itself
await patch('__tests__/integration.volumeMount.test.ts', 'rootElement.markHasVolume()', [
  [`    reserveVolumeSlot(shadowRoot, "pending", {});\n`, `    reserveVolumeSlot(shadowRoot, "pending", {});\n    rootElement.markHasVolume();\n`],
]);
await patch('__tests__/proxy.apis.updatedCallback.test.ts', 'scopeAddressHooks', [
  [`import { addVolumeUpdatedCallback } from '../src/webComponent/volumeShared';\n`,
   `import { addVolumeUpdatedCallback } from '../src/webComponent/volumeShared';\nimport { createAttachedHooksFrom } from '../src/core/addressHooks';\nimport { scopeAddressHooks } from '../src/webComponent/addressHooks';\n`],
  [`    addVolumeUpdatedCallback(stateElement as any, { mountPath: 'vol', callback: volumeCallback });\n`,
   `    addVolumeUpdatedCallback(stateElement as any, { mountPath: 'vol', callback: volumeCallback });\n    (stateElement as any).addressHooks = createAttachedHooksFrom(scopeAddressHooks);\n`],
]);

// 8. the boundary test: the branches the integration suite no longer reaches once the code lives in hooks
await writeOnce('__tests__/core.addressHooks.test.ts', `/**
 * core/addressHooks.ts（設計案 H1、S3）と各機能の hook モジュールの境界。
 * 統合テストが通らない分岐（readiness barrier・冪等な install・再セット後の再帰 hook・
 * マウントもボリュームも無い state に付いた scopes hook の素通し・$postUpdate 後の written hook）を固定する。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/updater/updater", () => ({ getUpdater: () => ({ enqueueAbsoluteAddress: vi.fn() }) }));
vi.mock("../src/dependency/walkDependency", () => ({ walkDependency: vi.fn() }));
vi.mock("../src/proxy/methods/getListIndex", () => ({ getListIndex: () => null }));

import { appendHooks, createAttachedHooks, createAttachedHooksFrom, isFeatureRegistered, NOT_HANDLED, registerFeatureHooks, requireFeature } from "../src/core/addressHooks";
import { installDccHooks } from "../src/dcc/addressHooks";
import { installRecursionHooks, recursionAddressHooks } from "../src/recursion/addressHooks";
import { installScopeHooks, scopeAddressHooks } from "../src/webComponent/addressHooks";
import { addVolumeUpdatedCallback } from "../src/webComponent/volumeShared";
import { postUpdate } from "../src/proxy/apis/postUpdate";
import { createStateAddress } from "../src/address/StateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { createListIndex } from "../src/list/createListIndex";

describe("core/addressHooks: レジストリと readiness barrier", () => {
  it("未 install の機能を宣言が要求すると [wcs/feature-not-installed] で名指しで落ちること", () => {
    expect(isFeatureRegistered("no-such-feature")).toBe(false);
    expect(() => requireFeature("no-such-feature", "$nothing"))
      .toThrow(/\\[wcs\\/feature-not-installed\\] "\\$nothing" needs the "no-such-feature" feature/);
  });

  it("install 済みの機能は hook 実装を返し、同じ実装は束に 1 回しか載らないこと", () => {
    const read = vi.fn(() => NOT_HANDLED);
    registerFeatureHooks("test-feature", { read });
    expect(isFeatureRegistered("test-feature")).toBe(true);
    const attached = createAttachedHooks();
    appendHooks(attached, requireFeature("test-feature", "$test"));
    appendHooks(attached, requireFeature("test-feature", "$test"));
    expect(attached.read).toEqual([read]);
    expect(attached.write).toEqual([]);
    const combined = createAttachedHooksFrom({ read }, { write: vi.fn() as any });
    expect(combined.read).toHaveLength(1);
    expect(combined.write).toHaveLength(1);
  });

  it("各機能の install は冪等であること", () => {
    installDccHooks();
    installDccHooks();
    installRecursionHooks();
    installRecursionHooks();
    installScopeHooks();
    installScopeHooks();
    expect(isFeatureRegistered("dcc")).toBe(true);
    expect(isFeatureRegistered("recursion")).toBe(true);
    expect(isFeatureRegistered("scopes")).toBe(true);
  });
});

describe("hook は要素の寿命の間は付いたまま: 宣言が消えた後・該当しない state での素通し", () => {
  it("再セットで $recursion が消えた state では再帰の write hook が素通しすること", () => {
    const stateElement = { hasRecursion: false, recursionRegistry: null } as any;
    const address = createStateAddress(getPathInfo("nodes.0.total"), null);
    expect(recursionAddressHooks.write!(stateElement, address, 1, {}, {} as any)).toBe(NOT_HANDLED);
  });

  it("予約の無いルートの欠落読みは scopes の readMissing hook が素通しすること（core が raise する）", () => {
    const stateElement = { rootNode: document.createElement("div") } as any;
    const address = createStateAddress(getPathInfo("missing"), null);
    expect(scopeAddressHooks.readMissing!(stateElement, address, null, {}, {} as any)).toBe(NOT_HANDLED);
  });

  it("マウントの無い state（ボリュームだけ）のハンドラは添字の段数をそのまま返すこと", () => {
    const stateElement = { hasMounts: false } as any;
    const loopContext = createStateAddress(getPathInfo("items.*"), createListIndex(null, 0)) as any;
    expect(scopeAddressHooks.handlerScope!(stateElement, document.createElement("button"), document, loopContext, 1)).toBe(1);
  });

  it("ボリュームの相対配送は他の state 要素の ref を読み飛ばし、コールバックの無いルートでは何もしないこと", () => {
    const root = { name: "root" } as any;
    const other = { name: "other" } as any;
    const callback = vi.fn();
    addVolumeUpdatedCallback(root, { mountPath: "vol", callback });
    const foreignRef = { absolutePathInfo: { stateElement: other, pathInfo: getPathInfo("vol.x") }, listIndex: null } as any;
    scopeAddressHooks.updated!(root, [foreignRef], {});
    expect(callback).not.toHaveBeenCalled();
    expect(() => scopeAddressHooks.updated!({ name: "lonely" } as any, [foreignRef], {})).not.toThrow();
  });
});

describe("$postUpdate の後の written hook", () => {
  it("in-place 変異の通知が written hook に届くこと（DCC の bindable イベントの経路）", () => {
    const written = vi.fn();
    const stateElement = {
      name: "default", staticDependency: new Map(), dynamicDependency: new Map(), listPaths: new Set(),
      bindableEventMap: {}, addressHooks: createAttachedHooksFrom({ written }),
    } as any;
    const handler = { stateElement } as any;
    postUpdate({}, "$postUpdate", {}, handler)("count");
    expect(written).toHaveBeenCalledTimes(1);
    expect(written.mock.calls[0][0]).toBe(stateElement);
    expect(written.mock.calls[0][1].path).toBe("count");
  });
});
`);
console.log('done');
