import { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import { beginStateListBaselineBatch, endStateListBaselineBatch } from "../list/stateListBaseline";
import { advanceUpdateBatch } from "./updateBatch";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { peekBindingsForAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { inSsr } from "../config";
import { MAX_PROPAGATION_HOPS, MAX_RENDER_CHAIN_DEPTH } from "../define";
import { runTransition } from "../protocol/transitionRunner";
import { devtoolsSink } from "../platform/devtoolsSink";
import { IPropagationContext } from "../propagation/types";
import { IBindingInfo } from "../types";

/**
 * drain（_applyChange）終了通知のリスナー（docs/state-streams-design.md §3-2）。
 * バッチ内の更新アドレス（AbsoluteStateAddress のインスタンス同一性で
 * dedup 済みの Set）を受け取る。stream runtime の依存駆動 restart が
 * この通知を交差判定の入力にする。
 */
export type UpdateBatchListener = (batch: ReadonlySet<IAbsoluteStateAddress>) => void;

interface IRegisteredBatchListener {
  readonly listener: UpdateBatchListener;
  readonly priority: number;
}

const updateBatchListeners: IRegisteredBatchListener[] = [];

/**
 * 書き込みの enqueue を見る機能（設計案 H2 の enqueue 側）。`$watch` の連鎖深さ（watch/chainDepth.ts）と
 * `on` scan の保留 reset（scan/eventReset.ts）が install で登録する。互いに独立なので順序契約は無い。
 * 登録が無ければ enqueue は配列長 0 の判定 1 回で抜ける。
 */
export type EnqueueListener = (absoluteAddress: IAbsoluteStateAddress) => void;

const enqueueListeners: EnqueueListener[] = [];

/**
 * 描画起点の書き込み連鎖の深さ（#338・MAX_RENDER_CHAIN_DEPTH）。書き込みは enqueue の時点で 3 通りに分かれる。
 * - binding の適用（下の applyBindings）の最中: 「次のバッチはこの連鎖の続き」と印を付ける
 *   （行を作るときの要素の初期同期・binding が設定したその場で要素が同期に出したイベント・`$renderedCallback` など）
 * - drain の外（作者の操作・非同期に届く I/O ノードのイベント・`$stream` の値・ハイドレーション）: 次のバッチを深さ 0 から
 *   数え直す。microtask で刻む書き手（`await` の続き・待ちの無い `$stream`）が描画の書き戻しと同じバッチに
 *   乗り続けても、連鎖を伸ばさない
 * - drain 終了リスナー（`$scan` / `$watch` / `$streams` restart）の中: 伸ばしも数え直させもせず、今のバッチの
 *   深さを次のバッチへ引き継ぐ。`$watch` は自分の連鎖上限を持つので重ねて数えない。引き継がないと、描画の
 *   書き戻しを `$watch` / `$scan` が受けて書く循環（要素が `x` へ書き、`$watch` が `x` から一覧の読むキーへ書く）で、
 *   リスナーの書き込みだけが載った次のバッチが深さ 0 に戻り、上限に掛からずに回り続けていた（#353）
 * 適用が書かなかったバッチの次は深さ 0 なので、一度で収まる書き戻し（行の初期同期など）は伸びない。
 */
/** 適用中のバッチの深さ + 1。drain 終了リスナーの最中はバッチの深さ、drain の外なら -1 */
let applyingDepth = -1;
/** 次に drain されるバッチの深さ */
let pendingDepth = 0;
/** 次のバッチに drain の外からの書き込みがある（深さ 0 から数え直す） */
let pendingExternal = false;

/** 機能の install が呼ぶ（冪等 — 同じ listener は 1 回だけ） */
export function registerEnqueueListener(listener: EnqueueListener): void {
  if (!enqueueListeners.includes(listener)) {
    enqueueListeners.push(listener);
  }
}

/**
 * drain 終了リスナーを登録する。
 *
 * `priority` の昇順に呼ばれる（同値は登録順）。機構間の実行順序
 * （`$scan` → `$watch` → `$streams` restart。前の 2 つは同じ watch リスナーの中の順序で、
 * `$scan` は畳んで書いてから `$watch` を発火する —
 * docs/state-watch-hook-design.md §3-2 層 1・docs/state-scan-design.md D11）は
 * この優先度で固定する — import 順に順序を持たせると、無関係な import 整理で
 * 静かに壊れるため。定数は define.ts の `*_LISTENER_PRIORITY` を使うこと。
 */
export function registerUpdateBatchListener(listener: UpdateBatchListener, priority = 0): void {
  // 挿入ソート: 同値優先度の中では登録順を保つ（find は最初の「より大きい」要素を指す）
  const index = updateBatchListeners.findIndex((registered) => registered.priority > priority);
  const entry = { listener, priority };
  if (index === -1) {
    updateBatchListeners.push(entry);
  } else {
    updateBatchListeners.splice(index, 0, entry);
  }
}

/**
 * drain 終了リスナーを解除する（テスト間の分離用）。
 */
export function unregisterUpdateBatchListener(listener: UpdateBatchListener): void {
  const index = updateBatchListeners.findIndex((registered) => registered.listener === listener);
  if (index !== -1) {
    updateBatchListeners.splice(index, 1);
  }
}

/**
 * 全リスナーに drain のバッチを優先度順で通知する。
 * リスナーの throw は握りつぶさない（内部バグの隠蔽防止）。
 * stream / watch 側リスナーが entry ごとに自前で try/catch する契約（設計書 §3-2）。
 */
function notifyUpdateBatchListeners(batch: ReadonlySet<IAbsoluteStateAddress>): void {
  // 反復中の register / unregister（ハンドラ内の切断・再 set）に耐えるためコピーする
  for (const registered of updateBatchListeners.slice()) {
    registered.listener(batch);
  }
}

/**
 * 遷移越しの適用が失敗したときの報告。
 *
 * 遷移の中では例外を同期的に呼び出し元へ投げ返せない。今日の drain は
 * queueMicrotask の中で throw する ＝ uncaught として観測されるので、それと同じ
 * 「loud に出す」挙動へ揃える。握り潰すと `$updatedCallback` の throw が黙って
 * 消える（README の 3 層表が定める伝播の契約が破れる）。
 */
export function reportDeferredApplyFailure(error: unknown): void {
  queueMicrotask(() => { throw error; });
}

/** queue に積まれる update record（address + 書き込み時点の因果 context） */
interface IQueuedUpdateRecord {
  readonly absoluteAddress: IAbsoluteStateAddress;
  readonly context: IPropagationContext | null;
}

class Updater {
  private _queueUpdateRecords: IQueuedUpdateRecord[] = [];
  /**
   * 描画だけをやり直すアドレス（`enqueueRenderOnlyAddress`）。書き込みの record とは別に持つ —
   * drain 終了リスナーへ渡すバッチにも、`hasQueuedPath`（`on` scan の保留 reset の判定）にも混ぜない。
   */
  private _queueRenderOnlyAddresses: IAbsoluteStateAddress[] = [];
  constructor() {
  }

  enqueueAbsoluteAddress(
    absoluteAddress: IAbsoluteStateAddress,
    context: IPropagationContext | null = null,
  ): void {
    // 書き込みの時点を見る機能（`$watch` の連鎖のマーク・`on` scan の `resetOn` の保留）。
    // install されていなければ配列長 0 の判定 1 回
    for (let i = 0; i < enqueueListeners.length; i++) {
      enqueueListeners[i](absoluteAddress);
    }
    // 描画連鎖の印（上の applyingDepth の説明）
    if (applyingDepth > pendingDepth) {
      pendingDepth = applyingDepth;
    }
    if (applyingDepth < 0) {
      pendingExternal = true;
    }
    const requireStartProcess = this._isQueueEmpty();
    this._queueUpdateRecords.push({ absoluteAddress, context });
    if (requireStartProcess) {
      this._scheduleDrain();
    }
  }

  /**
   * 描画だけをやり直させる（#4）。値を書いたわけではないので、書き込みの着地としては扱わない —
   * binding の適用には載せるが、drain 終了リスナー（`$scan` / `$watch` / `$streams` restart）へ渡す
   * バッチに入れず、`$watch` の連鎖や `on` scan の reset の印も付けない。同じバッチで同じアドレスが
   * 書き込みとしても積まれていれば、そちらが着地になる。
   * 呼び手は要素書き込みの入れ替えの完了（proxy/methods/setByAddress.ts の notifySwappedList）。
   */
  enqueueRenderOnlyAddress(absoluteAddress: IAbsoluteStateAddress): void {
    const requireStartProcess = this._isQueueEmpty();
    this._queueRenderOnlyAddresses.push(absoluteAddress);
    if (requireStartProcess) {
      this._scheduleDrain();
    }
  }

  private _isQueueEmpty(): boolean {
    return this._queueUpdateRecords.length === 0 && this._queueRenderOnlyAddresses.length === 0;
  }

  private _scheduleDrain(): void {
    // このバッチのあいだ、依存ウォークと読みが観測したリスト値は保留にする。
    // 確定は drain の finally（list/stateListBaseline.ts の頭のコメント）。
    beginStateListBaselineBatch();
    queueMicrotask(() => {
      const updateRecords = this._queueUpdateRecords;
      const renderOnlyAddresses = this._queueRenderOnlyAddresses;
      this._queueUpdateRecords = [];
      this._queueRenderOnlyAddresses = [];
      advanceUpdateBatch();
      this._applyChange(updateRecords, renderOnlyAddresses);
    });
  }

  /**
   * まだ drain されていない書き込み（次のバッチ）に、この state のこのパスがあるか。
   * drain の最中のキューは次のバッチの分だけになっている（_applyChange の前に差し替える）。
   * `on` scan の保留 reset を、発火しない drain で捨ててよいかの判定に使う（scan/eventReset.ts）。
   */
  hasQueuedPath(stateElement: IStateElement, path: string): boolean {
    return this._queueUpdateRecords.some((record) =>
      record.absoluteAddress.absolutePathInfo.stateElement === stateElement
      && record.absoluteAddress.absolutePathInfo.pathInfo.path === path);
  }

  // テスト用に公開
  testApplyChange(
    absoluteAddresses: IAbsoluteStateAddress[],
    contexts?: readonly (IPropagationContext | null)[],
  ): void {
    this._applyChange(absoluteAddresses.map((absoluteAddress, index) => ({
      absoluteAddress,
      context: contexts?.[index] ?? null,
    })));
  }

  private _applyChange(
    updateRecords: IQueuedUpdateRecord[],
    renderOnlyAddresses: readonly IAbsoluteStateAddress[] = [],
  ): void {
    // Note: AbsoluteStateAddress はキャッシュされているため、
    // 同一の (stateElement, address) は同じインスタンスとなり、
    // Map / Set による重複排除が正しく機能する。
    // coalescing は last-write-wins: 同じ address は最後の update の
    // (値は state 側が既に保持) context をそのまま採用する（設計書 §4.1）。
    // visitedEdges の合成や synthetic transaction への置換は行わない。
    //
    // このメソッドの反復は for...of を使わない（添字ループと Map#forEach）。drain は 1 バッチに 1 回しか
    // 呼ばれないので最適化段に上がらず、for...of は反復ごとに結果オブジェクト（Map なら [key, value] の
    // 配列も）を割り当てる。cold の 1,000 行生成では行ごとに数件の依存アドレスが積まれ、その分が
    // 生成の割り当ての 1 割近くを占めていた（設計 R5）。
    //
    // このバッチの描画連鎖の深さを消費する（キューはもう次のバッチの分なので、ここから先の印は次のバッチのもの）
    let depth = pendingExternal ? 0 : pendingDepth;
    pendingDepth = 0;
    pendingExternal = false;
    const contextByAbsoluteAddress = new Map<IAbsoluteStateAddress, IPropagationContext | null>();
    // drain 終了リスナーへ渡すのは書き込みの着地だけ。描画だけのアドレスは、この後で適用の対象に足す
    // （同じアドレスの書き込みがあれば、その context のまま着地として残る）。Map の鍵から作り直さず
    // ここで積む（鍵の iterator は反復ごとに割り当てる。順序は同じ ＝ 最初に現れた順）
    const landedAddresses = new Set<IAbsoluteStateAddress>();
    for (let i = 0; i < updateRecords.length; i++) {
      const record = updateRecords[i];
      const previous = contextByAbsoluteAddress.get(record.absoluteAddress);
      if (
        devtoolsSink !== null
        && typeof previous !== "undefined" && previous !== null
        && record.context !== null
        && previous.transactionId !== record.context.transactionId
      ) {
        devtoolsSink({
          type: "propagation:coalesced",
          absoluteAddress: record.absoluteAddress,
          droppedTransactionId: previous.transactionId,
          winnerTransactionId: record.context.transactionId,
        });
      }
      contextByAbsoluteAddress.set(record.absoluteAddress, record.context);
      landedAddresses.add(record.absoluteAddress);
    }
    for (let i = 0; i < renderOnlyAddresses.length; i++) {
      const absoluteAddress = renderOnlyAddresses[i];
      if (!contextByAbsoluteAddress.has(absoluteAddress)) {
        contextByAbsoluteAddress.set(absoluteAddress, null);
      }
    }
    const processBindings: IBindingInfo[] = [];
    const propagationContextByBinding = new Map<IBindingInfo, IPropagationContext | null>();
    contextByAbsoluteAddress.forEach((context, absoluteAddress) => {
      if (context !== null && context.hop >= MAX_PROPAGATION_HOPS) {
        // hop 上限超過: この transaction の未処理 record だけを quarantine する。
        // 既に適用した値は戻さず、updater から例外は投げない（設計書 §4 規則 6）。
        console.error(`[@wcstack/state] propagation hop limit exceeded; update record quarantined.`, {
          path: absoluteAddress.absolutePathInfo.pathInfo.path,
          transactionId: context.transactionId,
          hop: context.hop,
          maxHops: MAX_PROPAGATION_HOPS,
        });
        if (devtoolsSink !== null) {
          devtoolsSink({
            type: "propagation:hop-limit",
            absoluteAddress,
            transactionId: context.transactionId,
            hop: context.hop,
          });
        }
        return;
      }
      // peek: バインディングの無いアドレス（リスト置換で enqueue される中間
      // アドレス等）に空エントリを生成・蓄積しない。エントリは単一 binding
      // （通常ケース）か Set（同一アドレスに 2 本以上）のどちらか。
      // 従来台帳 → パターン台帳（リスト行）の順で引く。
      const entry = peekBindingsForAddress(absoluteAddress);
      if (entry === undefined) {
        return;
      }
      if (entry instanceof Set) {
        for(const binding of entry) {
          if (binding.replaceNode.isConnected === false) {
            // 切断されているバインディングは無視
            continue;
          }
          processBindings.push(binding);
          if (context !== null) {
            propagationContextByBinding.set(binding, context);
          }
        }
      } else if (entry.replaceNode.isConnected !== false) {
        processBindings.push(entry);
        if (context !== null) {
          propagationContextByBinding.set(entry, context);
        }
      }
    });
    // drain 終了フック: binding 適用後に dedup 済みバッチを通知する（設計書 §3-2）。
    // testApplyChange も同じ _applyChange を通るため、テストから同期に駆動できる。
    // quarantine された address も state 値は適用済みのため通知対象に含める。
    //
    // try/finally なのは、適用側が throw しても `$watch` / `$streams` restart を
    // 落とさないため。binding 1 本の失敗は applyChangeFromBindings が隔離するので
    // ここへ来るのは $updatedCallback の throw（契約どおり loud に伝播させる）等に
    // 限られるが、そのとき drain フックまで道連れにすると「機構間の順序は固定」
    // （README の 3 層表）が黙って破れる。例外は握らない ＝ 伝播は維持する。
    try {
      const applyBindings = (): void => {
        // 遷移越しに後で走っても、このバッチの深さで印を付ける（閉包で持つ）。throw しても必ず下ろす —
        // 下ろし忘れると、以後の無関係な書き込みが全部この連鎖の続きに数えられる
        applyingDepth = depth + 1;
        try {
          // context が無い場合は従来どおり 1 引数で呼ぶ（呼び出し契約の互換維持）
          if (propagationContextByBinding.size > 0) {
            applyChangeFromBindings(processBindings, propagationContextByBinding);
          } else {
            applyChangeFromBindings(processBindings);
          }
        } finally {
          applyingDepth = -1;
        }
      };
      // View transition 参加点（docs/view-transition-design.md §7.2）。arbiter が
      // 居なければ runTransition はその場で applyBindings を呼び、undefined を返す
      // ＝ 従来と完全に同じ同期適用。SSR では遷移そのものを持たない（G5）。
      //
      // 適用する binding が 0 本のバッチは arbiter へ渡さない。書き込みはバインドの
      // 有無に関わらず enqueue される（setByAddress）ため、headless なパス
      // （`$watch` 専用・`$streams` の内部状態・リスト置換の中間アドレス）への
      // 書き込みだけでもここへ到達する。それでページ全体をスナップショットするのは
      // 無駄なだけでなく、既定の mode="latest" では「アニメーションすべき DOM 変更が
      // 無い遷移」が実行中の本物の遷移をスキップしてしまう（ルート遷移が毎回途中で
      // 切れる／active が空撃ちで振動する）。
      if (depth > MAX_RENDER_CHAIN_DEPTH && processBindings.length > 0) {
        // 描画起点の連鎖の打ち切り（#338）: このバッチの binding を適用しない ＝ 適用が書かないので連鎖が
        // 止まる。値は巻き戻さず、drain 終了リスナーには通常どおり通知する（hop 上限の quarantine と同じ
        // 姿勢）。適用するものが無いバッチは連鎖がそこで自然に終わるので報告しない — hop 上限が全部を
        // quarantine したバッチもここへは来ない（報告は 1 つの機構から 1 回）。
        // `$watch` / `$scan` を挟む循環（#353）は、適用を止めてもリスナーの書き込みが深さを引き継いで次のバッチを
        // 作る。報告は連鎖が初めて越えたバッチ（深さは 1 バッチに 1 段までしか伸びないので上限 + 1）だけにし、
        // 引き継ぐ深さを 1 つ進めて、続くバッチは報告せずに適用しない
        if (depth++ === MAX_RENDER_CHAIN_DEPTH + 1) {
          // パスで畳む（行ごとのアドレスが同じパスで並ぶと、循環しているパスが読み取りにくい）
          const paths = [...new Set(Array.from(landedAddresses, (absAddress) => absAddress.absolutePathInfo.pathInfo.path))];
          console.error(
            `[@wcstack/state] render chain depth limit exceeded; bindings for this batch were not applied.`,
            { maxDepth: MAX_RENDER_CHAIN_DEPTH, paths },
          );
          if (devtoolsSink !== null) {
            devtoolsSink({ type: "state:render-chain-limit", maxDepth: MAX_RENDER_CHAIN_DEPTH, paths });
          }
        }
      } else if (inSsr() || processBindings.length === 0) {
        applyBindings();
      } else {
        const pending = runTransition("state", applyBindings);
        if (pending !== undefined) {
          pending.catch(reportDeferredApplyFailure);
        }
      }
    } finally {
      // バッチ中に溜めたリスト差分基準を確定する。notifyUpdateBatchListeners より先に
      // 置くのは、リスナー（$watch / $streams restart）の中で走る書き込みが
      // 「このバッチの結果」を基準として見るべきだから。
      endStateListBaselineBatch();
      // リスナーの書き込みは描画連鎖を伸ばしも数え直させもせず、このバッチの深さを引き継ぐ（applyingDepth の
      // 説明）。リスナーは throw しない契約（内部バグだけ）なので finally で包まない — 残っても次の drain が戻す
      applyingDepth = depth;
      notifyUpdateBatchListeners(landedAddresses);
      applyingDepth = -1;
    }
  }

}

// コンストラクタは空でフィールド初期化だけ（純粋な割り当て）。バンドラが未使用時に落とせるよう
// 明示する: ヘルパーだけの import（defineState / 型 / version）にランタイムを残さない
const updater = /*#__PURE__*/ new Updater();

export function getUpdater(): Updater {
  return updater;
}

// テスト用にprivateメソッドを公開
export const __private__ = {
  Updater,
  reportDeferredApplyFailure,
};
