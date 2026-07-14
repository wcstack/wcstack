import { ICustomElementRegistryAdapter } from "../platform/customElementRegistry";

interface IDefinitionWaiter {
  active: boolean;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

interface IDefinitionEntry {
  readonly waiters: Set<IDefinitionWaiter>;
}

/**
 * Shares one CustomElementRegistry.whenDefined() continuation per registry/tag.
 * Waiters can be removed independently, so a never-defined tag does not retain
 * binding records or their DOM nodes after teardown.
 */
export class DefinitionCoordinator {
  private readonly entries = new Map<string, IDefinitionEntry>();

  constructor(private readonly registry: ICustomElementRegistryAdapter) {}

  wait(
    tagName: string,
    resolve: () => void,
    reject: (error: unknown) => void = () => undefined,
  ): () => void {
    const normalizedTagName = tagName.toLowerCase();
    let entry = this.entries.get(normalizedTagName);
    if (typeof entry === "undefined") {
      entry = { waiters: new Set() };
      this.entries.set(normalizedTagName, entry);
      this.registry.whenDefined(normalizedTagName).then(
        () => this.settle(normalizedTagName, null),
        (error: unknown) => this.settle(normalizedTagName, error),
      );
    }

    const waiter: IDefinitionWaiter = { active: true, resolve, reject };
    entry.waiters.add(waiter);
    return () => {
      if (!waiter.active) return;
      waiter.active = false;
      entry?.waiters.delete(waiter);
    };
  }

  pendingCount(tagName: string): number {
    return this.entries.get(tagName.toLowerCase())?.waiters.size ?? 0;
  }

  private settle(tagName: string, error: unknown): void {
    const entry = this.entries.get(tagName);
    if (typeof entry === "undefined") return;
    this.entries.delete(tagName);
    const waiters = Array.from(entry.waiters);
    entry.waiters.clear();
    for (const waiter of waiters) {
      if (!waiter.active) continue;
      waiter.active = false;
      if (error === null) waiter.resolve();
      else waiter.reject(error);
    }
  }
}

const coordinatorByRegistry = new WeakMap<ICustomElementRegistryAdapter, DefinitionCoordinator>();

export function getDefinitionCoordinator(
  registry: ICustomElementRegistryAdapter,
): DefinitionCoordinator {
  let coordinator = coordinatorByRegistry.get(registry);
  if (typeof coordinator === "undefined") {
    coordinator = new DefinitionCoordinator(registry);
    coordinatorByRegistry.set(registry, coordinator);
  }
  return coordinator;
}
