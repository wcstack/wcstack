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
 * ルートより先に接続されてもよい（V5）— ルートの登録（setStateElement の
 * `default`）が保留中のボリュームを引き取る。
 *
 * 宣言面: `$watch` は接頭辞翻訳してルートの watch 台帳へ追記（ハンドラの `this` は
 * chroot・indexes は接頭辞が静的なのでスコープ相対のまま）。`$listKeys` は翻訳して
 * ルートの表へ合流（衝突は設定ミスとして throw）。`$updatedCallback` は自分の接頭辞
 * 配下の更新だけを**相対パス**で受ける（proxy/apis/updatedCallback.ts が配送）。
 * `$disconnectedCallback` はボリューム要素の切断時に chroot で呼ばれる（接ぎ木は残る）。
 *
 * D22 後段: 接ぎ木済みスロットの**親**をルート側から丸ごと書く形は setByAddress が
 * throw する（recordGraftedSlot → findGraftedSlotUnder・ゲートは hasGraftedVolumes）。
 *
 * まだ載せていないもの: `$streams` の接頭辞登録（status 名前空間の設計が別途要る —
 * 宣言は raise）、`$commandTokens` / `$eventTokens` / `$on`（トークンは要素の面 —
 * ルートに宣言する。宣言は warn）、ボリュームのメソッドのツリー露出。
 */

