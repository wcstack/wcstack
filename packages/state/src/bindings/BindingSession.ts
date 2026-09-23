import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { EVENT_TOKEN_NAMESPACE, MODIFIER_READONLY } from "../define";
import { IAbsoluteStateAddress } from "../address/types";
import { getTreePath } from "../address/TreePath";
import { ITreePath } from "../address/types";
import { clearAbsoluteStateAddressByBinding, getAbsoluteStateAddressByBinding, resolveBindingRootNode } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress, addBindingByPattern, removeBindingByAbsoluteStateAddress, removeBindingByPattern } from "../binding/getBindingSetByAbsoluteStateAddress";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { getLastListValueByAbsoluteStateAddress, hasLastListValueByAbsoluteStateAddress, setLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { getStateListBaseline, hasStateListBaseline, setStateListBaseline } from "../list/stateListBaseline";
import { IListIndex } from "../list/types";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { config } from "../config";
import { filterListKey } from "../binding/filterKey";
import { detachCheckboxEventHandler, attachCheckboxEventHandler } from "../event/checkboxHandler";
import { detachEventTokenHandler, attachEventTokenHandler } from "../event/eventTokenHandler";
import { detachEventHandler, attachEventHandler } from "../event/handler";
import { detachRadioEventHandler, attachRadioEventHandler } from "../event/radioHandler";
import { detachTwowayEventHandler, attachTwowayEventHandler, addTwowayValueObserver } from "../event/twowayHandler";
import { isPossibleTwoWay } from "../event/isPossibleTwoWay";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry, upgradeCustomElement } from "../platform/customElementRegistry";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { IBindingInfo } from "../types";
import { consumeObserverSkipOnAdd, consumeObserverSkipOnRemove, consumeObserverSkipRemovedChildren, decrementPendingObservation, hasPendingObservation, incrementPendingObservation } from "./observerSkip";
import { DefinitionCoordinator, getDefinitionCoordinator } from "./DefinitionCoordinator";
import { commitProducerValue, hasInitialSyncModifier, IInitialSyncPolicy, ResolvedInitialAuthority, resolveInitialAuthority, resolveInitialSyncPolicy } from "./initialSync";
import { replaceToReplaceNode } from "./replaceToReplaceNode";
import type { IRowPlan } from "../structural/types";

export type BindingPhase =
  | "discovered"
  | "waiting-definition"
  | "ready-to-attach"
  | "attaching"
  | "synchronizing"
  | "active"
  | "failed"
  | "disposed";

export interface IBindingRecord {
  readonly id: number;
  readonly info: IBindingInfo;
  readonly generation: number;
  phase: BindingPhase;
  /**
   * 追加の後始末クロージャ（radio/checkbox/observer/定義キャンセル等の希少ケース）。
   * 頻出の後始末（イベント detach・双方向 detach・アドレス台帳解除）はクロージャで
   * なく record のフラグ/フィールドから runTeardowns がデータ駆動で実行するため、
   * 大多数の record では null のまま（行あたり Set×5 + クロージャ×10 の割当を排除）。
   */
  teardowns: Set<() => void> | null;
}

interface IBindingOptions {
  registerAddress: boolean;
  registerPathInfo: boolean;
  applyOnReconnect: boolean;
}

interface IInternalBindingRecord extends IBindingRecord {
  /**
   * generation はプラン行のプール再利用（record オブジェクト再利用）で更新するため
   * 内部表現では書き込み可能にする（IBindingRecord 公開面は readonly のまま）
   */
  generation: number;
  readonly session: BindingSession;
  readonly anchor: Node;
  readonly options: IBindingOptions;
  address: IAbsoluteStateAddress | null;
  /**
   * パターン索引台帳（(absolutePathInfo, listIndex) 2 段キー）への登録。リスト行の
   * binding は address を intern せずこちらに登録する。address とは排他。
   */
  patternPathInfo: ITreePath | null;
  patternListIndex: IListIndex | null;
  pendingDefinitions: number;
  initialPolicy: IInitialSyncPolicy | null;
  resolvedAuthority: ResolvedInitialAuthority | null;
  initialSettled: boolean;
  /**
   * 最初の shouldApplyState 相談（= 初期 state sweep / 初回 render の選別）を
   * 消費済みか。authority は初期同期のみを支配する（09 §3.6）ため、初回相談は
   * authority で答え、以降の定常 apply は output-only 契約と connect-snapshot
   * 未解決だけをブロックする。
   */
  initialApplyDone: boolean;
  /** initialPolicy.outputOnly のミラー（settle 時確定・定常ゲートの分岐を総域にする） */
  outputOnlyMember: boolean;
  observationPending: boolean;
  eventSequence: number;
  hasProducerValue: boolean;
  producerValue: unknown;
  /** attachEventHandler 済み（dispose 時に detachEventHandler をデータ駆動実行） */
  eventAttached: boolean;
  /** attachTwowayEventHandler 済み（dispose 時に detachTwowayEventHandler をデータ駆動実行） */
  twowayAttached: boolean;
}

interface IDeferredDefinition {
  readonly node: Node;
  active: boolean;
  cancel: (() => void) | null;
}

interface IObservableRoot extends Node {
  contains(other: Node | null): boolean;
}

let nextRecordId = 0;
let nextGeneration = 0;

// プラン行の帳簿は束縛ごとの record ではなく行に 1 つの record（slot 配列）で持つ
// （行ランタイム設計 R3）。phase は slot ごとの SLOT_*、フラグは FLAG_* のビット。
const SLOT_ACTIVE = 0;
const SLOT_DISPOSED = 1;
const SLOT_FAILED = 2;
const FLAG_INITIAL_APPLY_DONE = 1;
const FLAG_EVENT_ATTACHED = 2;
const SLOT_PHASE_NAMES: readonly BindingPhase[] = ["active", "disposed", "failed"];
interface IRowRecord {
  readonly id: number;
  /** この行を持つ共有 session（行 → session の逆引き。設計 R3） */
  readonly session: BindingSession;
  generation: number;
  readonly plan: IRowPlan;
  readonly bindings: readonly IBindingInfo[];
  /** activate が address 登録を昇格したか（従来の record.options.registerAddress に相当、行で共有） */
  registered: boolean;
  /** SLOT_* per slot */
  readonly phases: number[];
  /** FLAG_* bits per slot */
  readonly flags: number[];
  readonly addresses: (IAbsoluteStateAddress | null)[];
  readonly patternPathInfos: (ITreePath | null)[];
  readonly patternListIndexes: (IListIndex | null)[];
}
// 束縛 → その行の record（record が共有 session を知っている。設計 R3）
const rowByBinding = new WeakMap<IBindingInfo, IRowRecord>();
// 行 slot に振った record id（`getRecord` — 検査・テスト専用の経路でしか作られない）
const rowSlotIds = new WeakMap<IRowRecord, number[]>();

const recordByBinding = new WeakMap<IBindingInfo, IInternalBindingRecord>();
const sessionByRoot = new WeakMap<Node, BindingSession>();

