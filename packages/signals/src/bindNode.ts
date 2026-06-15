// wc-bindable → signal adapter (PoC). The crux of the design.
//
// Any async-IO node in wcstack speaks the wc-bindable protocol: it exposes
//   - properties: outputs — the node dispatches `event` on change; the value is
//                 read via `getter(event)` or the property `name`.
//   - inputs:     settable surface — write `node[name] = value`.
//   - commands:   invocable methods — call `node[name](...args)`.
// The node has NO idea whether the observer behind the binding is a proxy (state)
// or a signal. So a single adapter that turns its `properties` into signals — and
// forwards inputs/commands — makes every existing node plug into the signal core
// unchanged. See docs/signals-state-design.md §3.

import { signal, WriteSignal, ReadSignal } from "./reactive.js";

export interface WcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => unknown;
}

export interface WcBindableDescriptor {
  readonly properties: readonly WcBindableProperty[];
  readonly inputs?: readonly { readonly name: string }[];
  readonly commands?: readonly { readonly name: string }[];
}

export interface BoundNode {
  /** Output properties as read-only signals, keyed by property name. */
  readonly signals: Readonly<Record<string, ReadSignal<unknown>>>;
  /** Write a declared input on the node. */
  set(name: string, value: unknown): void;
  /** Invoke a declared command on the node. */
  command(name: string, ...args: unknown[]): unknown;
  /**
   * Detach all property listeners and make the adapter inert. After dispose the
   * output signals stop updating, and `set`/`command` throw (use-after-dispose) —
   * the whole BoundNode is dead, consistent with how `set`/`command` already throw
   * on undeclared names. Idempotent: calling dispose twice is a no-op.
   */
  dispose(): void;
}

type NodeTarget = EventTarget & Record<string, any>;

function readProperty(target: NodeTarget, name: string): unknown {
  return target[name];
}

export function bindNode(target: NodeTarget, descriptor?: WcBindableDescriptor): BoundNode {
  const desc = descriptor ?? (target.constructor as { wcBindable?: WcBindableDescriptor }).wcBindable;
  if (!desc) {
    throw new Error("bindNode: no wc-bindable descriptor provided and none found on target.constructor.wcBindable");
  }

  // Build name → declared-entry lookups so set/command can reject names the node
  // never declared, instead of silently writing/invoking an arbitrary property.
  const declaredInputs = new Set((desc.inputs ?? []).map((i) => i.name));
  const declaredCommands = new Set((desc.commands ?? []).map((c) => c.name));

  const signals: Record<string, WriteSignal<unknown>> = {};
  const removers: Array<() => void> = [];
  let disposed = false;

  for (const prop of desc.properties) {
    // Seed with the node's current value so the signal is valid before the first
    // event fires (e.g. FetchCore.value === null at rest).
    const cell = signal<unknown>(readProperty(target, prop.name));
    signals[prop.name] = cell;

    const handler = (event: Event): void => {
      cell.set(prop.getter ? prop.getter(event) : readProperty(target, prop.name));
    };
    target.addEventListener(prop.event, handler);
    removers.push(() => target.removeEventListener(prop.event, handler));
    // Re-seed AFTER subscribing: the initial read above is a snapshot taken before
    // the listener was attached, so a value change in that gap would be missed.
    // Reading the property once more now closes the race (the equality guard makes
    // it a no-op when nothing changed). Note this is the property snapshot, not a
    // getter(event) — there is no event to derive from at bind time.
    cell.set(readProperty(target, prop.name));
  }

  return {
    signals,
    set(name: string, value: unknown): void {
      if (disposed) {
        throw new Error(`bindNode.set: "${name}" called after dispose (the adapter is inert).`);
      }
      if (!declaredInputs.has(name)) {
        throw new Error(`bindNode.set: "${name}" is not a declared input on this node.`);
      }
      target[name] = value;
    },
    command(name: string, ...args: unknown[]): unknown {
      if (disposed) {
        throw new Error(`bindNode.command: "${name}" called after dispose (the adapter is inert).`);
      }
      if (!declaredCommands.has(name)) {
        throw new Error(`bindNode.command: "${name}" is not a declared command on this node.`);
      }
      if (typeof target[name] !== "function") {
        throw new TypeError(`bindNode.command: "${name}" is declared but not a function on the node.`);
      }
      return target[name](...args);
    },
    dispose(): void {
      if (disposed) {
        return; // idempotent
      }
      disposed = true;
      for (const remove of removers) {
        remove();
      }
    },
  };
}
