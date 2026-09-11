/**
 * recursion/walk.ts
 *
 * 再帰アンカー配下を**全深さ**にわたって走査し、マッチする具体アドレスを列挙する。
 * `$getAll(path, [])` の合併形（設計書 §6-2）と `$setAll` のブロードキャストが共有する。
 *
 * 固定 arity の走査（`proxy/apis/wildcardIndexes.ts`）は「ワイルドカードの本数が
 * 静的に決まっている」ことに立脚しているので、そのままでは深さが動的な族を扱えない。
 * ここは深さ方向だけを自前で降り、**各深さの具体パスは固定 arity のまま**扱う
 * — つまりエンジンが見るパスは常に `**` を含まない普通のパスである（設計書 D2）。
 *
 * 順序は**深さ優先・行きがけ・添字昇順**（§1-2）。ノードを 1 つ出したら、その子へ
 * 降りきってから次の兄弟へ移る。読みと書きが同じ順序を使うことが `$setAll` の
 * 契約の前提になる。
 *
 * 走査が throw したとき、その走査が観測したリスト値は差分基準へ確定**しない**
 * （途中まで進めた基準を残すと、次の読みが「変化なし」と誤認しうる）。
 */

import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { IAbsoluteStateAddress, IPathInfo, IStateAddress } from "../address/types";
import { DELIMITER } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getStateListBaseline, setStateListBaseline } from "../list/stateListBaseline";
import { IListIndex } from "../list/types";
import { getByAddress } from "../proxy/methods/getByAddress";
import { IStateHandler } from "../proxy/types";
import { raiseError } from "../raiseError";
import { concretePathAt, nodePathAt } from "./expand";
import { IRecursionSpec } from "./types";

/** 深さごとに 1 回だけ決まるもの。ノードごとに作り直さない。 */
interface IDepthPaths {
  readonly nodePath: string;
  readonly concretePathInfo: IPathInfo;
  readonly childListPathInfo: IPathInfo;
}

/**
 * アンカー配下の全深さを列挙する。深さ優先・行きがけ・添字昇順。
 *
 * 終端は「その深さの子リストが空」。上限超過は `concretePathAt` が**その深さに実際に
 * ノードが居るときだけ**検査する（葉の 1 段先を投機的に見て落ちないように）。
 */
