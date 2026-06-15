// wc-bindable → signal adapter. The crux of the design.
//
// Any async-IO node in wcstack speaks the wc-bindable protocol:
//   - properties: outputs — the node dispatches `event` on change; the value is
//                 read via `getter(event)` or the property `name`.
//   - inputs:     settable surface — write `node[name] = value`.
//   - commands:   invocable methods — call `node[name](...args)`.
// The node has NO idea whether the observer behind the binding is a proxy (state)
// or a signal. So a single adapter that maps these surfaces onto signals makes every
// existing node plug into the signal core unchanged. See docs/signals-state-design.md
// §3, and the four mappings of §3-1:
//
//   element → signal | property (latest snapshot)   → read signal      [`signals`]
//   element → signal | event-token (per-emit stream) → folded signal   [`on`]
//   signal → element | input (write-back)            → effect → prop    [`bindInput`]
//   signal → element | command-token (start/cancel)  → emit on change   [`bindCommand`]
//
// `signals` is the STATE view of a property (equality-guarded — same value = no
// update). `on` is the OCCURRENCE view of the same event (a stream — every emit
// updates, even with an equal value), folded latest-by-default.

import { signal, effect, WriteSignal, ReadSignal } from "./reactive.js";
import type { ResourceSource } from "./resource.js";

export interface WcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => unknown;
}

// Structurally a SUBSET of the real `IWcBindable` (which additionally carries
// `protocol` / `version`, and richer input/command entries). A real descriptor is
// therefore assignable to this type — see __tests__/bindNode.compat.test.ts.
export interface WcBindableDescriptor {
  readonly properties: readonly WcBindableProperty[];
  readonly inputs?: readonly { readonly name: string }[];
  readonly commands?: readonly { readonly name: string }[];
}

/** Options for `on` — how each event emission folds into the stream signal. */
export interface EventStreamOptions<T, C> {
  /** Combine the running value with each emission. Default: latest (replace). */
  fold?: (acc: T | undefined, chunk: C) => T;
  /** Seed value before the first emission. */
  initial?: T;
}