// binding の構造キーは不変フィールドのみから決まる。リスト行の初期化では同一 binding に
// 対し remember() が2回呼ばれる（createContent 内 initializeBindingsByFragment と
// activateContent の registerAddress 目的の initialize）ため、2度目の文字列生成を避けるべく
// binding 単位でメモ化する。プロファイル上 bindingKey は create-10k の JS 自己時間で上位。
const bindingKeyByBinding = new WeakMap<IBindingInfo, string>();

// node → その node に関心を持つ session（anchor として binding を覚えている、
// または定義待ちタスクを抱えている）。BindingOwner は mutation で増減した
// サブツリーを1回だけ走査し、ここに登録された session だけへ per-node 配送する。
// 全 session ブロードキャストだと、リスト行の逐次 append などで
// 「session 数 × 変異ノード数」の O(n²) ファンアウトになるため、その正本台帳。
// 大多数の node は関心 session が1つなので単一値で持ち、2つ目から Set に昇格する。
const interestedSessionsByNode = new WeakMap<Node, BindingSession | Set<BindingSession>>();

function addInterestedSession(node: Node, session: BindingSession): void {
  const current = interestedSessionsByNode.get(node);
  if (typeof current === "undefined") {
    interestedSessionsByNode.set(node, session);
    return;
  }
  if (current === session) return;
  if (current instanceof Set) {
    current.add(session);
    return;
  }
  interestedSessionsByNode.set(node, new Set([current, session]));
}

/**
 * このノードに既にバインドが張られているか。
 *
 * binder プロトコル（`bind()`）の冪等判定に使う。`remember` が binding ごとに
 * `addInterestedSession(binding.replaceNode, …)` を呼ぶので、バインド済みノードは
 * 必ずこの台帳に載っている。新しい台帳を足さずに済むぶん、二重管理の齟齬が無い。
 */
export function hasInterestedSession(node: Node): boolean {
  return interestedSessionsByNode.has(node);
}

function forEachInterestedSession(node: Node, callback: (session: BindingSession) => void): void {
  const current = interestedSessionsByNode.get(node);
  if (typeof current === "undefined") return;
  if (current instanceof Set) {
    for (const session of Array.from(current)) callback(session);
    return;
  }
  callback(current);
}

function forEachInclusive(root: Node, callback: (node: Node) => void): void {
  callback(root);
  // 葉ノード（fragment 一括挿入時のテキスト・空セル等が大多数）では
  // Array.from(childNodes) の空配列アロケーションを避ける。callback が子を
  // 追加しうるため firstChild は callback 後に判定する（従来と同一意味論）。
  if (root.firstChild === null) return;
  for (const child of Array.from(root.childNodes)) {
    forEachInclusive(child, callback);
  }
}

function isObservableRoot(value: unknown): value is IObservableRoot {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Node;
  return node.nodeType === 9 || (node.nodeType === 11 && "host" in (node as object));
}

function observableRootFor(node: Node): IObservableRoot | null {
  const root = node.getRootNode();
  return isObservableRoot(root) ? root : null;
}

class BindingOwner {
  private readonly observer: MutationObserver | null;

  constructor(readonly root: IObservableRoot) {
    const Observer = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    this.observer = typeof Observer === "function"
      ? new Observer((mutations) => this.handleMutations(mutations))
      : null;
    this.observer?.observe(root, { childList: true, subtree: true });
  }

  private handleMutations(mutations: MutationRecord[]): void {
    const removed: Node[] = [];
    const added: Node[] = [];
    for (let m = 0; m < mutations.length; m++) {
      const mutation = mutations[m];
      const removedNodes = mutation.removedNodes;
      // 削除された子がすべて framework の削除（消去が親に件数で印を付けた）なら record ごと飛ばし、
      // ノードごとの印には触れない
      if (removedNodes.length === 0 || !consumeObserverSkipRemovedChildren(mutation.target, removedNodes.length)) {
        for (let i = 0; i < removedNodes.length; i++) removed.push(removedNodes[i]);
      }
      const addedNodes = mutation.addedNodes;
      for (let i = 0; i < addedNodes.length; i++) added.push(addedNodes[i]);
    }
    // 走査は owner が1回だけ行い、関心 session が居る node だけを配送・contains
    // 検査へ進める。contains は O(木の深さ) なので、関心の無い node で呼ばない。
    const reconnected: IBindingInfo[] = [];
    for (const subtree of removed) {
      // framework が unmount した削除サブツリーは binding を明示 dispose 済みなので
      // observer 側の冗長走査（forEachInclusive で全 node を歩き handleRemovedNode を
      // 呼ぶ）を丸ごとスキップする。clear/大量 delete のホットスポット短縮。
      if (consumeObserverSkipOnRemove(subtree)) continue;
      forEachInclusive(subtree, (node) => {
        forEachInterestedSession(node, (session) => {
          if (this.root.contains(node)) return;
          session.handleRemovedNode(node);
        });
      });
    }
    for (const subtree of added) {
      // framework がマウントしたサブツリーは record が同期 activate 済みで、追加側
      // 走査の実質の仕事は connect-snapshot 待ちへの配送だけ。待ちがグローバルに
      // 無ければ丸ごとスキップする（待ちがあればマークだけ消費して従来走査に戻す）。
      if (consumeObserverSkipOnAdd(subtree) && !hasPendingObservation()) continue;
      forEachInclusive(subtree, (node) => {
        forEachInterestedSession(node, (session) => {
          if (!this.root.contains(node)) return;
          session.handleAddedNode(node, reconnected);
        });
      });
    }
    if (reconnected.length > 0) applyChangeFromBindings(reconnected);
  }
}

const ownerByRoot = new WeakMap<IObservableRoot, BindingOwner>();

function getBindingOwner(root: IObservableRoot): BindingOwner {
  let owner = ownerByRoot.get(root);
  if (typeof owner === "undefined") {
    owner = new BindingOwner(root);
    ownerByRoot.set(root, owner);
  }
  return owner;
}

function bindingKey(binding: IBindingInfo): string {
  // 引数は型付きの値で書き出す（要件 B9）— `defaults(0)` と `defaults('0')` を取り違えない
  const inFilters = filterListKey(binding.inFilters);
  const outFilters = filterListKey(binding.outFilters);
  return [
    binding.bindingType,
    binding.propName,
    binding.propModifiers.join(","),
    binding.statePathName,
    inFilters,
    outFilters,
    binding.uuid ?? "",
  ].join("\u0000");
}

/*
 * 束縛が状態の台帳へ出入りする経路（行ランタイム設計 R4）。行 slot（registerRowSlot /
 * unregisterRowSlot）と record（registerAddress / runTeardowns / rebindAddresses）が同じ登録・
 * 解除をそれぞれ書き写していたのを 1 箇所にした。登録した形（アドレスか、パターンの
 * pathInfo ＋ listIndex か）は呼び出し側の器（行の slot 配列 / record のフィールド）へ書く —
 * ここで値の組を返すと行ごとに割り当てが増えるため、器は呼び出し側に残す。
 */

