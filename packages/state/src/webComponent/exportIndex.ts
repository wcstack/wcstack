import { getPathInfo } from "../address/PathInfo";
import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IListIndex } from "../list/types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { markExportedPath } from "../pathDiagnostics";
import { IExportEntry, IMountRecord, translateInnerPath } from "./mount";

/**
 * webComponent/exportIndex.ts — オーバーレイ getter の公開（docs/state-overlay-export-design.md）。
 *
 * 一文: **ツリーに無いキーの読みは、その位置にマウントされたコンポーネントの getter で
 * 答える。ツリーにあるキーはツリーが勝つ。私有キーとメソッドは見せない。**
 *
 * - 索引（X4）: 親 state element → 公開パスの親 `P`（`users.*`）→ 接尾キー `k`（`display`）
 *   → 記録の集合。引くのは getByAddress / setByAddress の**未存在キー経路**だけで、
 *   ツリーに命中する読み書きは今日の経路をそのまま通る（X1・ホットパス不変）
 * - インスタンス解決（X4）: 候補記録のうち、ホスト要素のループ文脈 listIndex が
 *   読みの listIndex と一致する（か、その配下にいる）ものを選ぶ。0 件は `undefined`、
 *   2 件以上は raise（同一インスタンスに同名 getter を持つコンポーネントが 2 つ —
 *   bind mount の曖昧。設定ミスとして loud）
 * - エイリアス辺（X5）: 登録時に `P.#m<id>.k → P.k` を dynamicDependency に張る。
 *   子 getter の dirty が `P.k` の同 listIndex に流れ、`P.k` を読んだ親 getter /
 *   バインディングへ届く。`P.k` は getterPaths に**載せない**（キャッシュはマーカー側）
 * - 遅延登録・切断（X6）: 登録・再接続・切断で `P.k` へ `$postUpdate` を打つ。親 getter は
 *   子の登録前に評価されるので、初回は途中値 → 収束する（ボリュームの D22 と同じ性質）
 */

/** 索引の要素: 記録（WeakRef — byMarker と同じ寿命規約）とその公開エントリ */
interface IExportHolder {
  readonly ref: WeakRef<IMountRecord>;
  readonly entry: IExportEntry;
}

interface IExportSlot {
  readonly holders: Set<IExportHolder>;
  /** 検証付きキャッシュ（X4）: 読みの listIndex → 前回一致した要素。使う前に一致を再確認する */
  readonly byListIndex: WeakMap<IListIndex, IExportHolder>;
  noIndex: IExportHolder | null;
}

export interface IResolvedExport {
  readonly record: IMountRecord;
  readonly entry: IExportEntry;
}

const exportIndexByStateElement = new WeakMap<IStateElement, Map<string, Map<string, IExportSlot>>>();
const reportedShadows = new Set<string>();

export function clearExportShadowReportsForTesting(): void {
  reportedShadows.clear();
}

/** テスト用: 索引に任意の WeakRef 風オブジェクトを差し込む（GC 済み記録の遅延 prune を検証する） */
export function _setExportRefForTesting(
  stateElement: IStateElement,
  parentPath: string,
  key: string,
  ref: WeakRef<IMountRecord>,
  entry: IExportEntry,
): void {
  slotFor(stateElement, parentPath, key, true)!.holders.add({ ref, entry });
}

function slotFor(stateElement: IStateElement, parentPath: string, key: string, create: boolean): IExportSlot | null {
  let byParent = exportIndexByStateElement.get(stateElement);
  if (typeof byParent === "undefined") {
    if (!create) return null;
    byParent = new Map();
    exportIndexByStateElement.set(stateElement, byParent);
  }
  let byKey = byParent.get(parentPath);
  if (typeof byKey === "undefined") {
    if (!create) return null;
    byKey = new Map();
    byParent.set(parentPath, byKey);
  }
  let slot = byKey.get(key);
  if (typeof slot === "undefined") {
    if (!create) return null;
    slot = { holders: new Set(), byListIndex: new WeakMap(), noIndex: null };
    byKey.set(key, slot);
  }
  return slot;
}

