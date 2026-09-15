/**
 * setByAddress.ts
 *
 * Stateの内部APIとして、アドレス情報（IStateAddress）を指定して
 * 状態オブジェクト（target）に値を設定するための関数（setByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を設定（多重ループやワイルドカードにも対応）
 * - getter/setter経由で値設定時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathInfoやlistIndexを辿って再帰的に値を設定
 * - 設定後はupdater.enqueueUpdateAddressで更新情報を登録
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値設定を実現
 * - finallyで必ず更新情報を登録し、再描画や依存解決に利用
 * - getter/setter経由のスコープ切り替えも考慮した設計
 */

import { createAbsoluteStateAddress } from "../../address/AbsoluteStateAddress";
import { IAbsoluteStateAddress, IStateAddress } from "../../address/types";
import { DELIMITER, WILDCARD } from "../../define";
import { dispatchBindableEvent } from "../../dcc/dispatchBindableEvent";
import { createListIndex } from "../../list/createListIndex";
import { getListIndexesByList, setListIndexesByList } from "../../list/listIndexesByList";
import { getLastListValueByAbsoluteStateAddress, setLastListValueByAbsoluteStateAddress } from "../../list/lastListValueByAbsoluteStateAddress";
import { ISwapInfo } from "./types";
import { createListDiff } from "../../list/createListDiff";
import { collectFieldWrites, IKeyedListMerge, mergeKeyedList } from "../../list/mergeKeyedList";
import { IListIndex } from "../../list/types";
import { getPathInfo } from "../../address/PathInfo";
import { createStateAddress } from "../../address/StateAddress";
import { wildcardScopeMessage } from "../../pathDiagnostics";
import { raiseError } from "../../raiseError";
import { getUpdater } from "../../updater/updater";
import { IStateHandler, IStateProxy } from "../types";
import { getByAddress } from "./getByAddress";
import { isCacheable } from "./isCacheable";
import { hasByAddress } from "./hasByAddress";
import { markSwapBaselineList } from "../../list/swapBaselineList";
import { getSwapInfoByList, setSwapInfoByList } from "./swapInfo";
import { walkDependency } from "../../dependency/walkDependency";
import { dirtyCacheEntryByAbsoluteStateAddress, setCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
import { getAbsolutePathInfo } from "../../address/AbsolutePathInfo";
import { config } from "../../config";
import { devtoolsSink } from "../../devtools/sink";
import { beginPropagationTransaction, getCurrentPropagationContext } from "../../propagation/propagation";
import { consumeOccurrenceWrite } from "../occurrenceWrite";
import { getPrevValue, hasPrevValue, recordPrevValue } from "../../watch/prevValues";
import { findGraftedSlotUnder } from "../../webComponent/volumeShared";
import { resolveExport } from "../../webComponent/exportIndex";
import { writeExportedAccessor } from "../../webComponent/overlay";

/**
 * 宣言済みパスの `prev` 台帳へ旧値を記録する。台帳を読むのは `$watch`
 * （docs/state-watch-hook-design.md §4-1）と `$scan` の `from`（docs/state-scan-design.md §2-1）。
 *
 * same-value guard が既に読んだ旧値だけを使い、そのための追加読みはしない。
 * どちらも未宣言なら `watchPaths` / `scanPaths` の null 判定 2 個で抜ける（watch 設計書 §10）。
 */
function recordDeclaredPrevValue(
  stateElement: IStateHandler["stateElement"],
  path: string,
  absAddress: IAbsoluteStateAddress,
  oldValue: unknown,
  hasOldValue: boolean,
): void {
  if (!hasOldValue) {
    return;
  }
  const watchPaths = stateElement.watchPaths;
  const scanPaths = stateElement.scanPaths;
  if (watchPaths?.has(path) === true || scanPaths?.has(path) === true) {
    recordPrevValue(absAddress, oldValue);
  }
}

// Phase 3: 書き込み時点の因果 context を update record に付与する。
// binding 経由の書き込みは呼び出し元の dynamic scope から context を引き継ぎ、
// binding 外からの API update は新しい transaction を開始する（設計書 §4 規則 1）。
// 依存 walk で enqueue される派生アドレスも同じ書き込みの因果に属する。
function notifyWrite(
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  receiver : any,
  handler  : IStateHandler,
  keyedMergePath: string | null,
  cacheable: boolean
): void {
  const propagationContext = config.enablePropagationContext
    ? (getCurrentPropagationContext() ?? beginPropagationTransaction(-1))
    : null;
  const updater = getUpdater();
  updater.enqueueAbsoluteAddress(absAddress, propagationContext);
  // 書いたアドレス自身のキャッシュを、依存ウォークより先に無効化する（#274）。ウォークはリスト展開
  // （list → list.*）と動的依存の親リスト展開で、書いたパスの値を読む。ワイルドカードを含むリストパス
  // （`groups.*.items`）はキャッシュ対象なので、無効化しないと書き込み前の配列がヒットし、基準との差分が
  // 「変化なし」になって置き換える前の行だけを展開する（長い配列に置き換えた分の行が着地しない）。
  // 依存先は下の callback が訪問のたびに読む前に無効化するが、開始アドレスは callback が飛ばす
  // （二重 enqueue の防止）のでここで済ませる — 開始アドレスも callback で無効化する $postUpdate と同じ順序。
  // 値は直後の commitWriteCache が載せ直す。
  if (cacheable) {
    dirtyCacheEntryByAbsoluteStateAddress(absAddress);
  }
  // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
  walkDependency(
    handler.stateElement,
    address,
    handler.stateElement.staticDependency,
    handler.stateElement.dynamicDependency,
    handler.stateElement.listPaths,
    receiver as IStateProxy,
    "new",
    (depAddress: IStateAddress) => {
      // キャッシュを無効化（ダーティ）
      if (depAddress === address) return;
      const absDepPathInfo = getAbsolutePathInfo(handler.stateElement, depAddress.pathInfo);
      const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
      dirtyCacheEntryByAbsoluteStateAddress(absDepAddress);
      // 更新対象として登録
      updater.enqueueAbsoluteAddress(absDepAddress, propagationContext);
    },
    // リスト置換時は追加行・位置変更行のみ展開する（未変更行の再訪を省く。
    // $postUpdate の手動リフレッシュは従来通り全行展開のまま）
    { listExpansion: "diff", keyedMergePath }
  )
}

/**
 * 書き込み完了後のキャッシュ整合（Issue #234）。
 *
 * ワイルドカードのデータパス（リスト行）は代入値がそのまま格納値なので、
 * 代入値を dirty:false で載せて次回の読みを省く。
 *
 * アクセサペア（getterPaths に載るパス）は getter が正本であり、setter は
 * 命令的な代入に過ぎない。代入値を getter の評価結果として固定すると
 * - setter が正規化・分配した結果と読みが食い違う
 * - getter が一度も評価されず動的依存が張られない → 依存先を書いても
 *   walkDependency がこのキャッシュを dirty にできず、永続的に stale になる
 *   （プリミティブ代入は同値ガードの旧値読みで偶然 getter が走るが、
 *   オブジェクト代入は同値ガードを素通りするため救済がない）
 * ため、キャッシュを dirty にして次回の読みで getter を再評価させる。
 */
function commitWriteCache(
  stateElement: IStateHandler["stateElement"],
  path: string,
  absAddress: IAbsoluteStateAddress,
  value: unknown,
  cacheable: boolean,
): void {
  if (!cacheable) {
    return;
  }
  if (stateElement.getterPaths.has(path)) {
    dirtyCacheEntryByAbsoluteStateAddress(absAddress);
    return;
  }
  setCacheEntryByAbsoluteStateAddress(absAddress, {
    value: value,
    dirty: false,
    // 読み側（getByAddress）と同じ世代印を付ける — ヒットになるのは世代が一致する項目だけ
    // （cache/types.ts の `generation`）。
    generation: stateElement.stateGeneration
  });
}

function _setByAddress(
  target   : object,
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  value    : any,
  receiver : any,
  handler  : IStateHandler,
  keyedMergePath: string | null,
  cacheable: boolean
): any {
  try {
    if (address.pathInfo.path in target) {
      if (handler.stateElement.setterPaths.has(address.pathInfo.path)) {
        // setterの中で参照の可能性があるので、addressをプッシュする。
        // setter は命令的な代入であって派生（getter）ではないため、実行中の
        // 読み取り（同値ガードの旧値読み・$1 参照等）で依存を張らない。
        // アクセサペア（get/set 同名パス）では、抑止しないと setter 内の内部
        // 書き込みの同値ガード読みが「getter の依存」として誤登録される。
        handler.pushAddress(address);
        handler.beginUntrack();
        try {
          return Reflect.set(target, address.pathInfo.path, value, receiver);
        } finally {
          handler.endUntrack();
          handler.popAddress();
        }

      } else {
        return Reflect.set(target, address.pathInfo.path, value);
      }
    } else {
      const parentAddress = address.parentAddress;
      if (parentAddress === null) {
        return Reflect.set(target, address.pathInfo.path, value);
      }
      const parentValue = getByAddress(target, parentAddress, receiver, handler);
      const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
      if (lastSegment === WILDCARD) {
        // 読み取り側（getByAddress）と同じ取り違え。書き込みでも何段必要かを言う。
        const index = address.listIndex?.index ?? raiseError(
          wildcardScopeMessage(
            `path "${address.pathInfo.path}"`,
            address.pathInfo.wildcardCount,
            address.listIndex?.length ?? 0,
          ),
        );
        return Reflect.set(parentValue, index, value);
      } else {
        // 公開 getter への書き込み（X9）は setByAddressCore の fast path（親がオブジェクトの
        // 未存在キー）で dispatch 済み。ここに来るのは親が非オブジェクトの形だけ
        return Reflect.set(parentValue, lastSegment, value);
      }
    }
  } finally {
    notifyWrite(address, absAddress, receiver, handler, keyedMergePath, cacheable);
  }
}

function _setByAddressWithSwap(
  target   : object,
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  value    : any,
  receiver : any,
  handler  : IStateHandler,
  keyedMergePath: string | null,
  cacheable: boolean
) {
  // elementsの場合はswapInfoを準備（キーはリストの配列そのもの — swapInfo.ts 参照）
  const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
  const parentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
  let swapInfo = getSwapInfoByList(parentValue);
  if (swapInfo === null) {
    const listIndexes = getListIndexesByList(parentValue) ?? [];
    swapInfo = {
      value: [...parentValue], listIndexes: [...listIndexes]
    }
    setSwapInfoByList(parentValue, swapInfo);
  }
  try {
    return _setByAddress(target, address, absAddress, value, receiver, handler, keyedMergePath, cacheable);
  } finally {
    const index = swapInfo.value.indexOf(value);
    const currentParentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
    const currentListIndexes = Array.isArray(currentParentValue) ? (getListIndexesByList(currentParentValue) ?? []) : [];
    const curIndex = address.listIndex!.index;
    const listIndex = (index !== -1) ? 
      swapInfo!.listIndexes[index] : 
      createListIndex(parentAddress.listIndex, -1);
    currentListIndexes[curIndex] = listIndex;
    // 重複チェック
    // 重複していない場合、swapが完了したとみなし、インデックスを更新
    const listValueSet = new Set(currentParentValue);
    if (listValueSet.size === swapInfo!.value.length) {
      for(let i = 0; i < currentListIndexes.length; i++) {
        currentListIndexes[i].index = i;
      }
      // 完了したのでswapInfoを削除
      setSwapInfoByList(parentValue, null);
      notifySwappedList(parentAddress, swapInfo, currentParentValue, currentListIndexes, receiver, handler);
    }
  }
}

/**
 * 要素書き込みの入れ替え（または行の置き換え）が揃ったとき、リストを「書き込む前の並び →
 * いまの並び」の置換として描画し直させる（#4 — 同一性モデル）。
 *
 * 台帳は上で「listIndex は値に付いて動く」形に組み替え済み。ところが `for` の描画基準
 * （lastListValue）はその場で書き換えられた同じ配列なので、差分に入れ替えが映らず、ブロックは
 * 動かないまま中身だけが書き換わっていた。基準を「書き込む前の並びの写し」とその台帳の写しに
 * すると、`for` は写しといまの配列の差分を listIndex の同一性で突き合わせ（createListDiff の
 * calcDiffIndexes）、ブロックを値と一緒に動かし、置き換えた行を作り直す。基準を写しに替えるのは、
 * 描画基準がいま入れ替えている配列そのもののときだけ — 同じバッチで配列を丸ごと書き換えた後なら、
 * 描画はまだその前の配列で、そちらとの差分が入れ替えも含む。
 *
 * 行ごとの扱い（書き込む前といまの台帳の位置を比べる）:
 *  - 位置が変わらない行: 何もしない。
 *  - 新しい listIndex の行（書き込む前の台帳に無い）: その位置の値の書き込みとして着地させる。差し替えられた
 *    行は `for` の差分で退役し、その行のアドレスの着地は `$watch` / `$scan` の選別で捨てられるので、
 *    着地は新しい行が持つ（#274 の「その位置のいまの値で 1 回」）。要素パス自身の prev は、書き込みがその位置の
 *    前の行のアドレスで記録した値を引き継ぐ（引き継がないと `$watch "items.*"` の prev が消える）。ブロックは
 *    `for` が同じ位置で外す行の Content をその場で使い回す（applyChangeToFor の collectInPlaceContents）。
 *  - 値と一緒に動いた行: 値は変わっていないので、依存を無効化して描画だけをやり直す。書き込みを別の
 *    バッチに分けると、途中のバッチで別の値を描いた行が残る。
 * リスト自身も描画だけを積む（updater の enqueueRenderOnlyAddress）。書き込みとして積むと、`items` の
 * `$watch` が配列の参照の変わらない入れ替えで発火する。
 */
function notifySwappedList(
  parentAddress: IStateAddress,
  swapInfo: ISwapInfo,
  currentParentValue: unknown,
  currentListIndexes: readonly IListIndex[],
  receiver: any,
  handler: IStateHandler,
): void {
  const stateElement = handler.stateElement;
  const updater = getUpdater();
  const listAbsAddress = createAbsoluteStateAddress(
    getAbsolutePathInfo(stateElement, parentAddress.pathInfo),
    parentAddress.listIndex,
  );
  if (getLastListValueByAbsoluteStateAddress(listAbsAddress) === currentParentValue) {
    setListIndexesByList(swapInfo.value, swapInfo.listIndexes);
    setLastListValueByAbsoluteStateAddress(listAbsAddress, swapInfo.value);
    markSwapBaselineList(swapInfo.value);
  }
  updater.enqueueRenderOnlyAddress(listAbsAddress);

  const positionBefore = new Map<IListIndex, number>();
  swapInfo.listIndexes.forEach((listIndex, position) => positionBefore.set(listIndex, position));
  const elementPathInfo = getPathInfo(parentAddress.pathInfo.path + DELIMITER + WILDCARD);
  const elementAbsPathInfo = getAbsolutePathInfo(stateElement, elementPathInfo);
  for (let position = 0; position < currentListIndexes.length; position++) {
    const listIndex = currentListIndexes[position];
    const before = positionBefore.get(listIndex);
    if (before === position) {
      continue;
    }
    const elementAddress = createStateAddress(elementPathInfo, listIndex);
    const elementAbsAddress = createAbsoluteStateAddress(elementAbsPathInfo, listIndex);
    if (typeof before === "undefined") {
      const displacedAbsAddress = createAbsoluteStateAddress(elementAbsPathInfo, swapInfo.listIndexes[position] ?? null);
      if (hasPrevValue(displacedAbsAddress)) {
        recordPrevValue(elementAbsAddress, getPrevValue(displacedAbsAddress));
      }
      notifyWrite(elementAddress, elementAbsAddress, receiver, handler, null, isCacheable(stateElement, elementAddress));
      continue;
    }
    walkDependency(
      stateElement,
      elementAddress,
      stateElement.staticDependency,
      stateElement.dynamicDependency,
      stateElement.listPaths,
      receiver as IStateProxy,
      "new",
      (depAddress: IStateAddress) => {
        const depAbsAddress = createAbsoluteStateAddress(
          getAbsolutePathInfo(stateElement, depAddress.pathInfo),
          depAddress.listIndex,
        );
        dirtyCacheEntryByAbsoluteStateAddress(depAbsAddress);
        updater.enqueueRenderOnlyAddress(depAbsAddress);
      },
      { listExpansion: "diff" },
    );
  }
}

/**
 * `$listKeys` 宣言済みリストパスへの配列代入を「キー一致行のオブジェクト値展開」に
 * 変換する（docs/state-list-key-design.md §2）。
 *
 * 1. キー突合して、一致行は旧オブジェクトを据え置いたハイブリッド配列を作る
 * 2. ハイブリッド配列を通常の書き込み経路で格納する
 * 3. createListDiff で listIndex を確定し、変化フィールドだけを per-path 書き込みで発行
 *
 * 3 を格納後に行うのが要点。フィールド書き込みは `list.*.field` を親経由で解決する
 * ため、親（ハイブリッド配列）が既に格納されていなければ正しい行に届かない。
 * また per-path 書き込みは再び setByAddress に入るので、ネストしたリストパスが
 * 宣言されていればそのレベルのキー突合が再帰的に走る（§4）。
 *
 * 未宣言時のコストは stateElement.listKeys の null 判定 1 回のみ（§7-1）。
 */
function setKeyedListByAddress(
    target   : object,
    address  : IStateAddress,
    merge    : IKeyedListMerge,
    oldList  : readonly unknown[],
    receiver : any,
    handler  : IStateHandler
): any {
  const listPath = address.pathInfo.path;
  // diff の基準は「マージ相手にした配列」= 書き込み直前に格納されていた配列。
  // 読み手（applyChangeToFor / $getAll / resolve）は現在格納されている配列の
  // listIndex 台帳（listIndexesByList）へ収束するため、同じ基準で引くことで
  // 書き込みが dirty 化・キャッシュするアドレスと読み手のアドレスが一致する。
  // lastValue（最後に *適用* された配列）を基準にすると、for が未マウントで
  // lastValue が空のときに別台帳を作ってしまい、値は入っているのにワイルドカード
  // 読みだけ旧値のまま残る（設計書 §8.1）。
  // 格納より前に引くのは、格納時の walkDependency（listExpansion: "diff"）が
  // 先にハイブリッド配列の台帳を作ってしまうと、後から上書きした台帳との間で
  // 同じ分裂が起きるため。先に確定させておけば以降は全経路がこれに合流する。
  const listParentListIndex = address.listIndex;
  if (getListIndexesByList(oldList) === null) {
    // 一度も描画されていないリストは台帳自体が無い。先に生やしておかないと
    // isSameList 経路が空の oldIndexes をそのまま新台帳にしてしまう。
    createListDiff(listParentListIndex, null, oldList);
  }
  const diff = createListDiff(listParentListIndex, oldList, merge.list);
  const result = setByAddressCore(target, address, merge.list, receiver, handler, listPath);
  const elementPathInfo = getPathInfo(listPath + DELIMITER + WILDCARD);
  for (const match of merge.matched) {
    const fieldWrites = collectFieldWrites(match.oldRow, match.newRow);
    if (fieldWrites.length === 0) {
      continue;
    }
    // createListDiff の契約上 newIndexes の長さはハイブリッド配列と一致するため
    // 通常 undefined にはならない。仮に不変条件が破れても、per-path 書き込みを
    // 諦めるだけで値そのものは行オブジェクトへ反映する（skip すると state だけが
    // 旧値のまま残り、本機能が塞ごうとしている stale を作ってしまう）。
    const listIndex: IListIndex | undefined = diff.newIndexes[match.position];
    for (const write of fieldWrites) {
      if (typeof listIndex === "undefined") {
        match.oldRow[write.field] = write.value;
        continue;
      }
      const fieldPathInfo = getPathInfo(elementPathInfo.path + DELIMITER + write.field);
      const fieldAddress = createStateAddress(fieldPathInfo, listIndex);
      setByAddress(target, fieldAddress, write.value, receiver, handler);
    }
  }
  return result;
}

export function setByAddress(
    target   : object,
    address  : IStateAddress,
    value    : any,
    receiver : any,
    handler  : IStateHandler
): any {
  const listKeys = handler.stateElement.listKeys;
  if (listKeys != null && Array.isArray(value)) {
    const keySpec = listKeys.get(address.pathInfo.path);
    if (typeof keySpec !== "undefined") {
      const oldValue = getByAddress(target, address, receiver, handler);
      const merge = mergeKeyedList(address.pathInfo.path, keySpec, oldValue, value);
      if (merge !== null) {
        // merge が非 null なのは oldValue が非空配列のときだけ（mergeKeyedList 参照）
        return setKeyedListByAddress(target, address, merge, oldValue as readonly unknown[], receiver, handler);
      }
    }
  }
  return setByAddressCore(target, address, value, receiver, handler, null);
}

function setByAddressCore(
    target   : object,
    address  : IStateAddress,
    value    : any,
    receiver : any,
    handler  : IStateHandler,
    keyedMergePath: string | null
): any {
  const stateElement = handler.stateElement;
  const path = address.pathInfo.path;
  // D22 後段: 接ぎ木済みボリュームのマウントポイントを**含む親**の丸ごと書きは throw
  // （設計書 §4-2）。黙って通すと接ぎ木データが消え、quoted-path アクセサだけが
  // 宙に浮いて原因の見えない undefined / TypeError になる。スロット自身への書き込みは
  // 通常のデータ差し替えとして通す。ボリュームの無い state は boolean 判定 1 個で抜ける（D18）
  if (stateElement.hasGraftedVolumes === true) {
    const shadowedSlot = findGraftedSlotUnder(stateElement, path);
    if (shadowedSlot !== null) {
      raiseError(
        `Cannot replace "${path}" wholesale: a volume is mounted at "${shadowedSlot}" under it (D22). ` +
        `Replacing an ancestor of a mount point silently discards the grafted data while its accessors remain. ` +
        `Write "${shadowedSlot}" itself, or individual fields inside "${path}", instead.`,
      );
    }
  }
  // 再帰 getter の展開形（`nodes.*.children.*.total`）とその値の内側への書き込みは、`**` を
  // 含まないので `setAllRecursive` の読み取り専用検査を通らない。未実体化なら下の fast path が
  // 「親オブジェクトの未存在キー」として行オブジェクトへ素の値を書き、代入値を `dirty:false` で
  // キャッシュに載せる — ノードが汚れ、実体化後も getter が評価されず、深さ 0 の集計まで
  // 巻き込む（レビュー P18 で実測）。実体化後は `Reflect.set` が false を返すだけの無言 no-op。
  // 読み側の遅延実体化（getByAddress の E5）と対称に、書き側はここで止める。
  // 宣言の無い state は boolean 判定 1 個で抜ける（D18）
  if (stateElement.hasRecursion === true) {
    const owner = stateElement.recursionRegistry!.recursiveGetterOwningPath(address.pathInfo);
    if (owner !== null) {
      raiseError(
        `[wcs/recursion-readonly] "${path}" writes into the recursive getter "${owner}" ` +
        `(this path is that getter at one depth, or a path inside the value it derives), which has ` +
        `no setter. Write the values it derives from instead.`
      );
    }
  }
  // occurrence（wc-bindable の `semantics: "event"`）由来の書き込みは、同値でも
  // 「もう一度起きた」ことを落としてはならないため same-value guard を 1 回だけ飛ばす。
  // トークンはここで消費されるので、この write の内側で走る他の書き込みには波及しない。
  const skipSameValueGuard = consumeOccurrenceWrite();

  // --- fast path: 宣言済み getter/setter でも swap 対象でもない、親を持つ葉パス ---
  // 従来は same-value guard の値読み・hasByAddress・実書き込みがそれぞれ親チェーンを
  // 解決していた（キャッシュヒットでも getByAddress 呼び出しの固定費 ×3）。
  // 親を 1 回だけ解決し、同じ親オブジェクトに対して guard 判定と Reflect.set を行う。
  // 非オブジェクト親などの例外形は従来経路へ倒し、挙動差を作らない。
  if (!(path in target) && address.parentAddress !== null && !stateElement.elementPaths.has(path)) {
    const parentValue = getByAddress(target, address.parentAddress, receiver, handler);
    if (typeof parentValue === "object" && parentValue !== null) {
      // ワイルドカード末尾で listIndex が無い不正アドレスは、従来どおり
      // 書き込み時（enqueue 済みの try 内）に raiseError する → key は undefined のまま持ち回す
      const lastSegment = address.pathInfo.lastSegment;
      const key: PropertyKey | undefined = lastSegment === WILDCARD
        ? address.listIndex?.index
        : lastSegment;
      let devOldValue: unknown;
      let devHasOldValue = false;
      if (!skipSameValueGuard && config.sameValueGuard && (value === null || typeof value !== "object")) {
        // hasByAddress と同じ「初期化済みスロットか」判定（undefined 格納と未初期化を区別）
        const has = key !== undefined && key in parentValue;
        const oldValue = key !== undefined ? (parentValue as Record<PropertyKey, unknown>)[key] : undefined;
        if (has && Object.is(oldValue, value)) {
          return true;
        }
        devOldValue = oldValue;
        devHasOldValue = true;
      }
      const cacheable = isCacheable(stateElement, address);
      const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
      const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
      if (devtoolsSink !== null) {
        devtoolsSink({
          type: "state:write",
          absoluteAddress: absAddress,
          value,
          oldValue: devOldValue,
          hasOldValue: devHasOldValue,
        });
      }
      recordDeclaredPrevValue(stateElement, path, absAddress, devOldValue, devHasOldValue);
      let dispatchedExport = false;
      try {
        if (key === undefined) {
          // fast path 版の同じ取り違え（末尾ワイルドカードに listIndex が無い）。
          // 通常経路と同じ語彙で「何段必要か」を言う（pathDiagnostics.ts）。
          raiseError(wildcardScopeMessage(
            `path "${path}"`,
            address.pathInfo.wildcardCount,
            address.listIndex?.length ?? 0,
          ));
        }
        // 公開 getter への書き込み（docs/state-overlay-export-design.md X9）: 未存在キーへの
        // 書き込みは今日「ツリーに作る」が、その位置に公開 getter があると以後ツリーが勝ち
        // （X1）getter を無言で隠す。setter があれば setter、無ければ raise（overlay の set）
        if (stateElement.hasMounts === true && lastSegment !== WILDCARD && !(key in parentValue)) {
          const exported = resolveExport(stateElement, address.parentAddress.pathInfo.path, lastSegment, address.listIndex);
          if (exported !== null) {
            dispatchedExport = true;
            return writeExportedAccessor(exported.record, exported.entry, address.listIndex, value, receiver, handler);
          }
        }
        return Reflect.set(parentValue, key, value);
      } finally {
        notifyWrite(address, absAddress, receiver, handler, keyedMergePath, cacheable);
        if (dispatchedExport) {
          // Exported row paths are cacheable but absent from getterPaths. The
          // accessor may normalize or reject the input; never pin that input.
          dirtyCacheEntryByAbsoluteStateAddress(absAddress);
        } else {
          commitWriteCache(stateElement, path, absAddress, value, cacheable);
        }
        // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）
        dispatchBindableEvent(stateElement, address.pathInfo, { value });
      }
    }
  }
  // --- end fast path ---

  // --- same-value guard (config.sameValueGuard・既定 ON) ---
  // primitive 値かつ Object.is 同値なら、set / enqueue / walkDependency / DOM 適用 /
  // $updatedCallback / DCC イベントを丸ごとスキップ（標準的なリアクティブ no-op）。
  // 参照型(object/array)は in-place mutation 取りこぼし防止のため素通し（ガードしない）。
  // devtools write イベント用: guard が既に取得した旧値のみ流用する
  // （参照型のために追加の get はしない — protocol §4.2）
  let devOldValue: unknown;
  let devHasOldValue = false;
  if (!skipSameValueGuard && config.sameValueGuard && (value === null || typeof value !== "object")) {
    const oldValue = getByAddress(target, address, receiver, handler);
    if (hasByAddress(target, address, receiver, handler) && Object.is(oldValue, value)) {
      return true;
    }
    devOldValue = oldValue;
    devHasOldValue = true;
  }
  // --- end same-value guard ---
  const isSwappable = stateElement.elementPaths.has(address.pathInfo.path);
  const cacheable = isCacheable(stateElement, address);
  const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
  const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
  if (devtoolsSink !== null) {
    devtoolsSink({
      type: "state:write",
      absoluteAddress: absAddress,
      value,
      oldValue: devOldValue,
      hasOldValue: devHasOldValue,
    });
  }
  recordDeclaredPrevValue(stateElement, path, absAddress, devOldValue, devHasOldValue);
  try {
    if (isSwappable) {
      return _setByAddressWithSwap(target, address, absAddress, value, receiver, handler, keyedMergePath, cacheable);
    } else {
      return _setByAddress(target, address, absAddress, value, receiver, handler, keyedMergePath, cacheable);
    }
  } finally {
    // 要素書き込み（#4）の代入値は、書き込んだアドレスのキャッシュに固定しない。入れ替えでは listIndex が
    // 値に付いて動くので、書き込んだ時点の listIndex がこの位置に残るとは限らない — 固定すると、台帳は
    // 入れ替わったのにキャッシュだけが位置のまま交差する。notifyWrite が無効化した項目を、次の読みが
    // 台帳に沿って読み直す
    if (!isSwappable) {
      commitWriteCache(stateElement, path, absAddress, value, cacheable);
    }
    // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）
    dispatchBindableEvent(stateElement, address.pathInfo, { value });
  }
}