/** リスト行: (absolutePathInfo, listIndex) のパターン台帳へ入れる（AbsoluteStateAddress の intern を省く） */
function registerPattern(binding: IBindingInfo, listIndex: IListIndex, knownRoot?: Node | null): ITreePath {
  const stateElement = getStateElement(resolveBindingRootNode(binding, knownRoot));
  if (stateElement === null) {
    raiseError(`No state tree found on this root for binding.`);
  }
  const absolutePathInfo = getTreePath(stateElement, binding.statePathInfo);
  addBindingByPattern(absolutePathInfo, listIndex, binding);
  return absolutePathInfo;
}

/** リスト行でない束縛: 絶対アドレスの台帳へ入れる */
function registerAbsoluteAddress(binding: IBindingInfo, knownRoot?: Node | null): IAbsoluteStateAddress {
  const address = getAbsoluteStateAddressByBinding(binding, knownRoot);
  addBindingByAbsoluteStateAddress(address, binding);
  return address;
}

/**
 * 台帳から外す。`address` が null ならパターン登録（`pathInfo` ＋ `listIndex`）。相対アドレス
 * （getValue）と絶対アドレス（applyChangeToFor / updatedCallback 経由の遅延 intern）のメモは
 * パターン登録でも作られうるので、どちらでも対称にクリアする。
 */
function unregisterFromLedger(
  binding: IBindingInfo,
  address: IAbsoluteStateAddress | null,
  pathInfo: ITreePath | null,
  listIndex: IListIndex | null,
): void {
  if (address !== null) {
    removeBindingByAbsoluteStateAddress(address, binding);
  } else {
    removeBindingByPattern(pathInfo!, listIndex!, binding);
  }
  clearStateAddressByBindingInfo(binding);
  clearAbsoluteStateAddressByBinding(binding);
}

function addRecordTeardown(record: IInternalBindingRecord, teardown: () => void): void {
  if (record.teardowns === null) {
    record.teardowns = new Set();
  }
  record.teardowns.add(teardown);
}

export class BindingSession {
  private readonly records = new Set<IInternalBindingRecord>();
  /**
   * initializeRow で設定される行プラン。非 null のとき activate は
   * スロット整列の高速経路（activatePlanRows）を使う。
   */
  private rowPlan: IRowPlan | null = null;
  /** この session が持つ生きている行（`for` 束縛 1 つにつき session 1 つ、行は複数。設計 R3） */
  private readonly rows = new Set<IRowRecord>();
  // anchor ノードが持つ binding は大多数が 1 本なので単一値で持ち、2 本目から
  // Map（remember 経路のキー照合用）に昇格する（台帳・興味 session と同じ前例）
  private readonly knownBindingsByNode = new WeakMap<Node, IBindingInfo | Map<string, IBindingInfo>>();
  private readonly optionsByBinding = new WeakMap<IBindingInfo, IBindingOptions>();
  private readonly deferredByNode = new WeakMap<Node, Set<IDeferredDefinition>>();
  private readonly deferred = new Set<IDeferredDefinition>();

  constructor(root: Node | null = null) {
    if (root !== null) this.observe(root);
  }

  /**
   * knownRoot: 呼び出し側が root を確定済みのときの per-binding observe 省略。
   *  - undefined: 従来どおり binding ごとに anchor から root を導出して observe
   *  - null: detached fragment 上（createContent）の初期化。observableRootFor が
   *    必ず null を返す状況なので observe（= getRootNode）を丸ごと省略する
   *  - Node: 呼び出し側で owner 保証済み（activate 経由のみ。initialize へは未使用）
   */
  initialize(
    bindings: readonly IBindingInfo[],
    options: Partial<IBindingOptions> = {},
    knownRoot?: Node | null,
  ): IBindingInfo[] {
    const registerAddress = options.registerAddress ?? true;
    const resolvedOptions: IBindingOptions = {
      registerAddress,
      registerPathInfo: options.registerPathInfo ?? registerAddress,
      applyOnReconnect: options.applyOnReconnect ?? true,
    };
    const initialized: IBindingInfo[] = [];
    for (const candidate of bindings) {
      const binding = this.remember(candidate, resolvedOptions);
      const rowRecord = this.rowOf(binding);
      const rowSlot = rowRecord === null ? -1 : rowRecord.bindings.indexOf(binding);
      if (rowRecord !== null && rowRecord.phases[rowSlot] === SLOT_ACTIVE) {
        const row = rowRecord;
        this.observe(binding.replaceNode);
        if (resolvedOptions.registerAddress && row.addresses[rowSlot] === null && row.patternPathInfos[rowSlot] === null) {
          row.registered = true;
          this.registerRowSlot(row, rowSlot);
        }
        continue;
      }
      const existing = recordByBinding.get(binding);
      if (typeof existing !== "undefined" && existing.phase !== "disposed" && existing.phase !== "failed") {
        this.observe(existing.anchor);
        if (resolvedOptions.registerAddress && existing.address === null && existing.patternListIndex === null) {
          existing.options.registerAddress = true;
          this.registerAddress(existing);
        }
        if (existing.phase === "active") this.settleInitialRecord(existing);
        this.settleConnectedSnapshot(existing);
        continue;
      }
      this.start(binding, resolvedOptions, knownRoot);
      initialized.push(binding);
    }
    return initialized.filter((binding) => this.shouldApplyState(binding));
  }

  /**
   * activateContent 専用の再活性化パス。createContent 側の initialize で
   * remember 済みの binding 配列（bindingsByContent がそのまま保持する同一オブジェクト）
   * にだけ使える前提で、remember の再実行（キー照合・options マージ・興味登録）を省き、
   * 必要な仕事だけ行う: 初回活性化はアドレス登録+初期同期、pool 再利用（disposed）は
   * start による再構築、未知の binding は防御的に従来 initialize へ倒す。
   *
   * knownRoot は呼び出し側（applyChangeToFor / applyChangeToIf の apply context）が
   * 確定済みの root。owner（root ごとの MutationObserver）の保証を呼び出しあたり
   * 1 回に集約し、binding ごとの observe（= getRootNode）とアドレス解決の
   * getRootNode を丸ごと省略する。
   */
  activate(bindings: readonly IBindingInfo[], knownRoot: Node): void {
    if (isObservableRoot(knownRoot)) getBindingOwner(knownRoot);
    if (this.rowPlan !== null) {
      this.activatePlanRows(this.rowPlan, bindings, knownRoot);
      return;
    }
    for (const binding of bindings) {
      const record = recordByBinding.get(binding);
      if (typeof record !== "undefined" && record.session === this
        && record.phase !== "disposed" && record.phase !== "failed") {
        if (record.address === null && record.patternListIndex === null) {
          // 初回活性化（owner は冒頭で保証済み）
          record.options.registerAddress = true;
          this.registerAddress(record, knownRoot);
        }
        if (record.phase === "active") this.settleInitialRecord(record);
        this.settleConnectedSnapshot(record);
        continue;
      }
      const options = this.optionsByBinding.get(binding);
      if (typeof options === "undefined") {
        // この session で remember されていない binding（防御）: 従来経路
        this.initialize([binding], { registerAddress: true, registerPathInfo: false, applyOnReconnect: false });
        continue;
      }
      // pool 再利用: record は disposed。活性化要件（アドレス登録）を昇格して再構築
      options.registerAddress = true;
      this.start(binding, options, knownRoot);
    }
  }

