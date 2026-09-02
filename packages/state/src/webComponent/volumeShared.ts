/**
 * webComponent/volumeShared.ts — ボリュームの軽量共有面。
 *
 * ホットパス（proxy/methods/getByAddress・proxy/apis/updatedCallback・pathDiagnostics）が
 * 引く台帳と chroot だけを置く。graft 本体（webComponent/volume.ts）は watch runtime 等の
 * 重い依存を持つため、ここに混ぜると「updater を部分モックするテスト」が import 連鎖で
 * 壊れる（watchRuntime は import 時に drain リスナーを登録する）。
 */

import { DELIMITER } from "../define";
import { raiseError } from "../raiseError";
import { IStateElement } from "../components/types";

/** 予約済みスロット（D22）。キーは rootNode、値はマウントパスの集合。 */
const reservedSlotsByRootNode = new WeakMap<Node, Set<string>>();

export function reserveVolumeSlot(rootNode: Node, mountPath: string): void {
  let slots = reservedSlotsByRootNode.get(rootNode);
  if (typeof slots === "undefined") {
    slots = new Set();
    reservedSlotsByRootNode.set(rootNode, slots);
  }
  if (slots.has(mountPath)) {
    raiseError(`Volume slot "${mountPath}" is already mounted on this tree.`);
  }
  slots.add(mountPath);
}

/**
 * パスが予約済みスロットの配下（または祖先）か。pathDiagnostics と getByAddress の
 * ルート欠落 raise が「予約下の読みは undefined が正」（D22）のために引く。
 */
export function isPathUnderReservedVolume(rootNode: Node | null, path: string): boolean {
  if (rootNode === null) {
    return false;
  }
  const slots = reservedSlotsByRootNode.get(rootNode);
  if (typeof slots === "undefined" || slots.size === 0) {
    return false;
  }
  for (const slot of slots) {
    if (path === slot || path.startsWith(slot + DELIMITER) || slot.startsWith(path + DELIMITER)) {
      return true;
    }
  }
  return false;
}

/** ボリュームの chroot（相対キー → `<mountPath>.<key>` を receiver に翻訳する薄い proxy）。 */
export function createVolumeChroot(mountPath: string, receiver: any): Record<string, any> {
  return new Proxy({} as Record<string, any>, {
    get(_target, prop): any {
      if (typeof prop !== "string" || prop === "then") {
        return undefined;
      }
      if (prop[0] === "$") {
        if (prop === "$postUpdate") {
          return (path: string): void => {
            receiver.$postUpdate(mountPath + DELIMITER + path);
          };
        }
        if (prop === "$getAll" || prop === "$setAll" || prop === "$resolve") {
          const api = prop;
          return (path: string, ...rest: unknown[]): unknown =>
            receiver[api](mountPath + DELIMITER + path, ...rest);
        }
        // 他の `$` は親の意味論のまま（宣言面はボリュームが登録時に翻訳する）
        return receiver[prop];
      }
      return receiver[mountPath + DELIMITER + prop];
    },
    set(_target, prop, value): boolean {
      if (typeof prop !== "string") {
        return true;
      }
      receiver[mountPath + DELIMITER + prop] = value;
      return true;
    },
    has(_target, prop): boolean {
      // ボリュームの面はツリーそのもの — マウント配下は常に解決する
      return typeof prop === "string" && prop[0] !== "$" && prop[0] !== "#";
    },
  });
}

/** ボリュームの相対 $updatedCallback（ルート state 要素 → 登録リスト）。 */
export interface IVolumeUpdatedCallback {
  readonly mountPath: string;
  readonly callback: (this: unknown, paths: string[], indexesListByPath: Record<string, Array<number[]>>) => unknown;
}
const volumeUpdatedCallbacksByRoot = new WeakMap<IStateElement, IVolumeUpdatedCallback[]>();

const NO_VOLUME_UPDATED_CALLBACKS: readonly IVolumeUpdatedCallback[] = [];

export function addVolumeUpdatedCallback(stateElement: IStateElement, entry: IVolumeUpdatedCallback): void {
  let callbacks = volumeUpdatedCallbacksByRoot.get(stateElement);
  if (typeof callbacks === "undefined") {
    callbacks = [];
    volumeUpdatedCallbacksByRoot.set(stateElement, callbacks);
  }
  callbacks.push(entry);
}

export function getVolumeUpdatedCallbacks(stateElement: IStateElement): readonly IVolumeUpdatedCallback[] {
  return volumeUpdatedCallbacksByRoot.get(stateElement) ?? NO_VOLUME_UPDATED_CALLBACKS;
}

/**
 * ルート登録待ちのボリューム（stateElementByName が引き取りを起動する）。
 * graft の実体（webComponent/volume.ts）は import 時にハンドラを注入する —
 * stateElementByName → volume の直接 import は updater までの循環を作るため。
 */
export interface IPendingVolumeRequest {
  readonly mountPath: string;
  readonly volumeState: Record<string, any>;
  readonly onGrafted: (info: unknown) => void;
}
const pendingVolumesByRootNode = new WeakMap<Node, IPendingVolumeRequest[]>();

let graftHandler: ((rootStateElement: IStateElement, request: IPendingVolumeRequest) => void) | null = null;

export function setVolumeGraftHandler(handler: (rootStateElement: IStateElement, request: IPendingVolumeRequest) => void): void {
  graftHandler = handler;
}

export function queuePendingVolume(rootNode: Node, request: IPendingVolumeRequest): void {
  let pending = pendingVolumesByRootNode.get(rootNode);
  if (typeof pending === "undefined") {
    pending = [];
    pendingVolumesByRootNode.set(rootNode, pending);
  }
  pending.push(request);
}

/** ルート登録時に保留中のボリュームを接ぎ木する（stateElementByName から呼ばれる）。 */
export function drainPendingVolumes(rootNode: Node, rootStateElement: IStateElement): void {
  const pending = pendingVolumesByRootNode.get(rootNode);
  if (typeof pending === "undefined" || pending.length === 0 || graftHandler === null) {
    return;
  }
  pendingVolumesByRootNode.delete(rootNode);
  // 登録はルートの _initialize の途中（createState はまだ危うい）— microtask に
  // 遅らせてルートの接続完了後に接ぎ木する
  const handler = graftHandler;
  queueMicrotask(() => {
    for (const request of pending) {
      handler(rootStateElement, request);
    }
  });
}
