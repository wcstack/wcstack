import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { calcWildcardLen } from "../address/calcWildcardLen";
import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { IPathInfo, IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { config } from "../config";
import { DELIMITER, WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { IListDiff, IListIndex } from "../list/types";
import { listIndexAtWildcard } from "../list/wildcardLevel";
import { getByAddressSymbol } from "../proxy/symbols";
import { IStateProxy } from "../proxy/types";
import { raiseError } from "../raiseError";
import { getTopologicalRanks } from "./topologicalRank";
import { SearchType } from "./types";

const MAX_DEPENDENCY_DEPTH = 1000;

function getIndexes(listDiff: IListDiff, searchType: SearchType): Iterable<IListIndex> {
  switch (searchType) {
    case "old":
      return listDiff.oldIndexes;
    case "new":
      return listDiff.newIndexes;
    case "add":
      return listDiff.addIndexSet;
    case "change":
      return listDiff.changeIndexSet;
    case "delete":
      return listDiff.deleteIndexSet;
    default: 
      if (config.debug) {
        console.log(`Invalid search type: ${searchType}`);
      }
      return [];
  }
}

type ExpandContext = {
  readonly stateElement: IStateElement,
  readonly targetPathInfo: IPathInfo,
  readonly targetListIndexes: IListIndex[],
  readonly wildcardPaths: string[],
  readonly wildcardParentPaths: string[],
  readonly stateProxy: IStateProxy,
  readonly searchType: SearchType
}

function _walkExpandWildcard(
  context: ExpandContext, 
  currentWildcardIndex: number,
  parentListIndex: IListIndex | null
): void {
  const parentPath = context.wildcardParentPaths[currentWildcardIndex];
  const parentPathInfo = getPathInfo(parentPath);
  const parentAbsPathInfo = getAbsolutePathInfo(context.stateElement, parentPathInfo);
  const parentAddress = createStateAddress(parentPathInfo, parentListIndex);
  const parentAbsAddress = createAbsoluteStateAddress(parentAbsPathInfo, parentListIndex);
  const lastValue = getLastListValueByAbsoluteStateAddress(parentAbsAddress);
  const newValue = context.stateProxy[getByAddressSymbol](parentAddress);
  const listDiff = createListDiff(
    parentAddress.listIndex, lastValue, newValue);

  const loopIndexes = getIndexes(listDiff, context.searchType);
  if (currentWildcardIndex === context.wildcardPaths.length - 1) {
    context.targetListIndexes.push(...loopIndexes);
  } else {
    for(const listIndex of loopIndexes) {
      _walkExpandWildcard(
        context,
        currentWildcardIndex + 1,
        listIndex
      );
    }
  }
}

/**
 * 静的子展開（list → list.*）の展開範囲。
 * - "full": 新リストの全行を展開する（従来挙動）。
 * - "diff": 追加行（addIndexSet）と位置が変わった行（changeIndexSet）のみ展開する。
 *   未変更行は値が変わらないため dirty 化・再適用が不要（リスト置換のコストが
 *   既存行数に比例するスケーリング欠陥の解消。docs/list-replacement-dependency-scaling.md）。
 *   削除時の集計 getter は $getAll / $resolve がリスト本体（コンテナ）を読むことで
 *   登録される動的エッジ（list → 集計 getter）が担う。
 */
export type ListExpansion = "full" | "diff";

type Context = {
  readonly stateElement: IStateElement,
  readonly staticMap: Map<string, string[]>,
  readonly dynamicMap: Map<string, string[]>,
  readonly result: Set<IStateAddress>,
  readonly listPathSet: Set<string>,
  readonly visited: Set<IStateAddress>,
  readonly stateProxy: IStateProxy,
  readonly searchType: SearchType,
  readonly listExpansion: ListExpansion,
  /**
   * この書き込みでキー突合による値展開が成立したリストパス（$listKeys）。
   * 変化フィールドは per-path 書き込みで個別に dirty 化済みなので、
   * 「diff に変化が見えない再代入」の全行フォールバックを適用しない
   * （docs/state-list-key-design.md §2.2）。
   */
  readonly keyedMergePath: string | null,
  /** パス → トポロジカル順位。訪問順の決定に使う（topologicalRank.ts 参照） */
  readonly ranks: ReadonlyMap<string, number>,
}

/**
 * 静的子展開の対象 listIndex 群。fullRows は行全体（list.* とその subtree）を展開する。
 * movedRows は「位置だけが変わった行」で、index 以外の入力が不変なため展開を
 * index 依存 getter の subtree（getMovedRowExpansionPaths）に限定できる。
 */
type ExpansionSelection = {
  readonly fullRows: Iterable<IListIndex>,
  readonly movedRows: Iterable<IListIndex> | null,
}

const EMPTY_INDEXES: IListIndex[] = [];

/**
 * 静的子展開で訪問する listIndex 群を選ぶ。"diff" でも次の場合は全行に倒す:
 * - diff に変化が一切見えない再代入（同一参照および内容同一コピーの再代入。
 *   `arr[0].v = 5; s.items = [...arr]` のような in-place 変異後のリフレッシュ
 *   イディオムは diff に映らないため、全行展開で従来挙動を保つ。
 *   削除だけの置換は除く — 残存行に変化は無く、集計はコンテナ動的エッジが担う）
 * - 他行を読む getter が検出されたリスト（隣接項目参照など。未変更行の派生値も変わりうる）
 */
function selectExpansionIndexes(
  context: Context,
  sourcePath: string,
  _lastValue: unknown,
  _newValue: unknown,
  listDiff: IListDiff,
): ExpansionSelection {
  if (context.listExpansion === "full") {
    return { fullRows: listDiff.newIndexes, movedRows: null };
  }
  if (context.stateElement.crossRowListPaths?.has(sourcePath)) {
    return { fullRows: listDiff.newIndexes, movedRows: null };
  }
  if (listDiff.addIndexSet.size === 0 && listDiff.changeIndexSet.size === 0) {
    // 追加も移動も無い。削除も無ければ「変化が見えない再代入」= リフレッシュ意図
    if (listDiff.deleteIndexSet.size === 0) {
      // ただしキー突合による値展開が成立した書き込みでは、変化フィールドは
      // per-path 書き込みで個別に dirty 化済み。全行展開は純粋な無駄になる
      // （無変化ポーリングをゼロコストにする — 設計書 §2.2）。
      if (context.keyedMergePath === sourcePath) {
        return { fullRows: EMPTY_INDEXES, movedRows: null };
      }
      return { fullRows: listDiff.newIndexes, movedRows: null };
    }
    // 削除のみ: 残存行は位置も値も不変なので展開しない
    return { fullRows: EMPTY_INDEXES, movedRows: null };
  }
  return { fullRows: listDiff.addIndexSet, movedRows: listDiff.changeIndexSet };
}

const EMPTY_PATH_INFOS: IPathInfo[] = [];

/**
 * 位置だけが変わった行（movedRows）で展開すべきパス群を求める。
 * `${listPath}.*` 配下にある、$1 等を読んだ実績のある getter
 * （indexDependentGetterPaths）だけを返す。行の同一性・listIndex は保たれ
 * index 以外の入力が不変なので、index を読まない getter / 値パスは再評価不要。
 * 戻り値:
 * - IPathInfo[]（空可）: この各パスだけを行の listIndex で展開する
 * - null: ネストしたワイルドカード配下に index 依存 getter がある
 *   （listIndex の階数が合わず個別展開できない）→ 呼び出し側で行全体展開に倒す
 *
 * 配下判定は staticMap の subtree 走査ではなく indexDependentGetterPaths 側の
 * プレフィックス照合で行う。静的依存グラフは `State.setPathInfo` が
 * 「バインドされたパスから親方向へ」張るため、DOM にバインドされていない中間
 * getter（`.label` だけを描画し `.rank` は `.label` からしか読まれない綴り）は
 * subtree に現れない。そこを走査すると index 依存 getter を取りこぼし、
 * 「index を読む getter が subtree に無い＝位置のみ変わった行の値は不変」という
 * 呼び出し側の判断が偽になって、移動行の getter が古い値のまま残る。
 * この集合は $1 を読んだ getter の数しか持たないので、走査コストも subtree より小さい。
 */
function getMovedRowExpansionPaths(
  context: Context,
  wildcardPath: string,
  depPathInfo: IPathInfo,
): IPathInfo[] | null {
  const indexGetters = context.stateElement.indexDependentGetterPaths;
  if (!indexGetters || indexGetters.size === 0) {
    return EMPTY_PATH_INFOS;
  }
  let result: IPathInfo[] | null = null;
  const prefix = wildcardPath + DELIMITER;
  for (const path of indexGetters) {
    if (path !== wildcardPath && !path.startsWith(prefix)) {
      continue;
    }
    const pathInfo = getPathInfo(path);
    if (pathInfo.wildcardCount !== depPathInfo.wildcardCount) {
      return null;
    }
    (result ??= []).push(pathInfo);
  }
  return result ?? EMPTY_PATH_INFOS;
}

function _walkDependency(
  context: Context,
  startAddress: IStateAddress,
  callback: (address: IStateAddress) => void
): void {
  // rank ごとのバケットで訪問する。辺 (u → v) では必ず rank(u) < rank(v) なので、
  // バケット r を処理する時点で rank < r のパスは全て dirty 化済みになる
  // ＝ ここでリスト実体を読んでも入力が揃っている（topologicalRank.ts 参照）。
  const buckets: (IStateAddress[] | undefined)[] = [];
  const ranks = context.ranks;

  const enqueue = (address: IStateAddress, minRank: number): void => {
    let rank = ranks.get(address.pathInfo.path) ?? minRank;
    if (rank < minRank) {
      // 循環など rank が先行関係を表せないケース。現在のバケットに載せて
      // 同一ループ内で処理する（打ち切りは visited が担う）。
      rank = minRank;
    }
    (buckets[rank] ??= []).push(address);
  };

  enqueue(startAddress, 0);

  // 依存アドレスを収集するための一時バッファ（アドレスごとに使い回す）
  const nextEntries: IStateAddress[] = [];

  for (let rank = 0; rank < buckets.length; rank++) {
    const bucket = buckets[rank];
    if (bucket === undefined) {
      continue;
    }
    // 同一バケットへの push（循環時）で伸びるため length は都度読む
    for (let cursor = 0; cursor < bucket.length; cursor++) {
      const address = bucket[cursor];
      if (context.visited.has(address)) {
        continue;
      }
      context.visited.add(address);
      callback(address);
      nextEntries.length = 0;
      _collectDependencies(context, address, nextEntries);
      for (let i = 0; i < nextEntries.length; i++) {
        enqueue(nextEntries[i], rank + 1);
      }
    }
  }
}

/**
 * address の依存アドレスを nextEntries に集め、context.result にも登録する。
 * リスト展開（list → list.*）と動的依存のワイルドカード展開はここで値を読むが、
 * 呼び出し元がトポロジカル順を保証しているため入力は揃っている。
 */
function _collectDependencies(
  context: Context,
  address: IStateAddress,
  nextEntries: IStateAddress[],
): void {
  const sourcePath = address.pathInfo.path;

  /**
   * パスから依存関係をたどる
   * users.*.name <= users.* <= users
   * ただし、users がリストであれば users.* の依存関係は展開する
   */
  const staticDeps = context.staticMap.get(sourcePath);
  if (staticDeps) {
    for(const dep of staticDeps) {
      const depPathInfo = getPathInfo(dep);
      if (context.listPathSet.has(sourcePath) && depPathInfo.lastSegment === WILDCARD) {
        //expand indexes
        const newValue = context.stateProxy[getByAddressSymbol](address);
        const absPathInfo = getAbsolutePathInfo(context.stateElement, address.pathInfo);
        const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
        const lastValue = getLastListValueByAbsoluteStateAddress(absAddress);
        const listDiff = createListDiff(
          address.listIndex, lastValue, newValue);
        const selection = selectExpansionIndexes(context, sourcePath, lastValue, newValue, listDiff);
        for(const listIndex of selection.fullRows) {
          const depAddress = createStateAddress(depPathInfo, listIndex);
          context.result.add(depAddress);
          nextEntries.push(depAddress);
        }
        if (selection.movedRows !== null) {
          const movedPathInfos = getMovedRowExpansionPaths(context, dep, depPathInfo);
          if (movedPathInfos === null) {
            // ネスト配下に index 依存 getter: 安全側で行全体を展開（従来挙動）
            for(const listIndex of selection.movedRows) {
              const depAddress = createStateAddress(depPathInfo, listIndex);
              context.result.add(depAddress);
              nextEntries.push(depAddress);
            }
          } else if (movedPathInfos.length > 0) {
            // 位置のみ変わった行は index 依存 getter のパスだけを展開する
            for(const listIndex of selection.movedRows) {
              for(const pathInfo of movedPathInfos) {
                const depAddress = createStateAddress(pathInfo, listIndex);
                context.result.add(depAddress);
                nextEntries.push(depAddress);
              }
            }
          }
          // movedPathInfos が空: index を読む getter が subtree に無い =
          // 位置のみ変わった行の値は不変。展開・dirty 化とも不要。
        }
      } else {
        const depAddress = createStateAddress(depPathInfo, address.listIndex);
        context.result.add(depAddress);
        nextEntries.push(depAddress);
      }
    }
  }
  /**
   * 動的依存関係をたどる
   * 動的依存関係は、getterの実行時に決定される
   *
   * source,           target
   *
   * products.*.price => products.*.tax
   * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
   *
   * products.*.price => products.summary
   * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
   *
   * categories.*.name => categories.*.products.*.categoryName
   * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
   */
  const dynamicDeps = context.dynamicMap.get(sourcePath);
  if (dynamicDeps) {
    for(const dep of dynamicDeps) {
      const depPathInfo = getPathInfo(dep);
      const listIndexes: (IListIndex | null)[] = [];
      if (depPathInfo.wildcardCount > 0) {
        // ワイルドカードを含む依存関係の処理
        // 同じ親を持つかをパスの集合積で判定する
        // polyfills.tsにてSetのintersectionメソッドを定義している
        const wildcardLen = calcWildcardLen(address.pathInfo, depPathInfo);
        const expandable = (depPathInfo.wildcardCount - wildcardLen) >= 1;
        if (expandable) {
          let listIndex: IListIndex | null;
          if (wildcardLen > 0) {
            // categories.*.name => categories.*.products.*.categoryName
            // ワイルドカードを含む同じ親（products.*）を持つのが、
            // さらに下位にワイルドカードがあるので展開する
            if (address.listIndex === null) {
              raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
            }
            listIndex = listIndexAtWildcard(address.listIndex!, wildcardLen - 1, address.pathInfo.wildcardCount);
          } else {
            // selectedIndex => items.*.selected
            // 同じ親を持たない場合はnullから開始
            listIndex = null;
          }
          const expandContext: ExpandContext = {
            stateElement: context.stateElement,
            targetPathInfo: depPathInfo,
            targetListIndexes: [],
            wildcardPaths: depPathInfo.wildcardPaths,
            wildcardParentPaths: depPathInfo.wildcardParentPaths,
            stateProxy: context.stateProxy,
            searchType: context.searchType,
          };
          _walkExpandWildcard(expandContext, wildcardLen, listIndex);
          listIndexes.push(...expandContext.targetListIndexes);
        } else {
          // products.*.price => products.*.tax
          // ワイルドカードを含む同じ親（products.*）を持つので、リストインデックスは引き継ぐ
          if (address.listIndex === null) {
            raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
          }
          const listIndex = listIndexAtWildcard(address.listIndex, wildcardLen - 1, address.pathInfo.wildcardCount);
          listIndexes.push(listIndex);
        }
      } else {
        // products.*.tax => currentTaxRate
        // 同じ親を持たないので、リストインデックスはnull
        listIndexes.push(null);
      }
      for(const listIndex of listIndexes) {
        const depAddress = createStateAddress(depPathInfo, listIndex);
        context.result.add(depAddress);
        nextEntries.push(depAddress);
      }
    }
  }
}

export function walkDependency(
  stateElement: IStateElement,
  startAddress: IStateAddress,
  staticDependency: Map<string, string[]>,
  dynamicDependency: Map<string, string[]>,
  listPathSet: Set<string>,
  stateProxy: IStateProxy,
  searchType: SearchType,
  callback: (address: IStateAddress) => void,
  options?: { listExpansion?: ListExpansion, keyedMergePath?: string | null }
): IStateAddress[] {
  // 依存ゼロの葉パス（staticMap / dynamicMap にエントリ無し）は context や Set を
  // 割り当てず、開始アドレスの callback だけで完結する。リスト行の値書き込み
  // （update ホットパス）は set 毎にここを通る。開始アドレスへの callback は
  // 従来の walk 先頭と同一で、戻り値（依存アドレス群）も従来どおり空。
  const startPath = startAddress.pathInfo.path;
  if (!staticDependency.has(startPath) && !dynamicDependency.has(startPath)) {
    callback(startAddress);
    return [];
  }
  // パス単位のトポロジカル順位。値を一切読まずに求まり、依存グラフは追記のみで
  // 成長するため epoch でメモ化される（topologicalRank.ts）。
  const ranks = getTopologicalRanks(startPath, staticDependency, dynamicDependency, MAX_DEPENDENCY_DEPTH);
  const context: Context = {
    ranks: ranks,
    stateElement: stateElement,
    staticMap: staticDependency,
    dynamicMap: dynamicDependency,
    result: new Set<IStateAddress>(),
    listPathSet: listPathSet,
    visited: new Set<IStateAddress>(),
    stateProxy: stateProxy,
    searchType: searchType,
    listExpansion: options?.listExpansion ?? "full",
    keyedMergePath: options?.keyedMergePath ?? null,
  };
  _walkDependency(context, startAddress, callback);
  return Array.from(context.result);
}
