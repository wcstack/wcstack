import { getPathInfo } from "../address/PathInfo";
import { IPathInfo } from "../address/types";
import { IStateElement } from "../components/types";
import { DELIMITER, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";

/**
 * webComponent/mount.ts — マウント記録（Phase 2・docs/state-mount-design.md §5、impl-plan §3-0）。
 *
 * v2 の不変条件「マウントされたコンポーネントのバインディングは、その位置にテンプレートを
 * 展開してパスに接頭辞を付けたものと区別できない」を、**バインディングの変換**として実装する。
 * マウントされたスコープのバインディングは登録時にここの `translateInnerPath` で
 * 親ツリーの絶対パスへ書き換えられ、以後は台帳・依存グラフ・キャッシュ・LIS・プールの
 * どれから見ても「親スコープにインラインで書かれた binding」と同一になる。
 *
 * 例外は私有キーと getter / メソッド（展開したテンプレートには存在しないもの）で、
 * これらは **予約セグメント**（D20・`#m<id>` — `#` はパス文法で書けない）を挟んだ
 * 絶対アドレスに載る。ツリーのアドレスと構造的に衝突せず、親 handler のオーバーレイ
 * dispatch はマーカーを含む読み書きだけに掛かる。D10（スコープ外から見えない）は
 * このアドレス空間の帰結になる。
 *
 * マーカーの位置は「ワイルドカード接頭辞の直後」:
 * - 単純な getter / 私有キー（`display` / `editing`）→ `<rootOuter>.#m.display`
 *   （ルートエントリが無い部分マウントのみの形では `#m.display`）
 * - ツリーのリストの上のワイルドカード getter（`get "children.*.label"`、`state: group`）
 *   → `group.children.*.#m.label` — ワイルドカード親がツリーのリストと一致するので、
 *   ループ文脈の解決（indexByWildcardPath）と listIndex の arity が素の getter と同じに保たれる
 * - 私有配列の上のワイルドカード getter（`state = { drafts: [] }` ＋ `get "drafts.*.title"`）
 *   → `<rootOuter>.#m.drafts.*.title` — 配列ごと私有側に閉じる
 */

export interface IMountEntry {
  /** 内側接頭辞のセグメント（ルートエントリは 0 個 — あらゆる内側パスに一致する） */
  readonly innerSegments: readonly string[];
  readonly outerPathInfo: IPathInfo;
}

export interface IMountRecord {
  readonly id: number;
  /** D20 の予約セグメント（`#m<id>`） */
  readonly marker: string;
  readonly component: Element;
  readonly stateProp: string;
  readonly parentStateElement: IStateElement;
  readonly parentStateName: string;
  /** マウント表（内側接頭辞の長い順 — 最長接頭辞一致は先頭ヒットで決まる） */
  readonly entries: readonly IMountEntry[];
  /** ルートエントリ（`state: path`）。無ければ null（部分マウントのみ） */
  readonly rootEntry: IMountEntry | null;
  /** Δ ＝ ルート接頭辞のワイルドカード数（`$n` のスコープ補正が読む唯一の値） */
  readonly delta: number;
  /** 私有キー・単純 getter を載せるマーカーパス（`users.*.#m3` / `#m3`） */
  readonly markerBasePath: string;
  /** 作者の state オブジェクト（私有キー・getter・メソッドの実体） */
  readonly stateObject: Record<string, any>;
  readonly getterKeys: ReadonlySet<string>;
  readonly setterKeys: ReadonlySet<string>;
  /** 部分規則が覆う内側の先頭セグメント（own data key でも私有にしない — D19 と同じ規則） */
  readonly partialFirstSegments: ReadonlySet<string>;
  /**
   * 私有データの初期スナップショット（own data key の浅い複製・D21）。
   * マウントインスタンス（listIndex）ごとの私有オブジェクトはここから複製される。
   */
  readonly privateSnapshot: Readonly<Record<string, unknown>>;
  /**
   * マーカーの親パス（翻訳後） → { 接尾キー → 作者のアクセサ名 }。
   * `display` は markerBase の親に `display → display`、
   * ワイルドカード getter `"children.*.label"` は `group.children.*` に `label → children.*.label`。
   * translateInnerPath のマーカー化で遅延登録され、オーバーレイの get が引く。
   */
  readonly accessorBySuffixByMarkerParent: Map<string, Map<string, string>>;
}

let nextMountId = 0;

/** テスト用: マーカー id を初期化する（マーカー文字列の安定化） */
export function resetMountIdForTesting(): void {
  nextMountId = 0;
}

function collectAccessorKeys(stateObject: Record<string, any>): { getterKeys: Set<string>, setterKeys: Set<string> } {
  const getterKeys = new Set<string>();
  const setterKeys = new Set<string>();
  const descriptors = Object.getOwnPropertyDescriptors(stateObject);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function") getterKeys.add(key);
    if (typeof descriptor.set === "function") setterKeys.add(key);
  }
  return { getterKeys, setterKeys };
}

