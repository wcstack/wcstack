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
  /** Detach all property listeners. */
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

  const signals: Record<string, WriteSignal<unknown>> = {};
  const removers: Array<() => void> = [];

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
  }

  return {
    signals,
    set(name: string, value: unknown): void {
      target[name] = value;
    },
    command(name: string, ...args: unknown[]): unknown {
      return target[name](...args);
    },
    dispose(): void {
      for (const remove of removers) {
        remove();
      }
    },
  };
}