  shouldApplyState(binding: IBindingInfo): boolean {
    if (!config.enableDirectionalInitialSync) {
      if (hasInitialSyncModifier(binding)) resolveInitialSyncPolicy(binding);
      return true;
    }
    const row = this.rowOf(binding);
    if (row !== null) {
      const slot = row.bindings.indexOf(binding);
      if (slot >= 0) {
        if (!row.registered) return true;
        if (row.phases[slot] === SLOT_FAILED) return false;
        const planSlot = row.plan.slots[slot];
        if ((row.flags[slot] & FLAG_INITIAL_APPLY_DONE) === 0) {
          row.flags[slot] |= FLAG_INITIAL_APPLY_DONE;
          return planSlot.authority === "state";
        }
        if (planSlot.authority === "state") return true;
        return !planSlot.policy.outputOnly;
      }
    }
    const record = recordByBinding.get(binding);
    if (typeof record === "undefined" || record.session !== this) return true;
    if (!record.options.registerAddress || record.phase === "waiting-definition") return true;
    if (record.phase === "failed") return false;
    if (record.phase === "active") this.settleInitialRecord(record);
    // authority は初期同期のみを支配する（09 §3.6: init=element は「snapshot を
    // state へ入れる」、init=none は「次の変更から扱う」）。settle 後の最初の相談
    // = 初期 state sweep / 初回 render / deferred initial apply の選別なので
    // authority で答え、ここで初期適用を消費する。
    if (!record.initialApplyDone) {
      record.initialApplyDone = true;
      return record.resolvedAuthority === "state";
    }
    if (record.resolvedAuthority === "state") return true;
    // 定常: two-way / input member は authority と無関係に state→element を流す。
    // 恒久ブロックは (1) output-only member の契約（書き込み無意味・DCC/router の
    // conformance が依存）と (2) sync=connect の接続 snapshot が未解決の間
    //（初期競合が未決着のうちは state push が element 初期値を潰しうる）だけ。
    return !record.outputOnlyMember && !record.observationPending;
  }

  /**
   * **検査・テスト専用**（本番の呼び出し元は無い）。行の slot には record オブジェクトが
   * 無いので、呼ぶたびに読み取り専用の合成オブジェクトを作る — ホットパスでは使わないこと。
   *
   * `id` は record の id と同じ通し番号から取る。かつて `row.id * 64 + slot` で合成していたが、
   * 1 行が 64 スロットを超えると別の行の id と衝突した（`row.id` 自身も同じ通し番号なので、
   * 素の record の id とも衝突しうる）。台帳は WeakMap なので本番経路の割り当ては増えない。
   */
  getRecord(binding: IBindingInfo): IBindingRecord | null {
    const row = this.rowOf(binding);
    const slot = row === null ? -1 : row.bindings.indexOf(binding);
    if (row !== null && slot >= 0) {
      let ids = rowSlotIds.get(row);
      if (typeof ids === "undefined") {
        rowSlotIds.set(row, ids = []);
      }
      const id = ids[slot] ?? (ids[slot] = ++nextRecordId);
      return { id, info: binding, generation: row.generation, phase: SLOT_PHASE_NAMES[row.phases[slot]], teardowns: null };
    }
    const record = recordByBinding.get(binding);
    return record?.session === this ? record : null;
  }

  /**
   * teardown を足せるのは record を持つ束縛だけ（設計 R3）。唯一の呼び出し元は
   * `scheduleDeferredApply`（未定義カスタム要素への遅延適用）で、プラン行はカスタム要素を
   * 含み得ないため行 slot には来ない。
   */
  addTeardown(binding: IBindingInfo, teardown: () => void): boolean {
    const record = recordByBinding.get(binding);
    if (typeof record === "undefined" || !this.isAlive(record, record.generation)) {
      return false;
    }
    addRecordTeardown(record, teardown);
    return true;
  }

  deferUntilDefined(
    node: Node,
    tagName: string,
    callback: () => void,
    reject: (error: unknown) => void = () => undefined,
  ): () => void {
    const registry = getCustomElementRegistry(node);
    if (registry === null) {
      raiseError(`CustomElementRegistry is unavailable for <${tagName}>.`);
    }
    this.observe(node);
    addInterestedSession(node, this);
    const task: IDeferredDefinition = { node, active: true, cancel: null };
    let tasks = this.deferredByNode.get(node);
    if (typeof tasks === "undefined") {
      tasks = new Set();
      this.deferredByNode.set(node, tasks);
    }
    tasks.add(task);
    this.deferred.add(task);
    const finish = (): boolean => {
      if (!task.active) return false;
      task.active = false;
      tasks?.delete(task);
      this.deferred.delete(task);
      return true;
    };
    task.cancel = getDefinitionCoordinator(registry).wait(
      tagName,
      () => {
        if (!finish()) return;
        try {
          upgradeCustomElement(registry, node);
          callback();
        } catch (error) {
          reject(error);
        }
      },
      (error) => {
        if (!finish()) return;
        reject(error);
      },
    );
    return () => {
      if (!finish()) return;
      task.cancel?.();
    };
  }

  disposeBinding(binding: IBindingInfo): void {
    const row = this.rowOf(binding);
    if (row !== null) {
      const slot = row.bindings.indexOf(binding);
      if (slot >= 0) {
        this.disposeRowSlot(row, slot);
        return;
      }
    }
    const record = recordByBinding.get(binding);
    if (typeof record === "undefined" || record.session !== this) return;
    this.disposeRecord(record);
  }

  /** 行の session か（`for` 束縛ごとに 1 つを全行で共有する形。設計 R3） */
  get isRowSession(): boolean {
    return this.rowPlan !== null;
  }

  get currentRowPlan(): IRowPlan | null {
    return this.rowPlan;
  }

  /**
   * 共有 session の行単位の解体（設計 R3）。この content の行だけを解体する。
   *
   * 生きている行が 1 つも無くなったら、行ごと session だった頃の `dispose()` と同じく
   * 残っている定義待ち（`deferUntilDefined`）を取り消す。プラン行そのものは未定義要素を
   * 持てない（`compileRowPlan` がカスタム要素のテンプレートを不適格にする）が、
   * この session に注入された待ちが残ると閉包が強参照で残り続ける。
   */
  disposeBindings(bindings: readonly IBindingInfo[]): void {
    for (let i = 0; i < bindings.length; i++) {
      this.disposeBinding(bindings[i]);
    }
    if (this.rows.size > 0) {
      return;
    }
    for (const task of Array.from(this.deferred)) {
      task.active = false;
      task.cancel?.();
      this.deferred.delete(task);
      this.deferredByNode.get(task.node)?.delete(task);
    }
  }

  /** 行単位の wholesale destroy（設計 R3）。行を持たない session は従来どおり全部を捨てる */
  destroyRow(bindings: readonly IBindingInfo[]): void {
    const row = bindings.length > 0 ? this.rowOf(bindings[0]) : null;
    if (row === null) {
      this.destroyRecords();
      return;
    }
    this.destroyRowRecord(row);
    this.rows.delete(row);
  }