/**
 * 記録の getter / setter を公開索引に載せる（初回登録で 1 回・冪等）。
 * translateInnerPath のマーカー化を通すので accessorBySuffixByMarkerParent も同時に埋まる。
 * 翻訳できないアクセサ（ワイルドカード終端・部分マウントのみで接頭辞不一致）と、
 * `$` 名前空間のアクセサ（翻訳されずマーカーが付かない）は公開しない。
 * ルートエントリの無い部分マウントは公開位置（ツリー上のパス）を持たないので対象外。
 */
export function registerExports(record: IMountRecord): void {
  if (record.exports.size > 0 || record.rootEntry === null) {
    return;
  }
  const keys = new Set<string>([...record.getterKeys, ...record.setterKeys]);
  for (const key of keys) {
    let markerPath: string;
    try {
      markerPath = translateInnerPath(record, key);
    } catch {
      continue;
    }
    const markerIndex = markerPath.indexOf(DELIMITER + record.marker);
    if (markerIndex === -1) {
      continue;
    }
    // `users.*.#m7.display` → 末端マーカーパス `users.*.#m7`・接尾 `display`・公開 `users.*.display`
    // （接尾は常に非空 — markerizeAccessorPath が空を raise 済み。公開パスはルート
    // エントリの外側パス＋接尾なので常に 2 セグメント以上 ＝ 親パスを持つ）
    const markerTerminalPath = markerPath.slice(0, markerIndex + 1 + record.marker.length);
    const suffix = markerPath.slice(markerTerminalPath.length + 1);
    const exportedPath = markerPath.slice(0, markerIndex) + DELIMITER + suffix;
    const exportedInfo = getPathInfo(exportedPath);
    const entry: IExportEntry = { markerTerminalPath, suffix, markerPath, exportedPath };
    record.exports.set(exportedPath, entry);
    slotFor(record.parentStateElement, exportedInfo.parentPath!, exportedInfo.lastSegment, true)!
      .holders.add({ ref: new WeakRef(record), entry });
    // エイリアス辺（X5）: 子 getter のアドレス → 公開パス
    record.parentStateElement.addDynamicDependency(markerPath, exportedPath);
    // 未存在パスの遅延診断（X7）: この公開パスへのバインドは「存在しない」ではない
    markExportedPath(record.parentStateElement, exportedPath);
  }
  record.parentStateElement.markHasMounts?.();
}

/** 読みの listIndex がホスト要素のループ文脈と一致するか（配下の深い文脈も一致とみなす） */
function isInstanceOf(record: IMountRecord, listIndex: IListIndex | null): boolean {
  if (!record.component.isConnected) {
    return false;
  }
  const own = getLoopContextByNode(record.component)?.listIndex ?? null;
  if (listIndex === null) {
    return own === null;
  }
  let current: IListIndex | null = own;
  while (current !== null) {
    if (current === listIndex) {
      return true;
    }
    current = current.parentListIndex;
  }
  return false;
}

/** ホルダーが生きていて、この listIndex のインスタンスなら記録を返す */
function liveInstance(holder: IExportHolder, listIndex: IListIndex | null): IMountRecord | null {
  const record = holder.ref.deref();
  if (typeof record === "undefined" || !isInstanceOf(record, listIndex)) {
    return null;
  }
  return record;
}

/**
 * `P.k`（listIndex）に答える記録を引く。索引に無ければ null（今日どおり undefined 解決）。
 * 複数一致は raise。
 */