/**
 * ホストの `state[.sub]: path` バインディング群からマウント記録を組む。
 * `bindings` は propSegments[0] === stateProp で選別済みであること
 * （bindWebComponent が v1 の buildPrimaryMappingRule に渡すものと同じ集合）。
 */
export function buildMountRecord(
  component: Element,
  stateProp: string,
  bindings: readonly IBindingInfo[],
  parentStateElement: IStateElement,
  stateObject: Record<string, any>,
): IMountRecord {
  if (bindings.length === 0) {
    raiseError(`Cannot build a mount record without host bindings for "${stateProp}".`);
  }
  const entries: IMountEntry[] = [];
  const seenInnerPaths = new Set<string>();
  let rootEntry: IMountEntry | null = null;
  for (const binding of bindings) {
    const innerSegments = binding.propSegments.slice(1);
    const innerPath = innerSegments.join(DELIMITER);
    if (seenInnerPaths.has(innerPath)) {
      // 同じ内側パスを 2 つの規則が指す形はどちらが勝つか書き手に見えない（M6・Phase 1 と同じ）
      raiseError('Duplicate mapping rule for web component.');
    }
    seenInnerPaths.add(innerPath);
    const entry: IMountEntry = { innerSegments, outerPathInfo: binding.statePathInfo };
    entries.push(entry);
    if (innerSegments.length === 0) {
      rootEntry = entry;
    }
  }
  entries.sort((a, b) => b.innerSegments.length - a.innerSegments.length);
  const partialFirstSegments = new Set<string>();
  for (const entry of entries) {
    if (entry.innerSegments.length > 0) {
      partialFirstSegments.add(entry.innerSegments[0]);
    }
  }
  const id = ++nextMountId;
  const marker = `#m${id}`;
  const { getterKeys, setterKeys } = collectAccessorKeys(stateObject);
  const privateSnapshot: Record<string, unknown> = {};
  for (const key of Object.keys(stateObject)) {
    if (key.startsWith("$")) continue;
    if (getterKeys.has(key) || setterKeys.has(key)) continue;
    if (typeof stateObject[key] === "function") continue;
    privateSnapshot[key] = stateObject[key];
  }
  return {
    id,
    marker,
    component,
    stateProp,
    parentStateElement,
    parentStateName: parentStateElement.name,
    entries,
    rootEntry,
    delta: rootEntry === null ? 0 : rootEntry.outerPathInfo.wildcardCount,
    markerBasePath: rootEntry === null ? marker : rootEntry.outerPathInfo.path + DELIMITER + marker,
    stateObject,
    getterKeys,
    setterKeys,
    partialFirstSegments,
    privateSnapshot,
    accessorBySuffixByMarkerParent: new Map(),
  };
}

function firstSegmentOf(path: string): string {
  const dot = path.indexOf(DELIMITER);
  return dot === -1 ? path : path.slice(0, dot);
}

function startsWithSegments(segments: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > segments.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (segments[i] !== prefix[i]) return false;
  }
  return true;
}

/** 規則 3: 最長接頭辞一致でツリーの絶対パスへ翻訳する。一致しなければ null。 */
function translateTreePath(record: IMountRecord, segments: readonly string[]): string | null {
  for (const entry of record.entries) {
    if (startsWithSegments(segments, entry.innerSegments)) {
      const rest = segments.slice(entry.innerSegments.length);
      return rest.length === 0
        ? entry.outerPathInfo.path
        : entry.outerPathInfo.path + DELIMITER + rest.join(DELIMITER);
    }
  }
  return null;
}

/** 私有アンカー: パス全体をマーカーの下に置く（`users.*.#m.editing` / `users.*.#m.drafts.*.title`） */
function markerizePrivate(record: IMountRecord, innerPath: string): string {
  return record.markerBasePath + DELIMITER + innerPath;
}

/** アクセサの逆引き（マーカー親 → 接尾キー → 作者のアクセサ名）を登録する */
function recordAccessorSuffix(record: IMountRecord, markerParentPath: string, suffix: string, accessorName: string): void {
  let bySuffix = record.accessorBySuffixByMarkerParent.get(markerParentPath);
  if (typeof bySuffix === "undefined") {
    bySuffix = new Map();
    record.accessorBySuffixByMarkerParent.set(markerParentPath, bySuffix);
  }
  bySuffix.set(suffix, accessorName);
  if (record.getterKeys.has(accessorName)) {
    // マーカーパスを親の getterPaths に載せる。checkDependency（評価中の読み →
    // このアクセサの動的エッジ登録）と isCacheable（getter 値のキャッシュ）が
    // getterPaths を正本にしているため、載せないと再評価もキャッシュも効かない。
    // モック互換のため optional に扱う
    (record.parentStateElement.getterPaths as Set<string> | undefined)?.add(
      markerParentPath + DELIMITER + suffix,
    );
  }
}