export interface BoundNode {
  /** Output properties as read-only signals (latest value), keyed by property name. */
  readonly signals: Readonly<Record<string, ReadSignal<unknown>>>;
  /**
   * An event-token STREAM for a declared property's event: a read signal that folds
   * every emission (latest by default). Unlike `signals[prop]`, it updates on EVERY
   * emit — even when the derived value is equal — because it models occurrences, not
   * state. The chunk per emit is `getter(event)` if the property declares one, else
   * the property's current value.
   */
  on<T = unknown, C = unknown>(prop: string, options?: EventStreamOptions<T, C>): ReadSignal<T | undefined>;
  /** Write a declared input on the node (imperative). */
  set(name: string, value: unknown): void;
  /**
   * Reactively write a declared input from a signal: an effect mirrors `source` into
   * `node[name]`. A same-value guard (`node[name] !== v`) skips redundant writes, so
   * a property whose write re-dispatches an event cannot feed back into an infinite
   * loop. Returns a disposer; the effect is also torn down by `dispose()`.
   */
  bindInput(name: string, source: ReadSignal<unknown>): () => void;
  /** Invoke a declared command on the node (imperative). */
  command(name: string, ...args: unknown[]): unknown;
  /**
   * Command-token: invoke a declared command whenever `trigger` CHANGES. The initial
   * value does not fire (subscribe-without-firing), so a command like `abort` is not
   * triggered on mount. `mapArgs` shapes the call arguments from the trigger value
   * (default: the value itself as a single argument). Returns a disposer; also torn
   * down by `dispose()`.
   */
  bindCommand(name: string, trigger: ReadSignal<unknown>, mapArgs?: (value: unknown) => unknown[]): () => void;
  /**
   * Detach all listeners/effects and make the adapter inert. After dispose the output
   * signals/streams stop updating and `set`/`command`/`bindInput`/`bindCommand`/`on`
   * throw (use-after-dispose). Idempotent.
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

  // Name → declared-entry lookups so set/command/on reject names the node never
  // declared, instead of silently writing/invoking/listening on an arbitrary member.
  const propByName = new Map(desc.properties.map((p) => [p.name, p]));
  const declaredInputs = new Set((desc.inputs ?? []).map((i) => i.name));
  const declaredCommands = new Set((desc.commands ?? []).map((c) => c.name));

  const signals: Record<string, WriteSignal<unknown>> = {};
  const removers: Array<() => void> = [];
  let disposed = false;

  const assertLive = (op: string, name: string): void => {
    if (disposed) {
      throw new Error(`bindNode.${op}: "${name}" called after dispose (the adapter is inert).`);
    }
  };

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

    on<T = unknown, C = unknown>(prop: string, options: EventStreamOptions<T, C> = {}): ReadSignal<T | undefined> {
      assertLive("on", prop);
      const propDesc = propByName.get(prop);
      if (!propDesc) {
        throw new Error(`bindNode.on: "${prop}" is not a declared property on this node.`);
      }
      const fold = options.fold ?? ((_acc: T | undefined, chunk: C) => chunk as unknown as T);
      // equals: () => false — a stream notifies on EVERY emit, even an equal value.
      const cell = signal<T | undefined>(options.initial, () => false);
      const handler = (event: Event): void => {
        const chunk = (propDesc.getter ? propDesc.getter(event) : readProperty(target, prop)) as C;
        cell.set(fold(cell.peek(), chunk));
      };
      target.addEventListener(propDesc.event, handler);
      removers.push(() => target.removeEventListener(propDesc.event, handler));
      return cell;
    },

    set(name: string, value: unknown): void {
      assertLive("set", name);
      if (!declaredInputs.has(name)) {
        throw new Error(`bindNode.set: "${name}" is not a declared input on this node.`);
      }
      target[name] = value;
    },

    bindInput(name: string, source: ReadSignal<unknown>): () => void {
      assertLive("bindInput", name);
      if (!declaredInputs.has(name)) {
        throw new Error(`bindNode.bindInput: "${name}" is not a declared input on this node.`);
      }
      const handle = effect(() => {
        const v = source.get();
        if (target[name] !== v) {
          target[name] = v; // same-value guard above breaks write→event→write loops
        }
      });
      removers.push(() => handle.dispose());
      return () => handle.dispose();
    },

    command(name: string, ...args: unknown[]): unknown {
      assertLive("command", name);
      if (!declaredCommands.has(name)) {
        throw new Error(`bindNode.command: "${name}" is not a declared command on this node.`);
      }
      if (typeof target[name] !== "function") {
        throw new TypeError(`bindNode.command: "${name}" is declared but not a function on the node.`);
      }
      return target[name](...args);
    },

    bindCommand(name: string, trigger: ReadSignal<unknown>, mapArgs?: (value: unknown) => unknown[]): () => void {
      assertLive("bindCommand", name);
      if (!declaredCommands.has(name)) {
        throw new Error(`bindNode.bindCommand: "${name}" is not a declared command on this node.`);
      }
      // Fail fast at bind time (not on first change), so a wrong name surfaces when
      // the subscription is set up rather than silently later inside a flush.
      if (typeof target[name] !== "function") {
        throw new TypeError(`bindNode.bindCommand: "${name}" is declared but not a function on the node.`);
      }
      let primed = false;
      const handle = effect(() => {
        const v = trigger.get();
        if (!primed) {
          primed = true; // subscribe on mount without firing (emit on CHANGE only)
          return;
        }
        const args = mapArgs ? mapArgs(v) : [v];
        target[name](...args);
      });
      removers.push(() => handle.dispose());
      return () => handle.dispose();
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

/**
 * Build a `resource` source from a wc-bindable node, bridging the resource's
 * AbortSignal to the node's cancel command (default `"abort"`) before delegating to
 * `run`. This generalizes the PoC's hand-wired `sig → core.abort()` bridge (docs §8
 * (e), §5-2): wrap the result in `resource({ args })` and any node that declares an
 * abort command gets switchMap-style cancel/restart for free — an `args` change
 * aborts the in-flight call (firing the node's abort command, which cancels its real
 * AbortController) and starts the next.
 *
 * The node's own value/loading/error stay available via `bound.signals`; `resource`
 * here is used for the cancel/restart lifecycle, not to re-derive that triad.
 *
 * @example
 *   const bound = bindNode(fetchEl);
 *   const r = resource(
 *     nodeSource(bound, (b, id) => b.command("fetch", `/api/${id}`)),
 *     { args: () => id.get() },
 *   );
 */
export function nodeSource<T, A = void>(
  bound: BoundNode,
  run: (node: BoundNode, args: A) => Promise<T> | T,
  options: { abort?: string } = {},
): ResourceSource<T, A> {
  const abortName = options.abort ?? "abort";
  return (args, signal) => {
    // Honor the resource's cancel by invoking the node's abort command. `once`:
    // each resource run gets a fresh AbortSignal, so the listener fires at most once.
    signal.addEventListener("abort", () => bound.command(abortName), { once: true });
    return run(bound, args);
  };
}