  private destroyRowRecord(row: IRowRecord): void {
    for (let i = 0; i < row.bindings.length; i++) {
      const address = row.addresses[i];
      if (address !== null) {
        removeBindingByAbsoluteStateAddress(address, row.bindings[i]);
        row.addresses[i] = null;
      }
      row.phases[i] = SLOT_DISPOSED;
    }
  }

  dispose(): void {
    for (const row of Array.from(this.rows)) {
      for (let i = 0; i < row.bindings.length; i++) this.disposeRowSlot(row, i);
    }
    for (const record of Array.from(this.records)) this.disposeRecord(record);
    for (const task of Array.from(this.deferred)) {
      task.active = false;
      task.cancel?.();
      this.deferred.delete(task);
      this.deferredByNode.get(task.node)?.delete(task);
    }
  }

  /**
   * wholesale destroy（全行クリアで teardown を GC に任せる高速経路）を適用して
   * よいか。定義待ち（DefinitionCoordinator の waiter / deferred spread タスク）は
   * 強参照 Map に閉包が残り、connect-snapshot 待ちは pending カウンタが戻らなく
   * なるため、1 つでもあれば従来経路（teardown 実行）に倒す。
   */
  canWholesaleDestroy(): boolean {
    if (this.deferred.size > 0) return false;
    if (this.records.size === 0) return true; // 空の Set の反復も割り当てるので先に抜ける
    for (const record of this.records) {
      if (record.pendingDefinitions > 0 || record.observationPending) return false;
    }
    return true;
  }

  /**
   * 全 record を teardown を走らせずに終端化する（canWholesaleDestroy が true の
   * content 専用）。イベント listener・loopContext・パターン台帳（listIndex キー）は
   * ノード/binding もろとも GC で崩壊する（recordByBinding 以下は全て弱参照）。
   * 例外は null-listIndex の従来台帳（record.address）: キーの intern 済み
   * AbsoluteStateAddress が PathInfo キャッシュ経由で生涯生存するため GC で
   * 崩壊せず、共有エントリに残った binding が binding.node 経由で行 DOM 全体を
   * 永久リークする。ここだけ明示除去する（行イベント binding が典型で行あたり
   * 高々数件・Set.delete のみなので wholesale の速度特性は保たれる）。
   * handlerBindingRegistry のカウンタは減らないが、残るのはキー文字列と数値のみで
   * 実害はない設計（handlerBindingRegistry.ts の弱参照化コメント参照）。
   */
  destroyRecords(): void {
    for (const row of this.rows) this.destroyRowRecord(row);
    this.rows.clear();
    for (const record of this.records) {
      if (record.address !== null) {
        removeBindingByAbsoluteStateAddress(record.address, record.info);
        record.address = null;
      }
      record.phase = "disposed";
      record.teardowns = null;
    }
    this.records.clear();
  }

