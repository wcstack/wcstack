/**
 * watch/watchRuntime.ts
 *
 * `$watch` の発火（docs/state-watch-hook-design.md §3 / §7）。
 *
 * updater の drain 終了フックに 1 つだけリスナーを登録し、バッチに載った絶対アドレスと
 * 宣言済み watch パスを突き合わせて発火する。**binding の有無に関係なくバッチへ載る**ので、
 * これが headless 購読の実体になる（binding 駆動の `$updatedCallback` との違い）。
 *
 * 実行順序（設計書 §3-2）:
 * - 機構間は優先度で固定（`$updatedCallback` → `$scan` → `$watch` → `$streams` restart）。
 *   `$updatedCallback` が先なのは binding 適用ループの内側で呼ばれる構造的必然。
 *   `$scan` の `from` / `resetOn` は同じリスナーの中で `$watch` より先に畳んで書く
 *   （docs/state-scan-design.md D11 / D18）。
 * - watch ハンドラ間は `$watch` の宣言順（entry.order）。利用者が順序に意思を持てる唯一の層。
 * - 同一パスの複数行は indexes 昇順。
 *
 * 収集と発火を 2 相に分ける理由:
 * 1. ハンドラ内の書き込みが registry / active 集合を同期的に変えうる（`_state` 再 set・切断）
 *    ため、発火直前に live 再チェックが要る（`$streams` の restart hits と同型）。
 * 2. 上記の順序規約のために hits をソートする必要がある（バッチの反復順は enqueue 順）。
 */

import { absoluteAddressOf } from "../address/liftAddress";
import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import { MAX_WATCH_CHAIN_DEPTH, WATCH_LISTENER_PRIORITY } from "../define";
import { devtoolsSink } from "../devtools/sink";
import { getScopedIndexes } from "../list/wildcardLevel";
import type { IStateProxy } from "../proxy/types";
import { registerUpdateBatchListener } from "../updater/updater";
import { beginWatchFiring, consumeWatchChainDepth, endWatchFiring } from "./chainDepth";
import { getComputedSnapshot, setComputedSnapshot } from "./computedSnapshots";
import { clearPrevValues, getPrevValue } from "./prevValues";
import { hasRetiredRow, selectLandedRows } from "./rowLanding";
import { addActiveWatchStateElement, getActiveWatchStateElements, getVolumeWatchEntries, getWatchEntries } from "./watchRegistry";
import { hasScanDrainWork } from "../scan/scanRegistry";
import { commitScanPlans, discardSkippedScanResets, planScansOnUpdateBatch } from "../scan/scanRuntime";
import type { IWatchEntry } from "./types";

interface IWatchHit {
  readonly stateElement: IStateElement;
  readonly entry: IWatchEntry;
  readonly absAddress: IAbsoluteStateAddress;
  readonly indexes: number[];
}

/**
 * この stateElement の `$watch` を有効化する（`State.connectedCallback` ／接続中の
 * `_state` 再 set から呼ばれる。無効化は `clearWatchRegistry`）。
 *
 * `addActiveWatchStateElement` の薄いラッパではなく、**State が runtime を import する
 * 経路をここに一本化する**意味がある: drain リスナーの登録はこのモジュールの
 * 初期化副作用なので、registry だけを import すると発火機構ごと落ちる。
 * `$streams` の `startStreams` と対称の位置づけ。
 *
 * **宣言が 1 つも無ければ active 集合に入れない**（`startStreams` の
 * `entries.size === 0` early return と同型）。ここを無条件にすると active 集合が
 * 「接続中の全 `<wcs-state>`」になり、`fireWatchOnUpdateBatch` の early return が
 * 実アプリで効かなくなる ＝ `$watch` 未使用アプリの drain にも収集ループが乗る
 * （ゼロコスト契約、設計書 §10 ／ 実装計画 P16）。
 *
 * `$scan` の `from` / `resetOn` も同じ drain リスナーで発火するので、それだけを宣言した
 * state も発火対象に載せる（docs/state-scan-design.md D11）。
 */