import { getPathInfo } from "../address/PathInfo";
import { IStateElement } from "../components/types";
import { DELIMITER, MODIFIER_READONLY, VOLUME_INJECTION_PROP, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import { IStateProxy } from "../proxy/types";
import { addVolumeUpdatedCallback, createVolumeChroot, drainPendingVolumes, hasReservedVolumeSlots, IPendingVolumeRequest, IVolumeUpdatedCallback, queuePendingVolume, recordGraftedSlot, setVolumeGraftHandler, translateVolumePath } from "./volumeShared";
import type { IMountEntry } from "./mountEntries";
import { normalizeDeclarationAliases } from "../declarationAliases";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { config } from "../config";
import { onStateElementRegistered } from "../stateElementByName";
import { installScopeHooks } from "./addressHooks";
import { installVolumeLifecycle } from "./volumeLifecycle";
import { installBindComponentLifecycle } from "./bindComponentLifecycle";

export { clearFailedRootNode, createVolumeChroot, drainPendingVolumes, failPendingVolumes, getVolumeUpdatedCallbacks, isPathUnderReservedVolume, releaseVolumeSlot, reserveVolumeSlot } from "./volumeShared";
export type { IVolumeUpdatedCallback } from "./volumeShared";
// `watch/*` を静的に import しない（要件 B13）: scopes だけを入れたページに temporal ランタイムが
// 丸ごと乗る。受け口は bridge/featureBridge.ts（temporal の install が置く）
import { IVolumeWatchSupport, requireVolumeWatchSupport } from "../bridge/featureBridge";
import { ListKeySpec } from "../list/listKeys";
import { RECURSION_WILDCARD, STATE_LIST_KEYS_NAME, STATE_RECURSION_NAME, STATE_STREAM_NAME, STATE_RENDERED_CALLBACK_NAME, STATE_WATCH_NAME } from "../define";
import { getAllPropertyDescriptors } from "../getAllPropertyDescriptors";
import type { IWatchEntry } from "../watch/types";



/** ボリューム要素の切断時に $disconnectedCallback を chroot で呼ぶための控え。 */
export interface IVolumeGraftInfo {
  readonly rootStateElement: IStateElement;
  readonly mountPath: string;
  readonly volumeState: Record<string, any>;
  readonly injections: readonly IMountEntry[];
}

/** chroot を作る（$disconnectedCallback など graft 後のライフサイクル呼び出し用）。 */
export function callVolumeLifecycle(info: IVolumeGraftInfo, name: string): void {
  const callback = (info.volumeState as Record<string, unknown>)[name];
  if (typeof callback !== "function") {
    return;
  }
  info.rootStateElement.createState("writable", (state) => {
    const result = (callback as (this: unknown) => unknown).call(createVolumeChroot(info.mountPath, state as IStateProxy, info.injections));
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
    // 位置を問わず拒否（includes）: 中間の `#`（a#b）はマーカー判定
    // （getMountRecordByPath の lastIndexOf("#")）と D22 診断免除に干渉する。
    // `$` / `@` も文言（reserved characters）どおり対称に includes で見る
    if (segment.includes("$") || segment.includes("#") || segment.includes("@")) {
      raiseError(`"mount" path "${mountPath}" must not use reserved characters ($, #, @).`);
    }
  }
}

/**
 * ボリューム要素の注入口（`<wcs-state mount="cart" data-wcs="state.taxRate: settings.taxRate">`、
 * 要件 B14③・3.x 計画 D28〜D32）を読む。左辺は `state.<キー>` の 1 段（キーごとに注入する）、右辺は
 * ルートの静的なパス（ボリュームにはループ文脈が無い）。`#ro` だけを受け、フィルタは受けない。
 * ルートの束縛収集はこの宣言を束縛にしない（getParseBindTextResults）。
 */
export function readVolumeInjections(bindText: string, mountPath: string): IMountEntry[] {
  const entries: IMountEntry[] = [];
  const seen = new Set<string>();
  let parsed: ReturnType<typeof parseBindTextsForElement>;
  try {
    parsed = parseBindTextsForElement(bindText);
  } catch (error) {
    // パーサ自身の診断（`[wcs/binding-syntax]` / `[wcs/recursion-unsupported]` …）には
    // 要素名も `mount=` も載らない。どの要素のどの属性かが分かる形に包み直す（元の文言は残す）
    raiseError(
      `[wcs/mount-path-invalid] <${config.tagNames.state} mount="${mountPath}"> has an invalid ` +
      `${config.bindAttributeName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const result of parsed) {
    if (result.propSegments[0] !== VOLUME_INJECTION_PROP) {
      continue;
    }
    const inner = result.propSegments.slice(1);
    const outer = result.statePathInfo;
    const fail = (reason: string): never => raiseError(
      `[wcs/mount-path-invalid] <${config.tagNames.state} mount="${mountPath}"> "${result.propName}: ${result.statePathName}": ${reason}`,
    );
    if (inner.length !== 1 || !inner[0] || inner[0] === WILDCARD || inner[0][0] === "$" || inner[0][0] === "#") {
      fail(`inject one key at a time ("${VOLUME_INJECTION_PROP}.<key>: path"); change "mount" to move the whole volume.`);
    }
    if (outer.wildcardCount > 0 || outer.path[0] === "$" || outer.path[0] === "#") {
      fail(`the injected path must be a static path on the root tree (a volume has no loop context).`);
    }
    if (result.inFilters.length > 0 || result.outFilters.length > 0) {
      fail(`an injection takes no filters.`);
    }
    if (result.propModifiers.some((modifier) => modifier !== MODIFIER_READONLY)) {
      fail(`an injection accepts only #${MODIFIER_READONLY}.`);
    }
    if (seen.has(inner[0])) {
      fail(`"${inner[0]}" is injected twice.`);
    }
    seen.add(inner[0]);
    entries.push({ innerSegments: inner, outerPathInfo: outer, readonly: result.propModifiers.includes(MODIFIER_READONLY) });
  }
  // findMountEntry の契約（内側接頭辞の長い順）を満たす。D28 の 1 段制限のおかげで今は
  // どれも長さ 1 だが、緩めた瞬間に最長一致が宣言順に依存して壊れる
  entries.sort((a, b) => b.innerSegments.length - a.innerSegments.length);
  return entries;
}

function splitVolumeState(volumeState: Record<string, any>, injectedKeys: ReadonlySet<string>): {
  data: Record<string, unknown>;
  accessors: Map<string, PropertyDescriptor>;
} {
  const data: Record<string, unknown> = {};
  const accessors = new Map<string, PropertyDescriptor>();
  // プロトタイプ鎖込みで見る（`class Cart { get taxRate() {} }`）。own descriptor だけを見ていた頃は、
  // クラスで書いたボリュームの getter が**無言で**接ぎ木されなかった — 同じ関数の `**` getter 検査・
  // D30 の衝突検査・`components/State.ts` の getterPaths 収集はどれも鎖込みで、ここだけが外れていた。
  // `getAllPropertyDescriptors` は `Object.prototype` の手前で打ち切り、同名は手前（インスタンスに
  // 近い側）が勝つので、own data key がプロトタイプの getter を隠す順序も実際の解決と一致する。
  // クラスの `constructor` とプロトタイプメソッドは下の「値が関数」の枝が従来どおり落とす
  for (const [key, descriptor] of Object.entries(getAllPropertyDescriptors(volumeState as object))) {
    if (key.startsWith("$")) {
      continue; // 宣言面（$connectedCallback は graftVolume が直接読む・他は P2-9b）
    }
    if (injectedKeys.has(key)) {
      continue; // 明示した注入が自前のキーに勝つ（B14② と同じ — 3.x 計画 D30）。既定値は接ぎ木しない
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
 * raise しうる宣言面の検査（graftVolume の**冒頭** — データ接ぎ木・スロット記録・
 * アクセサ登録より前）。後ろで検査すると $streams 等の宣言エラーが「データだけ載り
 * アクセサ・宣言面が無い」半端な接ぎ木状態を残し、graftIsolated が握って
 * onGrafted(null) → $disconnectedCallback も呼ばれない形になる。
 */
function validateVolumeDeclarations(
  rootStateElement: IStateElement,
  mountPath: string,
  volumeState: Record<string, any>,
  injections: readonly IMountEntry[],
): void {
  // 注入したキーと同名の getter / setter / メソッドは、どちらが `this.<key>` なのか書き手に見えない。
  // データの既定値だけは注入が黙って勝つ（D30）。
  // descriptor はプロトタイプ鎖込みで見る（`class Cart { get taxRate() {} }` を取りこぼさない —
  // 同じ関数の `**` getter 検査・`components/State.ts` の getterPaths 収集と同じ走査）
  const declaredDescriptors = injections.length === 0 ? null : getAllPropertyDescriptors(volumeState as object);
  for (const entry of injections) {
    const key = entry.innerSegments[0];
    const descriptor = declaredDescriptors![key];
    if (typeof descriptor !== "undefined"
      && (typeof descriptor.get === "function" || typeof descriptor.set === "function" || typeof descriptor.value === "function")) {
      raiseError(
        `[wcs/mount-path-invalid] Volume "${mountPath}" declares "${key}" as an accessor or a method and also injects it ` +
        `("${VOLUME_INJECTION_PROP}.${key}: ${entry.outerPathInfo.path}"). Rename one of them.`,
      );
    }
  }
  const watchDeclared = (volumeState as Record<string, unknown>)[STATE_WATCH_NAME];
  if (typeof watchDeclared !== "undefined") {
    if (typeof watchDeclared !== "object" || watchDeclared === null) {
      raiseError(`${STATE_WATCH_NAME} must be an object mapping state paths to handler functions.`);
    }
    // ボリュームの state は `State._state` セッターを通らない（接ぎ木は loadStateFromSource の
    // 戻り値をそのまま使う）ので、機能の readiness barrier（要件 D13）はここで張る
    const watch = requireVolumeWatchSupport(mountPath);
    for (const [path, handler] of Object.entries(watchDeclared as Record<string, unknown>)) {
      if (typeof handler !== "function") {
        raiseError(`${STATE_WATCH_NAME} entry "${path}" must be a function.`);
      }
      watch.assertValidPath(path);
    }
  }
  const listKeysDeclared = (volumeState as Record<string, unknown>)[STATE_LIST_KEYS_NAME];
  if (typeof listKeysDeclared !== "undefined") {
    if (typeof listKeysDeclared !== "object" || listKeysDeclared === null) {
      raiseError(`${STATE_LIST_KEYS_NAME} must be an object mapping list paths to key specs.`);
    }
    for (const [path, spec] of Object.entries(listKeysDeclared as Record<string, unknown>)) {
      if (path.length === 0 || (typeof spec !== "string" && typeof spec !== "function")) {
        raiseError(`${STATE_LIST_KEYS_NAME} entry "${path}" must map a list path to a field name or a key function.`);
      }
      // 衝突（mergeVolumeListKeys の raise と同義）も接ぎ木前に検出する
      const translated = translateVolumePath(mountPath, injections, path, false);
      if (rootStateElement.listKeys?.has(translated)) {
        raiseError(`${STATE_LIST_KEYS_NAME} entry "${translated}" is declared by both the root and a volume (or two volumes). Keep exactly one.`);
      }
    }
  }
  // $streams は未対応（無言に捨てない）
  if (typeof (volumeState as Record<string, unknown>)[STATE_STREAM_NAME] !== "undefined") {
    raiseError(`Volume "${mountPath}" declares ${STATE_STREAM_NAME}, which volumes do not support yet. Declare the stream on the root state.`);
  }
  // $scan も未対応（docs/state-scan-design.md D8）。from / on はルートのツリーと token を前提にする
  if (typeof (volumeState as Record<string, unknown>)["$scan"] !== "undefined") {
    raiseError(`Volume "${mountPath}" declares $scan, which volumes do not support yet. Declare the scan on the root state.`);
  }
  // $recursion も同じく未対応。宣言だけ受理されたように見えて、どの深さも解決しない
  // 状態を作らない（docs/state-recursive-path-impl-plan.md §7）。
  if (typeof (volumeState as Record<string, unknown>)[STATE_RECURSION_NAME] !== "undefined") {
    raiseError(
      `Volume "${mountPath}" declares ${STATE_RECURSION_NAME}, which volumes do not support yet. ` +
      `Declare the recursion anchor on the root state — the anchor path is resolved against the root tree.`
    );
  }
  // `**` getter は接ぎ木の**途中で**落ちる（アクセサ登録が getPathInfo の不変条件ガードに
  // 当たる）ので、データだけ載ってアクセサが無い半端な状態が残る。接ぎ木の前に弾く。
  for (const key of Object.keys(getAllPropertyDescriptors(volumeState as object))) {
    if (key.indexOf(RECURSION_WILDCARD) !== -1) {
      raiseError(
        `Volume "${mountPath}" declares "${key}", which uses "${RECURSION_WILDCARD}". ` +
        `Volumes do not support recursive getters yet — declare them on the root state.`
      );
    }
  }
}

/**
 * 宣言面の接頭辞登録（$watch / $listKeys / $updatedCallback — ヘッダ参照）。
 * 宣言の形は validateVolumeDeclarations（接ぎ木より前）で検査済み — ここは登録だけ。
 */
function processVolumeDeclarations(
  rootStateElement: IStateElement,
  mountPath: string,
  volumeState: Record<string, any>,
  injections: readonly IMountEntry[],
): void {
  // $watch: 翻訳してルート台帳へ追記。ハンドラは chroot 包装。注入したキーの watch はルートのパスを見る
  const watchDeclared = (volumeState as Record<string, unknown>)[STATE_WATCH_NAME];
  if (typeof watchDeclared !== "undefined") {
    // 受け口の有無は validateVolumeDeclarations が接ぎ木より前に確かめている
    const watch: IVolumeWatchSupport = requireVolumeWatchSupport(mountPath);
    const entries: IWatchEntry[] = [];
    const paths = new Set<string>();
    let order = 0;
    for (const [path, handler] of Object.entries(watchDeclared as Record<string, unknown>)) {
      const translated = translateVolumePath(mountPath, injections, path, false);
      const wrapped = function (this: unknown, cur: unknown, prev: unknown, ...indexes: number[]): void {
        // `this` は writable なルート proxy（watchRuntime の fireOne）— chroot で包む。
        // 接頭辞は静的（ワイルドカード無し）なので indexes はスコープ相対のまま
        (handler as (this: unknown, cur: unknown, prev: unknown, ...indexes: number[]) => void)
          .call(createVolumeChroot(mountPath, this, injections), cur, prev, ...indexes);
      };
      // order はルート宣言（0 起点）の後に来る大きな値 — 同一バッチではルートの
      // watch が先に発火する（宣言順規約のボリューム拡張）
      entries.push({ path: translated, pathInfo: getPathInfo(translated), handler: wrapped, order: 1_000_000 + order++ });
      paths.add(translated);
      rootStateElement.setPathInfo(translated, "prop", "watch");
    }
    if (entries.length > 0) {
      watch.addEntries(rootStateElement, entries);
      rootStateElement.addVolumeWatchPaths?.(paths);
      watch.start(rootStateElement);
    }
  }

  // $listKeys: 翻訳してルートの表へ合流（衝突は validate 済み・merge 側の raise は防御）
  const listKeysDeclared = (volumeState as Record<string, unknown>)[STATE_LIST_KEYS_NAME];
  if (typeof listKeysDeclared !== "undefined") {
    const translatedEntries = new Map<string, ListKeySpec>();
    for (const [path, spec] of Object.entries(listKeysDeclared as Record<string, unknown>)) {
      translatedEntries.set(translateVolumePath(mountPath, injections, path, false), spec as ListKeySpec);
    }
    rootStateElement.mergeVolumeListKeys?.(translatedEntries);
  }

  // $updatedCallback（相対）: 自分の接頭辞配下の更新と、注入したパスの更新（内側の名前で — D33）が
  // 相対パスで届く。収集ゲート（hasUpdatedCallback）を開けるのはここ
  const updated = (volumeState as Record<string, unknown>)[STATE_RENDERED_CALLBACK_NAME];
  if (typeof updated === "function") {
    addVolumeUpdatedCallback(rootStateElement, { mountPath, injections, callback: updated as IVolumeUpdatedCallback["callback"] });
    rootStateElement.enableUpdatedCallback?.();
  }

  // $commandTokens / $eventTokens / $on も未対応（トークンはパスではなく要素の面 —
  // ルートに宣言する）。$errorCallback もルート専用（要件 B11 — 以前は無言で無視していた）。
  // 無言に捨てないが、接ぎ木自体は成立させる（warn 止まり）
  for (const name of ["$commandTokens", "$eventTokens", "$on", "$errorCallback"]) {
    if (typeof (volumeState as Record<string, unknown>)[name] !== "undefined") {
      console.warn(
        `[@wcstack/state] volume "${mountPath}" declares ${name}, which volumes do not support. ` +
        `Declare it on the root state instead.`,
      );
    }
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
  injections: readonly IMountEntry[] = [],
): IVolumeGraftInfo {
  // 宣言キーの旧名を正式名へ（要件 B12 — loadStateFromSource でも済んでいる。冪等）
  normalizeDeclarationAliases(volumeState);
  // raise しうる宣言検査は接ぎ木より前（半端な接ぎ木状態を残さない — ここで
  // 落ちた graft は「何も載っていない」が成立し、graftIsolated の隔離と整合する）
  validateVolumeDeclarations(rootStateElement, mountPath, volumeState, injections);
  const { data, accessors } = splitVolumeState(volumeState, new Set(injections.map((entry) => entry.innerSegments[0])));
  const pathInfo = getPathInfo(mountPath);
  // D14: enable-ssr のスナップショットから初期化されたルートでは、スロットに既に
  // 値があれば**採用**する — モジュールはロード済み（getter / $ 宣言のため）だが、
  // データは接ぎ木せず、衝突検査も掛けない（スロットは宣言済みボリュームの所有）
  const hydrated = rootStateElement.hydratedFromSsr === true;

  rootStateElement.createState("writable", (state) => {
    // 衝突検査（D22: ルートデータとボリューム宣言の両方が揃った時点）。
    // 1 セグメントの proxy 読みは「無いキー」で raise するため in（has トラップ＝
    // 生の Reflect.has）と親値の own キー判定で見る
    if (pathInfo.segments.length === 1) {
      if (mountPath in (state as object)) {
        if (hydrated) {
          return; // 採用（D14）
        }
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
      if (hydrated) {
        return; // 採用（D14）
      }
      raiseError(
        `Volume mount "${mountPath}" collides with an existing key on the root tree. ` +
        `Remove the root key or mount the volume elsewhere.`,
      );
    }
    // データの接ぎ木 — 通常の書き込みなので通知・依存展開はそのまま走る
    (state as Record<string, unknown>)[mountPath] = data;
  });

  // D22 後段: 以後このスロットの**親**の丸ごと書きは setByAddress が throw する
  // （hydrate 採用でもアクセサは登録されるので同様に守る）。ゲートは boolean 1 個（D18）
  recordGraftedSlot(rootStateElement, mountPath);
  rootStateElement.markHasGraftedVolumes?.();

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
        return originalGet.call(createVolumeChroot(mountPath, this, injections));
      };
    }
    if (typeof originalSet === "function") {
      wrapped.set = function (this: unknown, value: unknown) {
        originalSet.call(createVolumeChroot(mountPath, this, injections), value);
      };
    }
    rootStateElement.defineTreeAccessor(treePath, wrapped);
  }

  processVolumeDeclarations(rootStateElement, mountPath, volumeState, injections);

  // $connectedCallback（V7）: chroot で呼ぶ。async でもよい（待たない — ルートの
  // $connectedCallback と同格の「自分のライフサイクル」）
  const connectedCallback = (volumeState as { $connectedCallback?: unknown }).$connectedCallback;
  if (typeof connectedCallback === "function") {
    rootStateElement.createState("writable", (state) => {
      let result: unknown;
      try {
        result = connectedCallback.call(createVolumeChroot(mountPath, state as IStateProxy, injections));
      } catch (error) {
        // 同期の throw も非同期の reject と同じく報告に留める。データ・アクセサ・宣言はもう載っているので、
        // ここから投げると接ぎ木済みのボリュームが「接ぎ木に失敗した」扱いになり、枠まで返してしまう
        // （同じマウントパスで作り直した要素が、残ったデータと衝突する — #265）
        console.error(`[@wcstack/state] volume "${mountPath}" $connectedCallback failed.`, error);
        return;
      }
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error(`[@wcstack/state] volume "${mountPath}" $connectedCallback failed.`, error);
        });
      }
    });
  }
  return { rootStateElement, mountPath, volumeState, injections };
}

/**
 * ルートがまだ居なければ保留、居れば即接ぎ木。
 * ルートの名前登録（`default`）が保留分を `drainPendingVolumes` で引き取る。
 */
function graftIsolated(rootStateElement: IStateElement, volume: IPendingVolumeRequest): void {
  if (!volume.acquireSlot()) {
    // 接ぎ木の直前に枠を取れなかった（#265）— 要素が外れている間に、別のボリュームが同じマウントパスを
    // 取った。報告は acquireSlot が出す。接ぎ木せずに決着させる
    volume.onGrafted(null);
    return;
  }
  let info: IVolumeGraftInfo | null = null;
  try {
    info = graftVolume(rootStateElement, volume.mountPath, volume.volumeState, volume.injections);
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
  acquireSlot: () => boolean,
  injections: readonly IMountEntry[] = [],
): void {
  const request: IPendingVolumeRequest = {
    mountPath,
    volumeState,
    injections,
    onGrafted: onGrafted as IPendingVolumeRequest["onGrafted"],
    acquireSlot,
  };
  if (rootStateElement !== null) {
    graftIsolated(rootStateElement, request);
    return;
  }
  // 最初の接ぎ木要求で graft の実体を確実に注入する（bootstrapState() を経ない経路の保険。冪等）
  installVolumeGraft();
  queuePendingVolume(rootNode, request);
}

// stateElementByName の drainPendingVolumes は import 循環（updater まで届く）を避けて
// 軽量な volumeShared に住む — graft の実体はここで注入する。モジュール評価時には注入せず、
// bootstrapState() が registerComponents() より前に呼ぶ（冪等）ので、ルート登録の前には
// 確実に配線されている。
let volumeGraftInstalled = false;
export function installVolumeGraft(): void {
  if (volumeGraftInstalled) return;
  volumeGraftInstalled = true;
  installScopeHooks();
  installVolumeLifecycle();
  installBindComponentLifecycle();
  setVolumeGraftHandler(graftIsolated);
  onStateElementRegistered(adoptVolumesOnRootRegistered);
}

// ルートの登録: 先に予約されたボリュームがあればスコープ機能の hook を付け、保留中の接ぎ木を引き取る
function adoptVolumesOnRootRegistered(rootNode: Node, element: IStateElement): void {
  if (hasReservedVolumeSlots(rootNode)) {
    element.markHasVolume?.();
  }
  drainPendingVolumes(rootNode, element);
}