/**
 * ワイルドカードを含む getter / setter のマーカー位置決め。ワイルドカード接頭辞が
 * ツリーに翻訳できるなら、その直後にマーカーを挟む（ループ文脈と listIndex の arity を
 * 素の wildcard getter と同一に保つ）。先頭セグメントが私有ならパスごと私有アンカー。
 */
function markerizeAccessorPath(record: IMountRecord, innerPath: string): string {
  const segments = innerPath.split(DELIMITER);
  let lastWildcard = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] === WILDCARD) {
      lastWildcard = i;
      break;
    }
  }
  if (lastWildcard === -1) {
    recordAccessorSuffix(record, record.markerBasePath, innerPath, innerPath);
    return markerizePrivate(record, innerPath);
  }
  const first = segments[0];
  if (isPrivateAnchor(record, first)) {
    recordAccessorSuffix(record, record.markerBasePath, innerPath, innerPath);
    return markerizePrivate(record, innerPath);
  }
  const treeSegments = segments.slice(0, lastWildcard + 1);
  const rest = segments.slice(lastWildcard + 1);
  const translated = translateTreePath(record, treeSegments);
  if (translated === null) {
    // 部分マウントのみで、どの接頭辞にも含まれないツリー部（§4-1 の 4b）
    raiseError(noMountEntryMessage(record, innerPath));
  }
  const markerParent = translated + DELIMITER + record.marker;
  recordAccessorSuffix(record, markerParent, rest.join(DELIMITER), innerPath);
  return rest.length === 0 ? markerParent : markerParent + DELIMITER + rest.join(DELIMITER);
}

/** 先頭セグメントが「作者のもの」（own data key・部分規則が覆わないもの／メソッド）か */
function isPrivateAnchor(record: IMountRecord, firstSegment: string): boolean {
  if (record.partialFirstSegments.has(firstSegment)) {
    return false;
  }
  if (typeof record.stateObject[firstSegment] === "function" && !record.getterKeys.has(firstSegment)) {
    return true;
  }
  return Object.prototype.hasOwnProperty.call(record.stateObject, firstSegment)
    && !record.getterKeys.has(firstSegment)
    && !record.setterKeys.has(firstSegment);
}

function noMountEntryMessage(record: IMountRecord, innerPath: string): string {
  return `Path "${innerPath}" in <${record.component.tagName.toLowerCase()}> does not resolve: ` +
    `it is not an own key of the component state and no mount entry covers it ` +
    `(mounted prefixes: ${record.entries.filter(e => e.innerSegments.length > 0).map(e => e.innerSegments.join(DELIMITER)).join(", ") || "none"}). ` +
    `Mount it from the host ("${record.stateProp}: path" / "${record.stateProp}.${firstSegmentOf(innerPath)}: path") or declare the key on the component state.`;
}

/**
 * コンポーネントスコープの内側パスを、親ツリーの絶対パスへ翻訳する（設計書 §4-1）。
 *
 * 1. getter / setter（完全一致・またはワイルドカード getter）→ マーカーパス（chroot 評価）
 * 2. own data key（部分規則が覆わないもの）・メソッド → マーカーパス（私有）
 * 3. それ以外 → 最長接頭辞一致でツリーへ
 * 4. 一致なし: ルートエントリがあれば必ず 3 で一致する。無ければ throw（4b）
 *
 * `$`（予約名前空間・`$1` 等）と `#`（構造プレースホルダ）で始まるパスは翻訳しない。
 */
const INDEX_PATH_REGEX = /^\$(\d+)$/;