export function startWatch(stateElement: IStateElement): void {
  if (getWatchEntries(stateElement).size === 0 && getVolumeWatchEntries(stateElement).size === 0 && !hasScanDrainWork(stateElement)) {
    return;
  }
  addActiveWatchStateElement(stateElement);
  primeComputedWatches(stateElement);
}

/**
 * watch 対象の computed（getter）を 1 回評価する（設計書 §5-2 の eager 化、C-3）。
 *
 * これが要るのは、getter の依存（dynamicDependency）が**評価時にしか張られない**ため。
 * 一度も評価されていない getter は依存グラフに載らず、依存の書き込みが walkDependency で
 * そのパスへ到達しないので、バッチにも載らず watch が永久に発火しない。ここで 1 回
 * 読むことで依存が張られ、同時に `prev` の初期スナップショットが埋まる。
 *
 * **これが「watch した getter は lazy でなくなる」の実体**であり、設計書 §5-2 で
 * 規範として明記している副作用（毎バッチ評価・例外の表面化・依存の再登録）の起点。
 *
 * ワイルドカードを含む getter パス（`items.*.tax` など）は対象外: 初回評価に行ごとの
 * indexes が要り、全行評価は宣言しただけでリスト全体を舐めることになる。この形は
 * 「DOM にバインドされていれば発火する」ままとし、§5-3 に制約として書く。
 */
function primeComputedWatches(stateElement: IStateElement): void {
  // 宣言（watch か scan）が 1 つ以上あることは startWatch が保証済み。scan だけなら targets は空
  const targets: IWatchEntry[] = [];
  for (const entry of getWatchEntries(stateElement).values()) {
    if (isScalarComputed(stateElement, entry)) {
      targets.push(entry);
    }
  }
  for (const entries of getVolumeWatchEntries(stateElement).values()) {
    for (const entry of entries) {
      if (isScalarComputed(stateElement, entry)) {
        targets.push(entry);
      }
    }
  }
  if (targets.length === 0) {
    // getter を watch していないなら createState ごと省く（宣言の大半はこちら）
    return;
  }
  stateElement.createState("readonly", (state) => {
    for (const entry of targets) {
      try {
        // ワイルドカードを含まない watch パスなので、listIndex は常に null
        setComputedSnapshot(stateElement, absoluteAddressOf(stateElement, entry.pathInfo, null), state[entry.path]);
      } catch (e) {
        // 初回評価の throw は接続を巻き添えにしない（発火時と同じ隔離方針、§7-1）
        reportWatchError(stateElement, entry.path, "prime", e);
      }
    }
  });
}


/**
 * 前回評価値のスナップショット台帳（computedSnapshots）に載せる entry か。
 *
 * ワイルドカードを含む getter を**除く**のが要点。除かないと台帳のキーが行ごとの
 * 絶対アドレス（＝ listIndex を強参照）になり、prune 経路が `_state` 再 set しか
 * 無いため、行が入れ替わり続けるページで単調増加する（リスト置換 5 回で 2→10 件を実測）。
 * そもそもワイルドカード getter は eager 化の対象外（設計書 §5-3）なので、
 * 「初回評価もしない・前回値も持たない」で primeComputedWatches と対称になる。
 * この形の `prev` は常に undefined（getter は setByAddress を通らない）。
 */
function isScalarComputed(stateElement: IStateElement, entry: IWatchEntry): boolean {
  return entry.pathInfo.wildcardCount === 0 && stateElement.getterPaths.has(entry.path);
}

/**
 * throw を報告する（設計書 §7-1）。
 *
 * `console.error` だけだと **devtools からは「静かに握られた失敗」が見えない**。
 * watch は drain フックを `$streams` と共有しており、例外を watch 側で閉じるのが
 * 前提なので、閉じた事実をここで観測可能にしておく必要がある。
 * イベント生成は必ず `devtoolsSink !== null` の内側で行う（sink のコスト規範）。
 */
const WATCH_ERROR_SUBJECT: Readonly<Record<"prime" | "evaluate" | "handler", string>> = {
  prime: "initial evaluation of",
  evaluate: "evaluation of",
  handler: "handler for",
};