  /**
   * マウントスコープ専用（Phase 2・webComponent/mountScope.ts）: 全 record の台帳登録を
   * **現在のループ文脈の listIndex** で張り直す。行 content のプール再利用でコンポーネント
   * 要素が別の行に付け替わると、スコープの binding は旧行の listIndex で台帳に載ったままに
   * なる — その 1 点だけを直す（listener・record・依存グラフは張り直し不要）。
   *
   * `for` binding は lastListValue（差分の基準）を旧アドレスから新アドレスへ引き継ぐ。
   * 引き継がないと再適用が全行 add と誤認し、旧行の DOM が残ったまま新行を重ねて
   * マウントする。戻り値は再適用すべき binding（呼び出し側が applyChangeFromBindings する）。
   */
  /**
   * マウントスコープ再接続専用: アクティブな record の binding ノード（text は差し替え前の
   * comment — ループ文脈の直接エントリはこのノードに載る）を列挙する。
   * remountScopeBindings が現在の行の文脈へ張り替えるために使う。
   */
  forEachActiveBindingNode(callback: (node: Node) => void): void {
    for (const row of this.rows) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] === SLOT_ACTIVE) callback(row.bindings[i].node);
      }
    }
    for (const record of this.records) {
      if (record.phase !== "active") continue;
      callback(record.info.node);
    }
  }

  rebindAddresses(): IBindingInfo[] {
    const rebound: IBindingInfo[] = [];
    for (const row of this.rows) {
      for (let i = 0; i < row.bindings.length; i++) {
        if (row.phases[i] !== SLOT_ACTIVE) continue;
        if (row.addresses[i] === null && row.patternPathInfos[i] === null) continue;
        const binding = row.bindings[i];
        this.unregisterRowSlot(row, i);
        this.registerRowSlot(row, i);
        if (this.shouldApplyState(binding)) rebound.push(binding);
      }
    }
    for (const record of this.records) {
      if (record.phase !== "active") continue;
      const binding = record.info;
      if (record.address === null && record.patternListIndex === null) continue;
      const oldAbs = binding.bindingType === "for" ? getAbsoluteStateAddressByBinding(binding) : null;
      unregisterFromLedger(binding, record.address, record.patternPathInfo, record.patternListIndex);
      record.address = null;
      record.patternPathInfo = null;
      record.patternListIndex = null;
      this.registerAddress(record);
      if (oldAbs !== null) {
        const newAbs = getAbsoluteStateAddressByBinding(binding);
        // 記録の有無は has で見る（get は未記録でも `[]` を返すため、!= null 判定は
        // 常に真 — 未記録の旧アドレスから空配列を持ち込んで、新アドレスに残っていた
        // 正当な記録を潰しうる）
        if (newAbs !== oldAbs && hasLastListValueByAbsoluteStateAddress(oldAbs)) {
          setLastListValueByAbsoluteStateAddress(newAbs, getLastListValueByAbsoluteStateAddress(oldAbs));
        }
        // state 側の基準（E1）も同じ理由で引き継ぐ。記録の有無は has で見る（同上）
        if (newAbs !== oldAbs && hasStateListBaseline(oldAbs)) {
          setStateListBaseline(newAbs, getStateListBaseline(oldAbs));
        }
      }
      if (this.shouldApplyState(binding)) {
        rebound.push(binding);
      }
    }
    return rebound;
  }

  observe(node: Node): void {
    const root = observableRootFor(node);
    if (root === null) return;
    // owner（root ごとの MutationObserver）の存在だけ保証する。session の配送先
    // 登録は node 単位（interestedSessionsByNode）で行い、owner は session を
    // 直接は保持しない。
    getBindingOwner(root);
  }

  handleMutations(root: IObservableRoot, removed: readonly Node[], added: readonly Node[]): void {
    for (const subtree of removed) {
      forEachInclusive(subtree, (node) => {
        if (root.contains(node)) return;
        this.handleRemovedNode(node);
      });
    }
    const reconnected: IBindingInfo[] = [];
    for (const subtree of added) {
      forEachInclusive(subtree, (node) => {
        if (!root.contains(node)) return;
        this.handleAddedNode(node, reconnected);
      });
    }
    if (reconnected.length > 0) applyChangeFromBindings(reconnected);
  }

  handleRemovedNode(node: Node): void {
    const known = this.knownBindingsByNode.get(node);
    if (typeof known !== "undefined") {
      if (known instanceof Map) {
        for (const binding of known.values()) this.disposeBinding(binding);
      } else {
        this.disposeBinding(known);
      }
    }
    const tasks = this.deferredByNode.get(node);
    if (typeof tasks !== "undefined") {
      for (const task of Array.from(tasks)) {
        task.active = false;
        task.cancel?.();
        tasks.delete(task);
        this.deferred.delete(task);
      }
    }
  }

  handleAddedNode(node: Node, reconnected: IBindingInfo[]): void {
    const known = this.knownBindingsByNode.get(node);
    if (typeof known === "undefined") return;
    const bindings = known instanceof Map ? known.values() : [known];
    for (const binding of bindings) {
      const record = recordByBinding.get(binding);
      if (record?.phase === "active") {
        this.settleConnectedSnapshot(record);
        continue;
      }
      if (record?.phase !== "disposed") continue;
      const options = this.optionsByBinding.get(binding);
      if (typeof options === "undefined") continue;
      try {
        this.start(binding, options);
        if (options.applyOnReconnect && this.shouldApplyState(binding)) reconnected.push(binding);
      } catch {
        // Mutation delivery cannot surface initialization errors to a caller.
      }
    }
  }

  /**
   * anchor の known 台帳を Map 形へ正規化して返す（remember のキー照合用）。
   * 単一値（プラン行 or 既存単独 binding）は実キーを引いて昇格する。
   */
  private knownMapFor(anchor: Node): Map<string, IBindingInfo> {
    const current = this.knownBindingsByNode.get(anchor);
    if (current instanceof Map) {
      return current;
    }
    const map = new Map<string, IBindingInfo>();
    if (typeof current !== "undefined") {
      let key = bindingKeyByBinding.get(current);
      if (typeof key === "undefined") {
        key = bindingKey(current);
        bindingKeyByBinding.set(current, key);
      }
      map.set(key, current);
    }
    this.knownBindingsByNode.set(anchor, map);
    return map;
  }

  private remember(binding: IBindingInfo, options: IBindingOptions): IBindingInfo {
    const anchor = binding.replaceNode;
    // detached fragment 上でも登録しておく（node 単位の台帳なので root 非依存）。
    // fragment 一括マウントで後から接続された行にも mutation 配送が届くようにする。
    addInterestedSession(anchor, this);
    const known = this.knownMapFor(anchor);
    let key = bindingKeyByBinding.get(binding);
    if (typeof key === "undefined") {
      key = bindingKey(binding);
      bindingKeyByBinding.set(binding, key);
    }
    const remembered = known.get(key);
    if (typeof remembered !== "undefined") {
      const rememberedOptions = this.optionsByBinding.get(remembered);
      if (typeof rememberedOptions !== "undefined") {
        rememberedOptions.registerAddress ||= options.registerAddress;
        rememberedOptions.registerPathInfo ||= options.registerPathInfo;
        rememberedOptions.applyOnReconnect ||= options.applyOnReconnect;
      }
      return remembered;
    }
    known.set(key, binding);
    this.optionsByBinding.set(binding, { ...options });
    return binding;
  }

  /**
   * RowPlan 経路の一括初期化（createContent 専用・docs/state-row-instantiation-redesign.md §3-2）。
   * プラン行の binding はこの呼び出しでのみ生成されるため remember（キー照合・
   * options マージ）を丸ごと省略し、policy/authority はテンプレート時に解決済みの
   * 値を焼き込む。options は行内共有の 1 オブジェクト（activate が
   * registerAddress を昇格するとき行内全 binding が同時に昇格する — 従来も
   * activate は全 binding を同順で昇格するため観測可能な差はない）。
   */
  initializeRow(plan: IRowPlan, bindings: readonly IBindingInfo[]): void {
    this.rowPlan = plan;
    const slots = plan.slots;
    const n = bindings.length;
    const row: IRowRecord = {
      id: ++nextRecordId,
      session: this,
      generation: ++nextGeneration,
      plan,
      bindings,
      registered: false,
      // 素の配列（Smi）。型付き配列は本体と backing store で 1 本あたり 100 B を超え、cold の
      // 生成では行ごとの割り当ての上位に出た（設計 R5）
      phases: new Array<number>(n).fill(SLOT_ACTIVE),
      flags: new Array<number>(n).fill(0),
      addresses: new Array<IAbsoluteStateAddress | null>(n).fill(null),
      patternPathInfos: new Array<ITreePath | null>(n).fill(null),
      patternListIndexes: new Array<IListIndex | null>(n).fill(null),
    };
    this.rows.add(row);
    for (let i = 0; i < n; i++) {
      const binding = bindings[i];
      const anchor = binding.replaceNode;
      addInterestedSession(anchor, this);
      this.addKnownRowBinding(anchor, binding, i);
      rowByBinding.set(binding, row);
      if (slots[i].isEvent) {
        // 印は `attachEventHandler` の**戻り値**で立てる。今は `structural/rowPlan.ts` の
        // 名前空間除外によって `slot.isEvent` ⟺ `isDomEventBinding` が成り立っているが、
        // そこが緩んだ瞬間に「張っていないのに張った印」が立ち、detach が空振りする
        let attached = false;
        try {
          attached = attachEventHandler(binding);
        } catch (error) {
          row.phases[i] = SLOT_FAILED;
          throw error;
        }
        if (attached) row.flags[i] |= FLAG_EVENT_ATTACHED;
      }
      // 非 event スロットはプラン適格性により双方向不能・radio/checkbox 不能・
      // token 配線不能が確定しているため attach 系を一切呼ばない
    }
  }

  /**
   * プラン行の活性化（activate の高速経路）。bindings は initializeRow と同一の
   * スロット整列配列（bindingsByContent がそのまま保持）である前提。
   * プラン行の record は policy/authority 解決済み・observable なし・
   * connect-snapshot なしが構造的に保証されているため、settleInitialRecord /
   * settleConnectedSnapshot の呼び出し自体を省略できる。
   * プール再利用（disposed/failed）では record オブジェクトを再利用し、
   * 世代だけ進めて listener attach とアドレス登録をやり直す（record 再割当なし）。
   */
  private activatePlanRows(plan: IRowPlan, bindings: readonly IBindingInfo[], knownRoot: Node): void {
    const row = bindings.length > 0 ? this.rowOf(bindings[0]) : null;
    if (row === null || row.bindings !== bindings) {
      // この session の行でない binding 配列（防御）: 従来経路
      for (const binding of bindings) {
        this.initialize([binding], { registerAddress: true, registerPathInfo: false, applyOnReconnect: false });
      }
      return;
    }
    row.registered = true;
    const slots = plan.slots;
    let revived = false;
    for (let i = 0; i < bindings.length; i++) {
      if (row.phases[i] !== SLOT_ACTIVE) {
        // pool 再利用: 世代だけ進めて listener attach とアドレス登録をやり直す
        if (!revived) {
          row.generation = ++nextGeneration;
          revived = true;
          this.rows.add(row);
        }
        row.phases[i] = SLOT_ACTIVE;
        row.flags[i] = 0;
        if (slots[i].isEvent) {
          let attached = false;
          try {
            attached = attachEventHandler(bindings[i]);
          } catch (error) {
            row.phases[i] = SLOT_FAILED;
            this.runRowSlotTeardowns(row, i);
            throw error;
          }
          if (attached) row.flags[i] |= FLAG_EVENT_ATTACHED;
        }
        this.registerRowSlot(row, i, knownRoot);
        continue;
      }
      if (row.addresses[i] === null && row.patternPathInfos[i] === null) {
        // 初回活性化
        this.registerRowSlot(row, i, knownRoot);
      }
    }
  }

  private rowOf(binding: IBindingInfo): IRowRecord | null {
    const row = rowByBinding.get(binding);
    return typeof row !== "undefined" && row.session === this ? row : null;
  }

  private registerRowSlot(row: IRowRecord, slot: number, knownRoot?: Node | null): void {
    if (row.addresses[slot] !== null || row.patternPathInfos[slot] !== null) return;
    const binding = row.bindings[slot];
    const listIndex = getListIndexByBindingInfo(binding);
    if (listIndex !== null) {
      row.patternPathInfos[slot] = registerPattern(binding, listIndex, knownRoot);
      row.patternListIndexes[slot] = listIndex;
    } else {
      row.addresses[slot] = registerAbsoluteAddress(binding, knownRoot);
    }
    // registerPathInfo は行オプションで常に false
  }

  private unregisterRowSlot(row: IRowRecord, slot: number): void {
    const address = row.addresses[slot];
    const pathInfo = row.patternPathInfos[slot];
    if (address === null && pathInfo === null) return;
    // 外せなかった（台帳の throw）ときは器を残す: 後で生き返った行が登録し直さないように
    unregisterFromLedger(row.bindings[slot], address, pathInfo, row.patternListIndexes[slot]);
    row.addresses[slot] = null;
    row.patternPathInfos[slot] = null;
    row.patternListIndexes[slot] = null;
  }

  private disposeRowSlot(row: IRowRecord, slot: number): void {
    if (row.phases[slot] === SLOT_DISPOSED) return;
    row.phases[slot] = SLOT_DISPOSED;
    this.runRowSlotTeardowns(row, slot);
    for (let i = 0; i < row.phases.length; i++) {
      if (row.phases[i] === SLOT_ACTIVE) return;
    }
    this.rows.delete(row);
  }

  private runRowSlotTeardowns(row: IRowRecord, slot: number): void {
    try {
      this.unregisterRowSlot(row, slot);
    } catch {
      // Cleanup is best-effort; one faulty resource must not retain the rest.
    }
    if ((row.flags[slot] & FLAG_EVENT_ATTACHED) !== 0) {
      row.flags[slot] &= ~FLAG_EVENT_ATTACHED;
      try {
        detachEventHandler(row.bindings[slot]);
      } catch {
        // Cleanup is best-effort.
      }
    }
  }

  private addKnownRowBinding(anchor: Node, binding: IBindingInfo, slotIndex: number): void {
    const current = this.knownBindingsByNode.get(anchor);
    if (typeof current === "undefined") {
      this.knownBindingsByNode.set(anchor, binding);
      return;
    }
    // 同一 anchor に複数スロット（複数エントリの data-wcs）: Map へ昇格。
    // プラン行はキー照合されないため添字ベースの合成キーで一意性だけ担保する
    if (current instanceof Map) {
      current.set("@plan:" + slotIndex, binding);
      return;
    }
    const map = new Map<string, IBindingInfo>();
    map.set("@plan:first", current);
    map.set("@plan:" + slotIndex, binding);
    this.knownBindingsByNode.set(anchor, map);
  }

  private start(binding: IBindingInfo, options: IBindingOptions, knownRoot?: Node | null): void {
    replaceToReplaceNode(binding);
    const recordOptions = this.optionsByBinding.get(binding) ?? { ...options };
    const record: IInternalBindingRecord = {
      id: ++nextRecordId,
      info: binding,
      generation: ++nextGeneration,
      phase: "discovered",
      teardowns: null,
      session: this,
      anchor: binding.replaceNode,
      options: recordOptions,
      address: null,
      patternPathInfo: null,
      patternListIndex: null,
      pendingDefinitions: 0,
      initialPolicy: null,
      resolvedAuthority: null,
      initialSettled: false,
      initialApplyDone: false,
      outputOnlyMember: false,
      observationPending: false,
      eventSequence: 0,
      hasProducerValue: false,
      producerValue: undefined,
      eventAttached: false,
      twowayAttached: false,
    };
    recordByBinding.set(binding, record);
    this.records.add(record);
    // knownRoot が渡されたときは observe を省略する（null = detached fragment 上で
    // observableRootFor が必ず null、Node = activate 冒頭で owner 保証済み）
    if (typeof knownRoot === "undefined") this.observe(record.anchor);

    try {
      record.phase = "attaching";
      this.attachListeners(record);
      if (record.options.registerAddress) this.registerAddress(record, knownRoot);
      if (record.pendingDefinitions === 0) record.phase = "active";
    } catch (error) {
      record.phase = "failed";
      this.runTeardowns(record);
      this.records.delete(record);
      throw error;
    }
  }

  private attachListeners(record: IInternalBindingRecord): void {
    const binding = record.info;
    if (attachEventHandler(binding)) {
      record.eventAttached = true;
      return;
    }

    if (binding.propSegments[0] === EVENT_TOKEN_NAMESPACE) {
      this.attachAfterDefinition(record, () => {
        if (attachEventTokenHandler(binding)) {
          addRecordTeardown(record, () => detachEventTokenHandler(binding));
        }
      });
      return;
    }

    if (attachRadioEventHandler(binding)) {
      addRecordTeardown(record, () => detachRadioEventHandler(binding));
    }
    if (attachCheckboxEventHandler(binding)) {
      addRecordTeardown(record, () => detachCheckboxEventHandler(binding));
    }
    this.attachAfterDefinition(record, () => {
      // directional initial sync の producer-value observer は twowayEventHandlerFunction
      // からのみ呼ばれる（唯一の consumer）。その handler が attach されるのは
      // isPossibleTwoWay かつ非 ro の binding だけ（attachTwowayEventHandler と同条件）
      // なので、one-way / event / eventToken / radio(非value) 等では observer は決して
      // fire しない。以前は attachListeners 冒頭で全 binding に無条件登録していたが、
      // fire しえない大多数の binding に対する setup 死荷重だった。ここへ移すことで
      // 「twoway handler が付く binding のみ observer 登録」を構造的に保証する
      // （undefined custom element は attachAfterDefinition が定義後まで遅延するので
      // isPossibleTwoWay の未定義 CE raiseError も踏まない）。
      if (
        config.enableDirectionalInitialSync
        && isPossibleTwoWay(binding.node, binding.propName)
        && binding.propModifiers.indexOf(MODIFIER_READONLY) === -1
      ) {
        const removeObserver = addTwowayValueObserver(binding.node, binding.propName, (value) => {
          if (!this.isAlive(record, record.generation)) return;
          record.eventSequence += 1;
          record.hasProducerValue = true;
          record.producerValue = value;
        });
        addRecordTeardown(record, removeObserver);
      }
      attachTwowayEventHandler(binding);
      record.twowayAttached = true;
    });
  }

  private attachAfterDefinition(record: IInternalBindingRecord, attach: () => void): void {
    const tagName = getCustomElement(record.info.node);
    if (tagName === null) {
      attach();
      return;
    }
    const registry = getCustomElementRegistry(record.info.node);
    if (registry === null) {
      raiseError(`CustomElementRegistry is unavailable for <${tagName}>.`);
    }
    if (typeof registry.get(tagName) !== "undefined") {
      attach();
      return;
    }

    record.phase = "waiting-definition";
    record.pendingDefinitions += 1;
    const generation = record.generation;
    const coordinator: DefinitionCoordinator = getDefinitionCoordinator(registry);
    const cancel = coordinator.wait(tagName, () => {
      if (!this.isAlive(record, generation)) return;
      try {
        upgradeCustomElement(registry, record.info.node);
        attach();
        record.pendingDefinitions -= 1;
        if (record.pendingDefinitions === 0) {
          record.phase = "active";
          this.settleInitialRecord(record);
        }
      } catch {
        record.phase = "failed";
        this.runTeardowns(record);
        this.records.delete(record);
      }
    }, () => {
      if (!this.isAlive(record, generation)) return;
      record.phase = "failed";
      this.runTeardowns(record);
      this.records.delete(record);
    });
    addRecordTeardown(record, cancel);
  }

  private settleInitialRecord(record: IInternalBindingRecord): void {
    if (!config.enableDirectionalInitialSync || record.initialSettled || !record.options.registerAddress) return;
    record.phase = "synchronizing";
    try {
      const policy = resolveInitialSyncPolicy(record.info);
      const authority = resolveInitialAuthority(record.info, policy.authority);
      record.initialPolicy = policy;
      record.resolvedAuthority = authority;
      record.initialSettled = true;
      record.outputOnlyMember = policy.outputOnly;
      record.phase = "active";
      if (!policy.observable) return;
      if (
        policy.syncOn === "connect"
        && record.info.node instanceof HTMLElement
        && !record.info.node.isConnected
      ) {
        record.observationPending = true;
        // 待ちが 1 件でもある間は追加側 observer スキップを無効化する
        incrementPendingObservation();
        return;
      }
      this.readProducerSnapshot(record, policy.syncOn === "call");
    } catch (error) {
      record.phase = "failed";
      this.runTeardowns(record);
      this.records.delete(record);
      throw error;
    }
  }

  private readProducerSnapshot(record: IInternalBindingRecord, eventWins: boolean): void {
    if (!this.isAlive(record, record.generation)) return;
    const target = record.info.node as Node & Record<string, unknown>;
    const name = record.info.propName;
    if (!(name in target)) return;
    const sequence = record.eventSequence;
    const value = target[name];
    if (record.observationPending) {
      record.observationPending = false;
      decrementPendingObservation();
    }
    if (eventWins && record.eventSequence !== sequence) return;
    record.hasProducerValue = true;
    record.producerValue = value;
    if (record.resolvedAuthority === "element") {
      commitProducerValue(record.info, value);
    }
  }

  private settleConnectedSnapshot(record: IInternalBindingRecord): void {
    if (
      !config.enableDirectionalInitialSync
      || !record.observationPending
      || !(record.info.node instanceof HTMLElement)
      || !record.info.node.isConnected
    ) return;
    try {
      this.readProducerSnapshot(record, false);
    } catch {
      record.phase = "failed";
      this.runTeardowns(record);
      this.records.delete(record);
    }
  }

  private registerAddress(record: IInternalBindingRecord, knownRoot?: Node | null): void {
    if (record.address !== null || record.patternListIndex !== null) return;
    const binding = record.info;
    const listIndex = getListIndexByBindingInfo(binding);
    if (listIndex !== null) {
      record.patternPathInfo = registerPattern(binding, listIndex, knownRoot);
      record.patternListIndex = listIndex;
    } else {
      record.address = registerAbsoluteAddress(binding, knownRoot);
    }
    // 台帳解除は runTeardowns が record.address / pattern フィールドから
    // データ駆動で行う（クロージャ不要）
    if (!record.options.registerPathInfo) return;
    const rootNode = binding.replaceNode.getRootNode() as Node;
    const stateElement = getStateElement(rootNode);
    if (stateElement === null) {
      raiseError(`No state tree found on this root for binding.`);
    }
    if (binding.bindingType !== "event") {
      stateElement.setPathInfo(binding.statePathName, binding.bindingType);
    }
  }

  private isAlive(record: IInternalBindingRecord, generation: number): boolean {
    return record.generation === generation
      && recordByBinding.get(record.info) === record
      && record.phase !== "disposed"
      && record.phase !== "failed";
  }

  private disposeRecord(record: IInternalBindingRecord): void {
    if (record.phase === "disposed") return;
    record.phase = "disposed";
    this.runTeardowns(record);
    this.records.delete(record);
  }

  private runTeardowns(record: IInternalBindingRecord): void {
    // runTeardowns は record の終端（disposed / failed）でのみ呼ばれる。未消化の
    // connect-snapshot 待ちが残っていれば必ずカウンタを戻す（スキップ再有効化）。
    if (record.observationPending) {
      record.observationPending = false;
      decrementPendingObservation();
    }
    const binding = record.info;
    // データ駆動の後始末（従来はクロージャで積んでいた頻出3種）。実行順は従来の
    // 逆順実行と同じ: アドレス台帳解除（最後に積まれていた）→ 双方向 detach →
    // 希少クロージャ群（逆順）→ イベント detach。各 detach は互いに独立した資源を
    // 対象とするため、この順序で意味論は変わらない。
    if (record.address !== null || record.patternListIndex !== null) {
      try {
        unregisterFromLedger(binding, record.address, record.patternPathInfo, record.patternListIndex);
        record.address = null;
        record.patternPathInfo = null;
        record.patternListIndex = null;
      } catch {
        // Cleanup is best-effort; one faulty resource must not retain the rest.
      }
    }
    if (record.twowayAttached) {
      record.twowayAttached = false;
      try {
        detachTwowayEventHandler(binding);
      } catch {
        // Cleanup is best-effort.
      }
    }
    if (record.teardowns !== null) {
      const teardowns = Array.from(record.teardowns).reverse();
      record.teardowns = null;
      for (const teardown of teardowns) {
        try {
          teardown();
        } catch {
          // Cleanup is best-effort; one faulty resource must not retain the rest.
        }
      }
    }
    if (record.eventAttached) {
      record.eventAttached = false;
      try {
        detachEventHandler(binding);
      } catch {
        // Cleanup is best-effort.
      }
    }
  }
}

export function getOrCreateBindingSession(root: Node): BindingSession {
  let session = sessionByRoot.get(root);
  if (typeof session === "undefined") {
    session = new BindingSession(root);
    sessionByRoot.set(root, session);
  }
  return session;
}

export function getBindingSession(binding: IBindingInfo): BindingSession | null {
  return recordByBinding.get(binding)?.session ?? rowByBinding.get(binding)?.session ?? null;
}
