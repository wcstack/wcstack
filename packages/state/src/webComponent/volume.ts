/**
 * webComponent/volume.ts — ボリューム（`<wcs-state mount="path">` の接ぎ木）。
 * docs/state-mount-design.md §3-1 / §4-2、D11 / D14 / D22。impl-plan P3-1 / P3-2 / P3-3。
 *
 * ボリュームは自分の台帳を持たない。ロード完了で
 *
 * 1. **データ**（own data key の部分木）をルートの書き込み proxy 経由で
 *    `root[mountPath] = data` と接ぎ木する — 通知・依存展開は通常の書き込みと同じ。
 * 2. **アクセサ**（getter / setter）を **ルートの state オブジェクトの quoted-path
 *    プロパティ**（`"i18n.t"`）として定義する — ルートのワイルドカード getter
 *    （`"children.*.label"`）と同じ機構にそのまま乗るので、評価は pushAddress 下で行われ、
 *    中の読みは依存エッジとして親グラフに載る。`this` は chroot（`this.lang` は
 *    `i18n.lang`）— 評価時の receiver（アクティブなルート proxy）を包む翻訳 proxy。
 * 3. `$connectedCallback` を chroot で呼ぶ（V7）。
 *
 * 接続時にはスロットを**予約**する（D22）: 予約下のパスの読みは `undefined` で、
 * pathDiagnostics は沈黙する（ロード前の一時状態は「未宣言」ではない）。
 * ルートより先に接続されてもよい（V5）— ルートの登録（setStateElementByName の
 * `default`）が保留中のボリュームを引き取る。
 *
 * まだ載せていないもの（宣言面 P2-9b と同じ束）: `$watch` / `$streams` / `$listKeys` の
 * 接頭辞登録、`$updatedCallback`（相対）、ボリュームのメソッドのツリー露出、
 * 深いマウントの親を丸ごと書く形の throw（D22 後段）。
 */

import { getPathInfo } from "../address/PathInfo";
import { IStateElement } from "../components/types";
import { DELIMITER, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import { IStateProxy } from "../proxy/types";

/** 予約済みスロット（D22）。キーは rootNode、値はマウントパスの集合。 */
const reservedSlotsByRootNode = new WeakMap<Node, Set<string>>();

/** ルート登録待ちのボリューム。 */
interface IPendingVolume {
  readonly mountPath: string;
  readonly volumeState: Record<string, any>;
  readonly onGrafted: () => void;
}
const pendingVolumesByRootNode = new WeakMap<Node, IPendingVolume[]>();

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
 * パスが予約済みスロットの配下（または祖先）か。pathDiagnostics が「予約下の読みは
 * 警告しない」ために引く。祖先（`i18n` に対する `i18n.t.title` の `i18n`）も黙る —
 * バインディングは深いパスを張るが、診断は親ごとに走るため。
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

/** マウントパスの静的検査（§4-2: 静的パスのみ）。 */
export function validateVolumeMountPath(mountPath: string): void {
  if (mountPath.length === 0) {
    raiseError(`"mount" requires a non-empty tree path.`);
  }
  const pathInfo = getPathInfo(mountPath);
  for (const segment of pathInfo.segments) {
    if (segment.length === 0) {
      raiseError(`"mount" path "${mountPath}" has an empty segment.`);
    }
    if (segment === WILDCARD) {
      raiseError(`"mount" path "${mountPath}" must be static (wildcards are not allowed).`);
    }
    if (segment.startsWith("$") || segment.startsWith("#") || segment.includes("@")) {
      raiseError(`"mount" path "${mountPath}" must not use reserved characters ($, #, @).`);
    }
  }
}

/** ボリュームの chroot（相対キー → `<mountPath>.<key>` を receiver に翻訳する薄い proxy）。 */
function createVolumeChroot(mountPath: string, receiver: any): Record<string, any> {
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
        // 他の `$` は親の意味論のまま（宣言面は P2-9b）
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

function splitVolumeState(volumeState: Record<string, any>): {
  data: Record<string, unknown>;
  accessors: Map<string, PropertyDescriptor>;
} {
  const data: Record<string, unknown> = {};
  const accessors = new Map<string, PropertyDescriptor>();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(volumeState))) {
    if (key.startsWith("$")) {
      continue; // 宣言面（$connectedCallback は graftVolume が直接読む・他は P2-9b）
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      accessors.set(key, descriptor);
      continue;
    }
    if (typeof descriptor.value === "function") {
      continue; // メソッドのツリー露出は未対応（ヘッダ参照）
    }
    data[key] = descriptor.value;
  }
  return { data, accessors };
}

/**
 * 接ぎ木の本体。ルートの state 要素が使える状態で呼ぶこと。
 * 衝突検査（D3/D22）: マウントパスの位置に既に値があれば throw。
 */