function reportWatchError(
  stateElement: IStateElement,
  path: string,
  phase: "prime" | "evaluate" | "handler",
  error: unknown,
): void {
  console.error(`[@wcstack/state] $watch ${WATCH_ERROR_SUBJECT[phase]} "${path}" threw.`, error);
  if (devtoolsSink !== null) {
    devtoolsSink({
      type: "state:watch-error",
      phase,
      path,
      error,
    });
  }
}

function fireWatchOnUpdateBatch(batch: ReadonlySet<IAbsoluteStateAddress>): void {
  const activeStateElements = getActiveWatchStateElements();
  try {
    if (activeStateElements.size === 0) {
      // watch 未使用アプリの drain に配列・イテレータ割り当てのコストを載せない。
      // ここも finally を通す: 宣言済みの state が切断されている間（active からは
      // 外れるが watchPaths は残る）の書き込みで台帳に旧値が積まれるため、
      // クリアを早期 return の外に置くと次のバッチどころか永久に残る。
      // 書き込みの後・drain の前に切断された state の `on` scan の保留 reset も、このバッチでは
      // 発火しないので捨てる（scan/eventReset.ts）。
      discardSkippedScanResets(batch, activeStateElements);
      return;
    }
    const depth = consumeWatchChainDepth();
    if (depth > MAX_WATCH_CHAIN_DEPTH) {
      // 打ち切るのは同じリスナーの発火（`$scan` の from / resetOn と `$watch`）のみ。
      // 値と binding 適用は巻き戻さない（伝播 hop 上限超過時の quarantine と同じ姿勢、§7-2）。
      // `on` scan の保留 reset もこのバッチでは効かせない（`from` の scan が reset しないのと揃える）。
      discardSkippedScanResets(batch, null);
      const paths = Array.from(batch, (absAddress) => absAddress.absolutePathInfo.pathInfo.path);
      console.error(
        `[@wcstack/state] $watch chain depth limit exceeded; $scan folds and $watch handlers for this batch were skipped.`,
        { maxDepth: MAX_WATCH_CHAIN_DEPTH, paths },
      );
      if (devtoolsSink !== null) {
        devtoolsSink({ type: "state:watch-chain-limit", maxDepth: MAX_WATCH_CHAIN_DEPTH, paths });
      }
      return;
    }

    // `$scan` の from / resetOn を `$watch` より先に畳んで書く（docs/state-scan-design.md D11 / D18）。
    // scan の書き込みは次のバッチに乗るので、この drain の `$watch` の収集には影響しない。同じ drain の
    // `$watch` ハンドラは書いた後の出力を読み、ハンドラが出力へ書いた値はそのまま残る。
    commitScanPlans(planScansOnUpdateBatch(batch, activeStateElements, depth), activeStateElements, depth);
    fireWatchHits(batch, activeStateElements, depth);
  } finally {
    // 旧値台帳はこの drain 限りのもの。次のバッチへ持ち越さない（§4-1）。
    clearPrevValues();
  }
}