export function resolveExport(
  stateElement: IStateElement,
  parentPath: string,
  key: string,
  listIndex: IListIndex | null,
): IResolvedExport | null {
  const slot = slotFor(stateElement, parentPath, key, false);
  if (slot === null) {
    return null;
  }
  const cached = listIndex === null ? slot.noIndex : (slot.byListIndex.get(listIndex) ?? null);
  if (cached !== null) {
    const record = liveInstance(cached, listIndex);
    if (record !== null) {
      return { record, entry: cached.entry };
    }
  }
  let found: IExportHolder | null = null;
  let foundRecord: IMountRecord | null = null;
  for (const holder of slot.holders) {
    const record = holder.ref.deref();
    if (typeof record === "undefined") {
      // 記録は回収済み（finalizer 発火前の窓）— 遅延 prune
      slot.holders.delete(holder);
      continue;
    }
    if (!isInstanceOf(record, listIndex)) {
      continue;
    }
    if (foundRecord !== null) {
      raiseError(
        `[wcs/mount-export-ambiguous] "${parentPath}${DELIMITER}${key}" is exported by two mounted components on the same instance: ` +
        `<${foundRecord.component.tagName.toLowerCase()}> and <${record.component.tagName.toLowerCase()}>. ` +
        `Mount only one of them there, or rename one accessor. See docs/state-overlay-export-design.md X4.`,
      );
    }
    found = holder;
    foundRecord = record;
  }
  if (found === null || foundRecord === null) {
    return null;
  }
  if (listIndex === null) {
    slot.noIndex = found;
  } else {
    slot.byListIndex.set(listIndex, found);
  }
  return { record: foundRecord, entry: found.entry };
}

/** インスタンスの添字で打てる公開パス ＝ マウント接頭辞と同じ階数のもの。ワイルドカード getter の公開（`group.children.*.label`）は行を列挙しないと打てないので依存辺（X5）に任せる */
function instanceLevelExports(record: IMountRecord): IExportEntry[] {
  const result: IExportEntry[] = [];
  for (const entry of record.exports.values()) {
    if (getPathInfo(entry.exportedPath).wildcardCount === record.delta) {
      result.push(entry);
    }
  }
  return result;
}

/** 公開パスの `$postUpdate` を、記録のホスト要素のループ文脈で打つ（X6）。 */
export function notifyExports(record: IMountRecord): void {
  const loopContext = getLoopContextByNode(record.component);
  const parent = record.parentStateElement;
  for (const entry of instanceLevelExports(record)) {
    try {
      parent.createState("readonly", (state) => {
        (state as any)[setLoopContextSymbol](loopContext, () => {
          (state as any).$postUpdate(entry.exportedPath);
        });
      });
    } catch {
      // 行ごと消えた後の切断（listIndex が無い）— 親は `for` の更新で再評価済み
    }
  }
}

/**
 * X1: ツリーに同名キーがある公開 getter は親から読まれない（ツリーが勝つ）。
 * 登録時に 1 回 warn（タグ × 公開パス）。行マウントはホスト要素のループ文脈で読む。
 */
export function warnShadowedExports(record: IMountRecord): void {
  const loopContext = getLoopContextByNode(record.component);
  if (record.delta > 0 && loopContext === null) {
    // 行マウントでループ文脈が無い（行の実体化前）— 読めないので黙る
    return;
  }
  const tag = record.component.tagName.toLowerCase();
  for (const entry of instanceLevelExports(record)) {
    const reportKey = `${tag}|${entry.exportedPath}`;
    if (reportedShadows.has(reportKey)) {
      continue;
    }
    const exportedInfo = getPathInfo(entry.exportedPath);
    let parentValue: unknown = undefined;
    record.parentStateElement.createState("readonly", (state) => {
      (state as any)[setLoopContextSymbol](loopContext, () => {
        parentValue = (state as Record<string, unknown>)[exportedInfo.parentPath!];
      });
    });
    if (typeof parentValue !== "object" || parentValue === null
      || !Object.prototype.hasOwnProperty.call(parentValue, exportedInfo.lastSegment)) {
      continue;
    }
    reportedShadows.add(reportKey);
    console.warn(
      `[@wcstack/state] [wcs/mount-export-shadowed] <${tag}>.${record.stateProp}.${entry.suffix} is exported at ` +
      `"${entry.exportedPath}" but the tree already has that key, so readers outside the component get the tree value. ` +
      `Remove the tree key or rename the accessor. See docs/state-overlay-export-design.md X1.`,
    );
  }
}
