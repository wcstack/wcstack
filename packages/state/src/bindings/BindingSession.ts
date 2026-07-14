import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { IAbsoluteStateAddress } from "../address/types";
import { clearAbsoluteStateAddressByBinding, getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByAbsoluteStateAddress, removeBindingByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { detachCheckboxEventHandler, attachCheckboxEventHandler } from "../event/checkboxHandler";
import { detachEventTokenHandler, attachEventTokenHandler } from "../event/eventTokenHandler";
import { detachEventHandler, attachEventHandler } from "../event/handler";
import { detachRadioEventHandler, attachRadioEventHandler } from "../event/radioHandler";
import { detachTwowayEventHandler, attachTwowayEventHandler } from "../event/twowayHandler";
import { getCustomElement } from "../getCustomElement";
import { getCustomElementRegistry, upgradeCustomElement } from "../platform/customElementRegistry";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IBindingInfo } from "../types";
import { DefinitionCoordinator, getDefinitionCoordinator } from "./DefinitionCoordinator";
import { replaceToReplaceNode } from "./replaceToReplaceNode";

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
  readonly teardowns: Set<() => void>;
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

function forEachInclusive(root: Node, callback: (node: Node) => void): void {
  callback(root);
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
  private readonly sessionRefs = new Set<WeakRef<BindingSession>>();
  private readonly knownSessions = new WeakSet<BindingSession>();
  private readonly observer: MutationObserver | null;

  constructor(readonly root: IObservableRoot) {
    const Observer = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    this.observer = typeof Observer === "function"
      ? new Observer((mutations) => this.handleMutations(mutations))
      : null;
    this.observer?.observe(root, { childList: true, subtree: true });
  }

  add(session: BindingSession): void {
    if (this.knownSessions.has(session)) return;
    this.knownSessions.add(session);
    this.sessionRefs.add(new WeakRef(session));
  }

  private handleMutations(mutations: MutationRecord[]): void {
    const removed: Node[] = [];
    const added: Node[] = [];
    for (const mutation of mutations) {
      removed.push(...Array.from(mutation.removedNodes));
      added.push(...Array.from(mutation.addedNodes));
    }
    for (const ref of Array.from(this.sessionRefs)) {
      const session = ref.deref();
      if (typeof session === "undefined") {
        this.sessionRefs.delete(ref);
        continue;
      }
      session.handleMutations(this.root, removed, added);
    }
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

export class BindingSession {
  private readonly records = new Set<IInternalBindingRecord>();
  private readonly knownBindingsByNode = new WeakMap<Node, Map<string, IBindingInfo>>();
  private readonly optionsByBinding = new WeakMap<IBindingInfo, IBindingOptions>();
  private readonly deferredByNode = new WeakMap<Node, Set<IDeferredDefinition>>();
  private readonly deferred = new Set<IDeferredDefinition>();

  constructor(root: Node | null = null) {
    if (root !== null) this.observe(root);
  }

  initialize(
    bindings: readonly IBindingInfo[],
    options: Partial<IBindingOptions> = {},
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
        continue;
      }
      this.start(binding, resolvedOptions);
      initialized.push(binding);
    }
    return initialized;
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
    record.teardowns.add(teardown);
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

  observe(node: Node): void {
    const root = observableRootFor(node);
    if (root === null) return;
    getBindingOwner(root).add(this);
  }

  handleMutations(root: IObservableRoot, removed: readonly Node[], added: readonly Node[]): void {
    for (const subtree of removed) {
      forEachInclusive(subtree, (node) => {
        if (root.contains(node)) return;
        const known = this.knownBindingsByNode.get(node);
        if (typeof known !== "undefined") {
          for (const binding of known.values()) this.disposeBinding(binding);
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
      });
    }

    const reconnected: IBindingInfo[] = [];
    for (const subtree of added) {
      forEachInclusive(subtree, (node) => {
        if (!root.contains(node)) return;
        const known = this.knownBindingsByNode.get(node);
        if (typeof known === "undefined") return;
        for (const binding of known.values()) {
          const record = recordByBinding.get(binding);
          if (record?.phase !== "disposed") continue;
          const options = this.optionsByBinding.get(binding);
          if (typeof options === "undefined") continue;
          try {
            this.start(binding, options);
            if (options.applyOnReconnect) reconnected.push(binding);
          } catch {
            // Mutation delivery cannot surface initialization errors to a caller.
          }
        }
      });
    }
    if (reconnected.length > 0) applyChangeFromBindings(reconnected);
  }

  private remember(binding: IBindingInfo, options: IBindingOptions): IBindingInfo {
    const anchor = binding.replaceNode;
    let known = this.knownBindingsByNode.get(anchor);
    if (typeof known === "undefined") {
      known = new Map();
      this.knownBindingsByNode.set(anchor, known);
    }
    const key = bindingKey(binding);
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

  private start(binding: IBindingInfo, options: IBindingOptions): void {
    replaceToReplaceNode(binding);
    const recordOptions = this.optionsByBinding.get(binding) ?? { ...options };
    const record: IInternalBindingRecord = {
      id: ++nextRecordId,
      info: binding,
      generation: ++nextGeneration,
      phase: "discovered",
      teardowns: new Set(),
      session: this,
      anchor: binding.replaceNode,
      options: recordOptions,
      address: null,
      pendingDefinitions: 0,
    };
    recordByBinding.set(binding, record);
    this.records.add(record);
    this.observe(record.anchor);

    try {
      record.phase = "attaching";
      this.attachListeners(record);
      if (record.options.registerAddress) this.registerAddress(record);
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
      record.teardowns.add(() => detachEventHandler(binding));
      return;
    }

    if (binding.propSegments[0] === "eventToken") {
      this.attachAfterDefinition(record, () => {
        if (attachEventTokenHandler(binding)) {
          record.teardowns.add(() => detachEventTokenHandler(binding));
        }
      });
      return;
    }

    if (attachRadioEventHandler(binding)) {
      record.teardowns.add(() => detachRadioEventHandler(binding));
    }
    if (attachCheckboxEventHandler(binding)) {
      record.teardowns.add(() => detachCheckboxEventHandler(binding));
    }
    this.attachAfterDefinition(record, () => {
      attachTwowayEventHandler(binding);
      record.teardowns.add(() => detachTwowayEventHandler(binding));
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
        if (record.pendingDefinitions === 0) record.phase = "active";
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
    record.teardowns.add(cancel);
  }

  private registerAddress(record: IInternalBindingRecord): void {
    if (record.address !== null) return;
    const binding = record.info;
    const address = getAbsoluteStateAddressByBinding(binding);
    addBindingByAbsoluteStateAddress(address, binding);
    record.address = address;
    record.teardowns.add(() => {
      if (record.address === null) return;
      removeBindingByAbsoluteStateAddress(record.address, binding);
      record.address = null;
      clearStateAddressByBindingInfo(binding);
      clearAbsoluteStateAddressByBinding(binding);
    });
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
    const teardowns = Array.from(record.teardowns).reverse();
    record.teardowns.clear();
    for (const teardown of teardowns) {
      try {
        teardown();
      } catch {
        // Cleanup is best-effort; one faulty resource must not retain the rest.
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