/** バッチの `$watch` ヒットを集めて（収集フェーズ）、宣言順・indexes 昇順に発火する（発火フェーズ）。 */
function fireWatchHits(
  batch: ReadonlySet<IAbsoluteStateAddress>,
  activeStateElements: ReadonlySet<IStateElement>,
  depth: number,
): void {
  // --- 収集フェーズ ---
  const hits: IWatchHit[] = [];
  for (const absAddress of batch) {
    // stateElement 参照で引く。TreePath は
    // stateElement 単位でキャッシュされるので、同名 state が複数の rootNode に
    // 居ても取り違えない（address/TreePath.ts）。他 state のアドレスは
    // ここで自然に落ちる ＝ 越境しない（設計 D8）。
    const stateElement = absAddress.absolutePathInfo.stateElement;
    if (!activeStateElements.has(stateElement)) {
      continue;
    }
    const path = absAddress.absolutePathInfo.pathInfo.path;
    const own = getWatchEntries(stateElement).get(path);
    const fromVolumes = getVolumeWatchEntries(stateElement).get(path);
    if (typeof own === "undefined" && typeof fromVolumes === "undefined") {
      continue;
    }
    const matched: IWatchEntry[] = typeof own === "undefined" ? [] : [own];
    if (typeof fromVolumes !== "undefined") {
      matched.push(...fromVolumes);
    }
    for (const entry of matched) {
      let indexes: number[] = [];
      if (entry.pathInfo.wildcardCount > 0) {
        if (absAddress.listIndex === null) {
          // ワイルドカードパスなのに行が特定できないヒット（リストの依存展開で載る
          // 中間アドレス等）。indexes を空のまま発火すると cur の解決（$resolve）が
          // 「indexes 不足」で throw し、例外隔離に落ちて console.error だけが残る。
          // 行が定まらない以上ハンドラに渡せる意味が無いので、収集段階で落とす。
          continue;
        }
        indexes = getScopedIndexes(absAddress.listIndex, entry.pathInfo.wildcardCount);
      }
      hits.push({ stateElement, entry, absAddress, indexes });
    }
  }
  if (hits.length === 0) {
    return;
  }
  hits.sort(compareHits);
  const landed = selectWatchLandings(hits);

  // --- 発火フェーズ ---
  beginWatchFiring(depth);
  try {
    for (const hit of landed) {
      // 先行ハンドラが同期的に切断や `_state` 再 set を行い得るため、発火直前に
      // 「まだ active か」「entry が現行 registry のものか」を再確認する。
      if (!activeStateElements.has(hit.stateElement)) {
        continue;
      }
      const stillOwn = getWatchEntries(hit.stateElement).get(hit.entry.path) === hit.entry;
      const stillVolume = getVolumeWatchEntries(hit.stateElement).get(hit.entry.path)?.includes(hit.entry) === true;
      if (!stillOwn && !stillVolume) {
        continue;
      }
      fireOne(hit);
    }
  } finally {
    endWatchFiring();
  }
}

/**
 * ワイルドカードの watch の行の着地を、いまのリストの位置 1 つにつき 1 つに絞る（`$scan` の `from` と
 * 同じ選別 — watch/rowLanding.ts・#274）。`hits` は compareHits でソート済みで、戻り値もその順を保つ。
 *
 * 位置を引くにはリストを読むので、引くのは退役した行を含むヒットがあるか、同じ entry・同じ indexes の
 * ヒットが並ぶ（ソート済みなので隣り合う）entry だけ。行の値を書くだけのバッチ（大多数）は
 * WeakSet の引きだけで抜ける。
 */
function selectWatchLandings(hits: IWatchHit[]): IWatchHit[] {
  let entries: Set<IWatchEntry> | null = null;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (hit.entry.pathInfo.wildcardCount === 0) {
      continue;
    }
    const previous = hits[i - 1];
    // ワイルドカードの hit は収集の段階で listIndex を持つものに限っている
    if (hasRetiredRow(hit.absAddress.listIndex!)
      || (previous?.entry === hit.entry && isSameIndexes(previous.indexes, hit.indexes))) {
      (entries ??= new Set()).add(hit.entry);
    }
  }
  if (entries === null) {
    return hits;
  }
  const dropped = new Set<IWatchHit>();
  for (const entry of entries) {
    // entry は 1 つの state 要素の registry に属するので、group の state 要素は 1 つ
    const group = hits.filter((hit) => hit.entry === entry);
    const stateElement = group[0].stateElement;
    try {
      stateElement.createState("readonly", (state) => {
        const kept = new Set(selectLandedRows(state, entry.pathInfo, group));
        for (const hit of group) {
          if (!kept.has(hit)) {
            dropped.add(hit);
          }
        }
      });
    } catch (e) {
      // 位置を引く読み（リストのパスの getter など）が throw した。同じリストを通る cur も読めないので、
      // この entry のヒットは発火せず、評価の失敗として 1 回報告する（他の watch は続行する）
      reportWatchError(stateElement, entry.path, "evaluate", e);
      for (const hit of group) {
        dropped.add(hit);
      }
    }
  }
  return hits.filter((hit) => !dropped.has(hit));
}

