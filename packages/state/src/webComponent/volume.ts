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
 * 宣言面: `$watch` は接頭辞翻訳してルートの watch 台帳へ追記（ハンドラの `this` は
 * chroot・indexes は接頭辞が静的なのでスコープ相対のまま）。`$listKeys` は翻訳して
 * ルートの表へ合流（衝突は設定ミスとして throw）。`$updatedCallback` は自分の接頭辞
 * 配下の更新だけを**相対パス**で受ける（proxy/apis/updatedCallback.ts が配送）。
 * `$disconnectedCallback` はボリューム要素の切断時に chroot で呼ばれる（接ぎ木は残る）。
 *
 * まだ載せていないもの: `$streams` の接頭辞登録（status 名前空間の設計が別途要る）、
 * ボリュームのメソッドのツリー露出、深いマウントの親を丸ごと書く形の throw（D22 後段）。
 */

import { getPathInfo } from "../address/PathInfo";
import { IStateElement } from "../components/types";
import { DELIMITER, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import { IStateProxy } from "../proxy/types";
import { addVolumeUpdatedCallback, createVolumeChroot, IPendingVolumeRequest, IVolumeUpdatedCallback, queuePendingVolume, setVolumeGraftHandler } from "./volumeShared";

export { createVolumeChroot, drainPendingVolumes, getVolumeUpdatedCallbacks, isPathUnderReservedVolume, reserveVolumeSlot } from "./volumeShared";
export type { IVolumeUpdatedCallback } from "./volumeShared";
import { assertValidWatchPath } from "../watch/processWatchDeclaration";
import { addVolumeWatchEntries } from "../watch/watchRegistry";
import { startWatch } from "../watch/watchRuntime";
import { ListKeySpec } from "../list/listKeys";
import { STATE_LIST_KEYS_NAME, STATE_UPDATED_CALLBACK_NAME, STATE_WATCH_NAME } from "../define";
import type { IWatchEntry } from "../watch/types";



/** ボリューム要素の切断時に $disconnectedCallback を chroot で呼ぶための控え。 */
export interface IVolumeGraftInfo {
  readonly rootStateElement: IStateElement;
  readonly mountPath: string;
  readonly volumeState: Record<string, any>;
}

/** chroot を作る（$disconnectedCallback など graft 後のライフサイクル呼び出し用）。 */
export function callVolumeLifecycle(info: IVolumeGraftInfo, name: string): void {
  const callback = (info.volumeState as Record<string, unknown>)[name];
  if (typeof callback !== "function") {
    return;
  }
  info.rootStateElement.createState("writable", (state) => {
    const result = (callback as (this: unknown) => unknown).call(createVolumeChroot(info.mountPath, state as IStateProxy));
    if (result instanceof Promise) {
      result.catch((error) => {
        console.error(`[@wcstack/state] volume "${info.mountPath}" ${name} failed.`, error);
      });
    }
  });
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
 * 宣言面の接頭辞登録（$watch / $listKeys / $updatedCallback — ヘッダ参照）。
 * $streams は未対応（status 名前空間の設計が別途要る — 宣言があれば loud に落とす）。
 */
function processVolumeDeclarations(
  rootStateElement: IStateElement,
  mountPath: string,
  volumeState: Record<string, any>,
): void {
  // $watch: 相対パスを検証 → 翻訳してルート台帳へ追記。ハンドラは chroot 包装。
  const watchDeclared = (volumeState as Record<string, unknown>)[STATE_WATCH_NAME];
  if (typeof watchDeclared !== "undefined") {
    if (typeof watchDeclared !== "object" || watchDeclared === null) {
      raiseError(`${STATE_WATCH_NAME} must be an object mapping state paths to handler functions.`);
    }
    const entries: IWatchEntry[] = [];
    const paths = new Set<string>();
    let order = 0;
    for (const [path, handler] of Object.entries(watchDeclared as Record<string, unknown>)) {
      if (typeof handler !== "function") {
        raiseError(`${STATE_WATCH_NAME} entry "${path}" must be a function.`);
      }
      assertValidWatchPath(path);
      const translated = mountPath + DELIMITER + path;
      const wrapped = function (this: unknown, cur: unknown, prev: unknown, ...indexes: number[]): void {
        // `this` は writable なルート proxy（watchRuntime の fireOne）— chroot で包む。
        // 接頭辞は静的（ワイルドカード無し）なので indexes はスコープ相対のまま
        (handler as (this: unknown, cur: unknown, prev: unknown, ...indexes: number[]) => void)
          .call(createVolumeChroot(mountPath, this), cur, prev, ...indexes);
      };
      // order はルート宣言（0 起点）の後に来る大きな値 — 同一バッチではルートの
      // watch が先に発火する（宣言順規約のボリューム拡張）
      entries.push({ path: translated, pathInfo: getPathInfo(translated), handler: wrapped, order: 1_000_000 + order++ });
      paths.add(translated);
      rootStateElement.setPathInfo(translated, "prop", "watch");
    }
    if (entries.length > 0) {
      addVolumeWatchEntries(rootStateElement, entries);
      rootStateElement.addVolumeWatchPaths?.(paths);
      startWatch(rootStateElement);
    }
  }

  // $listKeys: 翻訳してルートの表へ合流（衝突は raise — キー突合の二重定義は曖昧）
  const listKeysDeclared = (volumeState as Record<string, unknown>)[STATE_LIST_KEYS_NAME];
  if (typeof listKeysDeclared !== "undefined") {
    if (typeof listKeysDeclared !== "object" || listKeysDeclared === null) {
      raiseError(`${STATE_LIST_KEYS_NAME} must be an object mapping list paths to key specs.`);
    }
    const translatedEntries = new Map<string, ListKeySpec>();
    for (const [path, spec] of Object.entries(listKeysDeclared as Record<string, unknown>)) {
      if (path.length === 0 || (typeof spec !== "string" && typeof spec !== "function")) {
        raiseError(`${STATE_LIST_KEYS_NAME} entry "${path}" must map a list path to a field name or a key function.`);
      }
      translatedEntries.set(mountPath + DELIMITER + path, spec as ListKeySpec);
    }
    rootStateElement.mergeVolumeListKeys?.(translatedEntries);
  }

  // $updatedCallback（相対）: 自分の接頭辞配下の更新だけが相対パスで届く。
  // 収集ゲート（hasUpdatedCallback）を開けるのはここ
  const updated = (volumeState as Record<string, unknown>)[STATE_UPDATED_CALLBACK_NAME];
  if (typeof updated === "function") {
    addVolumeUpdatedCallback(rootStateElement, { mountPath, callback: updated as IVolumeUpdatedCallback["callback"] });
    rootStateElement.enableUpdatedCallback?.();
  }

  // $streams は未対応（無言に捨てない）
  if (typeof (volumeState as Record<string, unknown>)["$streams"] !== "undefined") {
    raiseError(`Volume "${mountPath}" declares $streams, which volumes do not support yet. Declare the stream on the root state.`);
  }
}

/**
 * 接ぎ木の本体。ルートの state 要素が使える状態で呼ぶこと。
 * 衝突検査（D3/D22）: マウントパスの位置に既に値があれば throw。
 */
export function graftVolume(
  rootStateElement: IStateElement,
  mountPath: string,
  volumeState: Record<string, any>,
): IVolumeGraftInfo {
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

  processVolumeDeclarations(rootStateElement, mountPath, volumeState);

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
  return { rootStateElement, mountPath, volumeState };
}

/**
 * ルートがまだ居なければ保留、居れば即接ぎ木。
 * ルートの名前登録（`default`）が保留分を `drainPendingVolumes` で引き取る。
 */
function graftIsolated(rootStateElement: IStateElement, volume: IPendingVolumeRequest): void {
  let info: IVolumeGraftInfo | null = null;
  try {
    info = graftVolume(rootStateElement, volume.mountPath, volume.volumeState);
  } catch (error) {
    // 接ぎ木の失敗（衝突など）は 1 ボリュームに閉じる。ルートの初期化や他の
    // ボリュームを道連れにしない（connectedCallback 内の throw は promise を
    // 永久未解決にする — §8.2 と同じ構図）
    console.error(`[@wcstack/state] volume "${volume.mountPath}" failed to graft.`, error);
  } finally {
    volume.onGrafted(info);
  }
}

export function graftOrQueueVolume(
  rootNode: Node,
  rootStateElement: IStateElement | null,
  mountPath: string,
  volumeState: Record<string, any>,
  onGrafted: (info: IVolumeGraftInfo | null) => void,
): void {
  if (rootStateElement !== null) {
    graftIsolated(rootStateElement, { mountPath, volumeState, onGrafted: onGrafted as IPendingVolumeRequest["onGrafted"] });
    return;
  }
  queuePendingVolume(rootNode, { mountPath, volumeState, onGrafted: onGrafted as IPendingVolumeRequest["onGrafted"] });
}

// stateElementByName の drainPendingVolumes は import 循環（updater まで届く）を避けて
// 軽量な volumeShared に住む — graft の実体はここで注入する（State.ts が本モジュールを
// 必ず import するため、ルート登録の前には確実に配線されている）
setVolumeGraftHandler(graftIsolated);

