import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { IAbsoluteStateAddress } from "../address/types";
import { clearAbsoluteStateAddressByBinding, getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress, removeBindingByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { config } from "../config";
import { detachCheckboxEventHandler, attachCheckboxEventHandler } from "../event/checkboxHandler";
import { detachEventTokenHandler, attachEventTokenHandler } from "../event/eventTokenHandler";
import { detachEventHandler, attachEventHandler } from "../event/handler";
import { detachRadioEventHandler, attachRadioEventHandler } from "../event/radioHandler";
import { detachTwowayEventHandler, attachTwowayEventHandler, addTwowayValueObserver } from "../event/twowayHandler";
import { isPossibleTwoWay } from "../event/isPossibleTwoWay";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry, upgradeCustomElement } from "../platform/customElementRegistry";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo } from "../types";
import { consumeObserverSkipOnAdd, consumeObserverSkipOnRemove, decrementPendingObservation, hasPendingObservation, incrementPendingObservation } from "./observerSkip";
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
  readonly session: BindingSession;
  readonly anchor: Node;
  readonly options: IBindingOptions;
  address: IAbsoluteStateAddress | null;
  pendingDefinitions: number;
  initialPolicy: IInitialSyncPolicy | null;
  resolvedAuthority: ResolvedInitialAuthority | null;
  initialSettled: boolean;
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
    for (const mutation of mutations) {
      removed.push(...Array.from(mutation.removedNodes));
      added.push(...Array.from(mutation.addedNodes));
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
  const inFilters = binding.inFilters.map((filter) => `${filter.filterName}(${filter.args.join(",")})`).join("|");
  const outFilters = binding.outFilters.map((filter) => `${filter.filterName}(${filter.args.join(",")})`).join("|");
  return [
    binding.bindingType,
    binding.propName,
    binding.propModifiers.join(","),
    binding.stateName,
    binding.statePathName,
    inFilters,
    outFilters,
    binding.uuid ?? "",
  ].join("\u0000");
}

function addRecordTeardown(record: IInternalBindingRecord, teardown: () => void): void {
  if (record.teardowns === null) {
    record.teardowns = new Set();
  }
  record.teardowns.add(teardown);
}

export class BindingSession {
  private readonly records = new Set<IInternalBindingRecord>();
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
      const existing = recordByBinding.get(binding);
      if (typeof existing !== "undefined" && existing.phase !== "disposed" && existing.phase !== "failed") {
        this.observe(existing.anchor);
        if (resolvedOptions.registerAddress && existing.address === null) {
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
    for (const binding of bindings) {
      const record = recordByBinding.get(binding);
      if (typeof record !== "undefined" && record.session === this
        && record.phase !== "disposed" && record.phase !== "failed") {
        if (record.address === null) {
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
    const record = recordByBinding.get(binding);
    if (typeof record === "undefined" || record.session !== this) return true;
    if (!record.options.registerAddress || record.phase === "waiting-definition") return true;
    if (record.phase === "active") this.settleInitialRecord(record);
    return record.resolvedAuthority === "state";
  }

  getRecord(binding: IBindingInfo): IBindingRecord | null {
    const record = recordByBinding.get(binding);
    return record?.session === this ? record : null;
  }

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
    const registry = getCustomElementRegistry();
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
    const record = recordByBinding.get(binding);
    if (typeof record === "undefined" || record.session !== this) return;
    this.disposeRecord(record);
  }

  dispose(): void {
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
    for (const record of this.records) {
      if (record.pendingDefinitions > 0 || record.observationPending) return false;
    }
    return true;
  }

  /**
   * 全 record を teardown を走らせずに終端化する（canWholesaleDestroy が true の
   * content 専用）。イベント listener・アドレス台帳・loopContext はノード/binding
   * もろとも GC で崩壊する（recordByBinding 以下は全て弱参照）。
   * handlerBindingRegistry のカウンタは減らないが、残るのはキー文字列と数値のみで
   * 実害はない設計（handlerBindingRegistry.ts の弱参照化コメント参照）。
   */
  destroyRecords(): void {
    for (const record of this.records) {
      record.phase = "disposed";
      record.teardowns = null;
    }
    this.records.clear();
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
    const rowOptions: IBindingOptions = { registerAddress: false, registerPathInfo: false, applyOnReconnect: false };
    const slots = plan.slots;
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      const slot = slots[i];
      const anchor = binding.replaceNode;
      addInterestedSession(anchor, this);
      this.addKnownRowBinding(anchor, binding, i);
      this.optionsByBinding.set(binding, rowOptions);
      const record: IInternalBindingRecord = {
        id: ++nextRecordId,
        info: binding,
        generation: ++nextGeneration,
        phase: "active",
        teardowns: null,
        session: this,
        anchor,
        options: rowOptions,
        address: null,
        pendingDefinitions: 0,
        initialPolicy: slot.policy,
        resolvedAuthority: slot.authority,
        initialSettled: true,
        observationPending: false,
        eventSequence: 0,
        hasProducerValue: false,
        producerValue: undefined,
        eventAttached: false,
        twowayAttached: false,
      };
      recordByBinding.set(binding, record);
      this.records.add(record);
      if (slot.isEvent) {
        try {
          attachEventHandler(binding);
        } catch (error) {
          record.phase = "failed";
          this.runTeardowns(record);
          this.records.delete(record);
          throw error;
        }
        record.eventAttached = true;
      }
      // 非 event スロットはプラン適格性により双方向不能・radio/checkbox 不能・
      // token 配線不能が確定しているため attach 系を一切呼ばない
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
      pendingDefinitions: 0,
      initialPolicy: null,
      resolvedAuthority: null,
      initialSettled: false,
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

    if (binding.propSegments[0] === "eventToken") {
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
        && binding.propModifiers.indexOf("ro") === -1
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
    const registry = getCustomElementRegistry();
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
    if (record.address !== null) return;
    const binding = record.info;
    const address = getAbsoluteStateAddressByBinding(binding, knownRoot);
    addBindingByAbsoluteStateAddress(address, binding);
    record.address = address;
    // 台帳解除は runTeardowns が record.address からデータ駆動で行う（クロージャ不要）
    if (!record.options.registerPathInfo) return;
    const rootNode = binding.replaceNode.getRootNode() as Node;
    const stateElement = getStateElementByName(rootNode, binding.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${binding.stateName}" not found for binding.`);
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
    if (record.address !== null) {
      try {
        removeBindingByAbsoluteStateAddress(record.address, binding);
        record.address = null;
        clearStateAddressByBindingInfo(binding);
        clearAbsoluteStateAddressByBinding(binding);
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
  return recordByBinding.get(binding)?.session ?? null;
}