export function graftVolume(
  rootStateElement: IStateElement,
  mountPath: string,
  volumeState: Record<string, any>,
): void {
  const { data, accessors } = splitVolumeState(volumeState);
  const pathInfo = getPathInfo(mountPath);

  rootStateElement.createState("writable", (state) => {
    // 衝突検査（D22: ルートデータとボリューム宣言の両方が揃った時点）。
    // 1 セグメントの proxy 読みは「無いキー」で raise するため in（has トラップ＝
    // 生の Reflect.has）と親値の own キー判定で見る
    if (pathInfo.segments.length === 1) {
      if (mountPath in (state as object)) {
        raiseError(
          `Volume mount "${mountPath}" collides with an existing key on the root tree. ` +
          `Remove the root key or mount the volume elsewhere.`,
        );
      }
    }
    // 深いマウント: 中間の `{}` を作る（`a.b` で `a` が無ければ作る）
    let parent = "";
    for (let i = 0; i < pathInfo.segments.length - 1; i++) {
      const segment = pathInfo.segments[i];
      const exists = parent === ""
        ? (segment in (state as object))
        : typeof (state as Record<string, unknown>)[parent + DELIMITER + segment] !== "undefined";
      parent = parent === "" ? segment : parent + DELIMITER + segment;
      if (!exists) {
        (state as Record<string, unknown>)[parent] = {};
      }
    }
    if (pathInfo.segments.length > 1
      && typeof (state as Record<string, unknown>)[mountPath] !== "undefined") {
      raiseError(
        `Volume mount "${mountPath}" collides with an existing key on the root tree. ` +
        `Remove the root key or mount the volume elsewhere.`,
      );
    }
    // データの接ぎ木 — 通常の書き込みなので通知・依存展開はそのまま走る
    (state as Record<string, unknown>)[mountPath] = data;
  });

  // アクセサをルートの quoted-path アクセサとして登録（`"i18n.t"` — ワイルドカード
  // getter と同じ機構）。`this`（receiver）はアクティブなルート proxy なので、
  // chroot で包んで相対読みをマウント配下へ翻訳する
  for (const [key, descriptor] of accessors) {
    const treePath = mountPath + DELIMITER + key;
    const originalGet = descriptor.get;
    const originalSet = descriptor.set;
    const wrapped: PropertyDescriptor = { enumerable: false, configurable: true };
    if (typeof originalGet === "function") {
      wrapped.get = function (this: unknown) {
        return originalGet.call(createVolumeChroot(mountPath, this));
      };
    }
    if (typeof originalSet === "function") {
      wrapped.set = function (this: unknown, value: unknown) {
        originalSet.call(createVolumeChroot(mountPath, this), value);
      };
    }
    rootStateElement.defineTreeAccessor(treePath, wrapped);
  }

  // $connectedCallback（V7）: chroot で呼ぶ。async でもよい（待たない — ルートの
  // $connectedCallback と同格の「自分のライフサイクル」）
  const connectedCallback = (volumeState as { $connectedCallback?: unknown }).$connectedCallback;
  if (typeof connectedCallback === "function") {
    rootStateElement.createState("writable", (state) => {
      const result = connectedCallback.call(createVolumeChroot(mountPath, state as IStateProxy));
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error(`[@wcstack/state] volume "${mountPath}" $connectedCallback failed.`, error);
        });
      }
    });
  }
}

/**
 * ルートがまだ居なければ保留、居れば即接ぎ木。
 * ルートの名前登録（`default`）が保留分を `drainPendingVolumes` で引き取る。
 */
function graftIsolated(rootStateElement: IStateElement, volume: IPendingVolume): void {
  try {
    graftVolume(rootStateElement, volume.mountPath, volume.volumeState);
  } catch (error) {
    // 接ぎ木の失敗（衝突など）は 1 ボリュームに閉じる。ルートの初期化や他の
    // ボリュームを道連れにしない（connectedCallback 内の throw は promise を
    // 永久未解決にする — §8.2 と同じ構図）
    console.error(`[@wcstack/state] volume "${volume.mountPath}" failed to graft.`, error);
  } finally {
    volume.onGrafted();
  }
}

export function graftOrQueueVolume(
  rootNode: Node,
  rootStateElement: IStateElement | null,
  mountPath: string,
  volumeState: Record<string, any>,
  onGrafted: () => void,
): void {
  if (rootStateElement !== null) {
    graftIsolated(rootStateElement, { mountPath, volumeState, onGrafted });
    return;
  }
  let pending = pendingVolumesByRootNode.get(rootNode);
  if (typeof pending === "undefined") {
    pending = [];
    pendingVolumesByRootNode.set(rootNode, pending);
  }
  pending.push({ mountPath, volumeState, onGrafted });
}

/** ルート登録時に保留中のボリュームを接ぎ木する（stateElementByName から呼ばれる）。 */
export function drainPendingVolumes(rootNode: Node, rootStateElement: IStateElement): void {
  const pending = pendingVolumesByRootNode.get(rootNode);
  if (typeof pending === "undefined" || pending.length === 0) {
    return;
  }
  pendingVolumesByRootNode.delete(rootNode);
  // 登録はルートの _initialize の途中（createState はまだ危うい）— microtask に
  // 遅らせてルートの接続完了後に接ぎ木する
  queueMicrotask(() => {
    for (const volume of pending) {
      graftIsolated(rootStateElement, volume);
    }
  });
}