export function collectRecursiveAddresses(
  target: object,
  receiver: any,
  handler: IStateHandler,
  spec: IRecursionSpec,
  suffix: string,
): IStateAddress[] {
  const results: IStateAddress[] = [];
  const observed: Map<IAbsoluteStateAddress, readonly unknown[]> = new Map();
  const pathsByDepth: IDepthPaths[] = [];
  const repeatList = spec.repeat.slice(0, spec.repeat.lastIndexOf(DELIMITER));
  const anchorList = spec.anchor.slice(0, spec.anchor.lastIndexOf(DELIMITER));

  /**
   * 「同じ配列インスタンスが 2 つ以上の親から到達可能」を**走査そのもの**で判定する
   * （設計書 D12・E6）。台帳の親（`newIndexes[0].parentListIndex`）で見てはならない
   * — 台帳はリスト配列の identity だけをキーにしていて、行オブジェクトを作り直す
   * ふつうのイミュータブル更新（`nodes.map(n => ({...n}))` は children を参照ごと
   * 引き継ぐ）でも親 ListIndex が別物になるため、正当な木を恒久的に拒否してしまう。
   *
   * 走査で見た配列を覚えておけば、共有も循環も「同じ配列に 2 度到達したか」で決まる。
   * 祖先の集合に居れば循環（自分より上へ戻る）、そうでなければ兄弟共有。
   * 空配列は行を持たないので別名化のしようがなく、追跡しない（`[]` の使い回しは正当）。
   */
  const ancestors: Set<readonly unknown[]> = new Set();
  const visited: Set<readonly unknown[]> = new Set();

  const guardShape = (
    listPath: string,
    value: unknown,
    seen: Set<readonly unknown[]>,
  ): readonly unknown[] | null => {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }
    const list = value as readonly unknown[];
    if (ancestors.has(list)) {
      raiseError(
        `[wcs/recursion-cycle] "${listPath}" is reachable from itself: the recursion on ` +
        `"${spec.anchor}" walked into a list that one of its own ancestors already owns. ` +
        `The data contains a cycle, which this version does not support.`
      );
    }
    if (seen.has(list)) {
      raiseError(
        `[wcs/recursion-shared-list] "${listPath}" is the same array instance as a list reached ` +
        `from another node. The recursion on "${spec.anchor}" needs a tree: give each node its own ` +
        `"${repeatList}" array.`
      );
    }
    return list;
  };

  const pathsAt = (depth: number): IDepthPaths => {
    const known = pathsByDepth[depth];
    if (typeof known !== "undefined") {
      return known;
    }
    // 上限検査はここ（＝その深さに実際にノードが居ると分かってから）。
    const concretePath = concretePathAt(spec, suffix, depth);
    const nodePath = suffix.length === 0 ? concretePath : nodePathAt(spec, depth);
    const paths: IDepthPaths = {
      nodePath,
      concretePathInfo: getPathInfo(concretePath),
      childListPathInfo: getPathInfo(nodePath + DELIMITER + repeatList),
    };
    pathsByDepth[depth] = paths;
    return paths;
  };

  /** 接尾辞側に残ったワイルドカード段だけを、行の ListIndex を起点に展開する。 */
  const expandSuffix = (concretePathInfo: IPathInfo, level: number, listIndex: IListIndex): void => {
    const parents = concretePathInfo.wildcardParentPathInfos;
    if (level >= parents.length) {
      results.push(createStateAddress(concretePathInfo, listIndex));
      return;
    }
    // 接尾辞側のリストは検査しない。接尾辞が反復語を含む形（`nodes.**.children.*.value`）
    // では、接尾辞の展開と深さ方向の降下が**同じ配列**を通る — 同じ族を 2 通りに綴れる
    // ことの帰結で、共有ではない。次元をまたいでも、同じ次元の中でも（深さ 0 の接尾辞
    // 展開と深さ 1 の接尾辞展開が同じ配列に当たる）自己衝突するので、共有の判定は
    // 深さ方向にだけ掛ける。
    //
    // 結果として `$setAll("nodes.**.tags", [], arr)` のように**ブロードキャストが作った**
    // 配列共有は、ここでは捕まらない（`[wcs/wildcard-rank]` という無関係な文面で落ちる）。
    // 既知の制限として設計書に記録してある。
    const rows = readRows(parents[level], listIndex, null).rows;
    for (let i = 0; i < rows.length; i++) {
      expandSuffix(concretePathInfo, level + 1, rows[i]);
    }
  };

  /**
   * リストを 1 本読んで行と、追跡対象のリスト配列を返す。差分基準は state 側の
   * 共有正本（E1）から取り、観測値は走査の最後にまとめて確定する。`guardPath` が
   * 非 null のときだけ共有・循環の検査を掛ける（接尾辞側の普通のリストは再帰の
   * 対象ではない）。
   */
  function readRows(
    listPathInfo: IPathInfo,
    parentListIndex: IListIndex | null,
    seen: Set<readonly unknown[]> | null,
  ): { rows: IListIndex[], tracked: readonly unknown[] | null } {
    const listAddress = createStateAddress(listPathInfo, parentListIndex);
    const absAddress = createAbsoluteStateAddress(
      getAbsolutePathInfo(handler.stateElement, listPathInfo), parentListIndex);
    const value = getByAddress(target, listAddress, receiver, handler);
    const tracked = seen === null ? null : guardShape(listPathInfo.path, value, seen);
    const listDiff = createListDiff(
      parentListIndex, getStateListBaseline(absAddress), value);
    observed.set(absAddress, Array.isArray(value) ? value : []);
    if (tracked !== null && seen !== null) {
      seen.add(tracked);
    }
    return { rows: listDiff.newIndexes, tracked };
  }

  const descend = (depth: number, listPathInfo: IPathInfo, parentListIndex: IListIndex | null): void => {
    const { rows, tracked } = readRows(listPathInfo, parentListIndex, visited);
    if (rows.length === 0) {
      return;
    }
    const paths = pathsAt(depth);
    // 行が 1 つでもある ⟹ そのリストは非空配列だった ⟹ guardShape が追跡対象を返している
    // （非配列も空配列も createListDiff が空の行に畳むので、上の早期 return で抜ける）。
    // このリストは、いま降りている枝の祖先になる。子で同じ配列に当たれば循環。
    const branch = tracked as readonly unknown[];
    ancestors.add(branch);
    const flat = paths.concretePathInfo.wildcardCount === depth + 1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (flat) {
        // 接尾辞にワイルドカードが無い（大多数）。行の ListIndex がそのまま具体パスの
        // 連鎖長を満たすので、追加の走査は要らない。この行 ListIndex は createListDiff が
        // 台帳へ登録した正本そのものなので、`getListIndexByIndexes` で引き直す必要も無い。
        results.push(createStateAddress(paths.concretePathInfo, row));
      } else {
        expandSuffix(paths.concretePathInfo, depth + 1, row);
      }
      descend(depth + 1, paths.childListPathInfo, row);
    }
    ancestors.delete(branch);
  };

  descend(0, getPathInfo(anchorList), null);

  // 観測したリスト値を差分基準へ確定する。合併形の `$getAll` も再帰の `$setAll` も必ず確定する
  // （実装計画 §6 — cold な書き込みが ListIndex 世代を鋳造したまま基準を残さないと、次の
  // 構造変更で深い子台帳が孤児になる）。走査が throw したときは上の raise でここに来ない。
  for (const [address, value] of observed) {
    setStateListBaseline(address, value);
  }
  return results;
}