export function translateInnerPath(record: IMountRecord, innerPath: string): string {
  const head = innerPath[0];
  if (head === "$" || head === "#") {
    // `$n` はスコープ相対（D9）。テンプレート側は変換時に Δ を織り込む —
    // 行マウント（Δ=1）の内側 `for` で作者が書く `$1` は、親スコープの
    // 先頭起点では `$2`（設計書 §4-4: `$n → listIndex.at(Δ + n - 1)`）。
    // getter 内の `this.$1` は変換を通らないので、親トラップの Δ 補正が同じ式で扱う。
    if (record.delta > 0) {
      const match = INDEX_PATH_REGEX.exec(innerPath);
      if (match !== null) {
        return `$${Number(match[1]) + record.delta}`;
      }
    }
    return innerPath;
  }
  // 規則 1: 完全一致の getter / setter（`display`・`"children.*.label"`）
  if (record.getterKeys.has(innerPath) || record.setterKeys.has(innerPath)) {
    return markerizeAccessorPath(record, innerPath);
  }
  const first = firstSegmentOf(innerPath);
  // 規則 1'/2: 先頭セグメントが getter / setter / メソッド / own data key → マーカー配下
  if (record.getterKeys.has(first) || record.setterKeys.has(first)) {
    return markerizePrivate(record, innerPath);
  }
  if (isPrivateAnchor(record, first)) {
    return markerizePrivate(record, innerPath);
  }
  // 規則 3: ツリー
  const translated = translateTreePath(record, innerPath.split(DELIMITER));
  if (translated !== null) {
    return translated;
  }
  // 規則 4b: 部分マウントのみで一致なし
  raiseError(noMountEntryMessage(record, innerPath));
}

interface ITranslatable {
  readonly statePathName: string;
  readonly statePathInfo: IPathInfo;
  readonly stateName: string;
}

/**
 * パース結果 / バインディングをマウント先の形へ変換した複製を返す
 * （パース結果キャッシュは触らない）。`$` / `#` パスも stateName だけは親のものに
 * 揃える — 解決サイト（applyChangeFromBindings / getAbsoluteStateAddressByBinding /
 * fragmentInfoByUUID）は (rootNode, stateName) で state element を引くため。
 */
export function translateParsedForMount<T extends ITranslatable>(record: IMountRecord, parsed: T): T {
  const translated = translateInnerPath(record, parsed.statePathName);
  if (translated === parsed.statePathName && parsed.stateName === record.parentStateName) {
    return parsed;
  }
  return {
    ...parsed,
    statePathName: translated,
    statePathInfo: translated === parsed.statePathName ? parsed.statePathInfo : getPathInfo(translated),
    stateName: record.parentStateName,
  };
}

export function translateBindingForMount(record: IMountRecord, binding: IBindingInfo): IBindingInfo {
  return translateParsedForMount(record, binding);
}

// ---------------------------------------------------------------------------
// 登録簿
// ---------------------------------------------------------------------------

/**
 * スコープ根 → マウント記録。キーは Shadow DOM 形ならコンポーネントの shadowRoot、
 * Light DOM 形ならコンポーネント要素自身（そのサブツリーがスコープ）。
 */
const mountRecordByScopeRoot = new WeakMap<Node, IMountRecord>();

/** 親 state element → マーカー → マウント記録（オーバーレイ dispatch と Δ 補正が引く） */
const mountRecordsByStateElement = new WeakMap<IStateElement, Map<string, IMountRecord>>();

export function registerMountRecord(scopeRoot: Node, record: IMountRecord): void {
  mountRecordByScopeRoot.set(scopeRoot, record);
  let byMarker = mountRecordsByStateElement.get(record.parentStateElement);
  if (typeof byMarker === "undefined") {
    byMarker = new Map();
    mountRecordsByStateElement.set(record.parentStateElement, byMarker);
  }
  byMarker.set(record.marker, record);
  // D18: マウントの無い state はオーバーレイ dispatch を boolean 1 個で抜ける
  record.parentStateElement.markHasMounts?.();
}

export function getMountRecordByScopeRoot(scopeRoot: Node): IMountRecord | null {
  return mountRecordByScopeRoot.get(scopeRoot) ?? null;
}

/** 親 state element がマウントを 1 つでも持つか（D18: 無ければ dispatch は分岐 1 つで抜ける） */
export function stateElementHasMounts(stateElement: IStateElement): boolean {
  const byMarker = mountRecordsByStateElement.get(stateElement);
  return typeof byMarker !== "undefined" && byMarker.size > 0;
}

/**
 * パスに含まれるマーカーからマウント記録を引く。`hasMounts` が真のときだけ呼ぶこと。
 * `#` を含まないパス（圧倒的多数）は indexOf 1 回で抜ける。
 */
export function getMountRecordByPath(stateElement: IStateElement, path: string): IMountRecord | null {
  const hashIndex = path.indexOf("#");
  if (hashIndex === -1) {
    return null;
  }
  const byMarker = mountRecordsByStateElement.get(stateElement);
  if (typeof byMarker === "undefined") {
    return null;
  }
  const end = path.indexOf(DELIMITER, hashIndex);
  const marker = end === -1 ? path.slice(hashIndex) : path.slice(hashIndex, end);
  return byMarker.get(marker) ?? null;
}