/** 同じ entry の hit どうし（indexes の長さは等しい） */
function isSameIndexes(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * 層 2（宣言順）→ 層 3（indexes 昇順）の順に比較する（設計書 §3-3）。
 */
function compareHits(a: IWatchHit, b: IWatchHit): number {
  if (a.entry.order !== b.entry.order) {
    return a.entry.order - b.entry.order;
  }
  const length = Math.min(a.indexes.length, b.indexes.length);
  for (let i = 0; i < length; i++) {
    if (a.indexes[i] !== b.indexes[i]) {
      return a.indexes[i] - b.indexes[i];
    }
  }
  return a.indexes.length - b.indexes.length;
}

/**
 * ハンドラ 1 つを発火する。**例外はここで閉じる**（設計書 §7-1）。
 *
 * drain リスナーの throw は握りつぶさない契約（updater.ts）なので、watch 側で捕まえないと
 * 1 つのユーザー例外が他の watch と `$streams` の restart を巻き添えにする。
 * `$connectedCallback` / `$updatedCallback` の loud fail とは意図的に異なる扱い。
 *
 * 報告は throw 元で分ける: `cur` の解決（watch した getter の強制評価 ＝ §5-2 の副作用 b）と
 * ハンドラ本体では原因も直し方も違うため、同じ文言に丸めない。
 */
function fireOne(hit: IWatchHit): void {
  const { stateElement, entry, absAddress, indexes } = hit;
  // スカラ getter は setByAddress を通らないので旧値台帳に載らない。前回評価値の
  // スナップショット（バッチを跨いで生きる別台帳）から prev を取る（§5-2）。
  const isComputed = isScalarComputed(stateElement, entry);
  try {
    stateElement.createState("writable", (state) => {
      let cur: unknown;
      try {
        // 強制評価はここ。dirty なら再計算され、その結果が cur になる
        cur = readCurrentValue(state, entry, indexes);
      } catch (e) {
        // cur が得られない以上ハンドラは呼べない。次の hit へ進む
        reportWatchError(stateElement, entry.path, "evaluate", e);
        return;
      }
      const prev = isComputed ? getComputedSnapshot(stateElement, absAddress) : getPrevValue(absAddress);
      if (isComputed) {
        // ハンドラ本体が throw しても次回の prev は「今回の評価値」であるべきなので、
        // handler 呼び出しより前に更新する
        setComputedSnapshot(stateElement, absAddress, cur);
      }
      // 正常発火の観測（設計書 §11 の予約イベント・配線カバレッジの実測面）。
      // 値は載せない。イベント生成は sink 接続時のみ（ゼロコスト契約）。
      // stateElement は発火元ツリーの識別（protocol v2 追補）— これが無いと
      // 複数ツリーが同名 watch パスを宣言するページで実測が合算される。
      if (devtoolsSink !== null) {
        devtoolsSink({ type: "state:watch-fired", path: entry.path, stateElement });
      }
      entry.handler.call(state, cur, prev, ...indexes);
    });
  } catch (e) {
    reportWatchError(stateElement, entry.path, "handler", e);
  }
}

function readCurrentValue(state: IStateProxy, entry: IWatchEntry, indexes: number[]): unknown {
  if (entry.pathInfo.wildcardCount === 0) {
    return state[entry.path];
  }
  // ワイルドカードを含むパスは素の読みでは解決できない。getScopedIndexes が返した列は
  // そのまま $resolve の引数として使える（list/wildcardLevel.ts の往復契約）。
  return state.$resolve(entry.path, indexes);
}

// 優先度で `$streams` の restart より先に固定する（設計書 §3-2 層 1）。import 順には依存しない。
registerUpdateBatchListener(fireWatchOnUpdateBatch, WATCH_LISTENER_PRIORITY);

export const __private__ = {
  fireWatchOnUpdateBatch,
  compareHits,
};
