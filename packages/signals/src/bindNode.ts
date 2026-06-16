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
import { reportError } from "./reportError.js";
import type { ResourceSource } from "./resource.js";

export interface WcBindableProperty<V = unknown> {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => V;
}

// Structurally a SUBSET of the real `IWcBindable` (which additionally carries
// `protocol` / `version`, and richer input/command entries). A real descriptor is
// therefore assignable to this type — see __tests__/bindNode.compat.test.ts.
export interface WcBindableDescriptor {
  readonly properties: readonly WcBindableProperty[];
  readonly inputs?: readonly { readonly name: string }[];
  readonly commands?: readonly { readonly name: string }[];
}

// --- typed node shape (D1) ---------------------------------------------------
//
// `bindNode` is the package's centerpiece, yet without a type argument every output
// was `ReadSignal<unknown>` and every `set`/`command` took `unknown` — the feature
// was effectively untyped in consumer code. `NodeShape` is an OPT-IN description of a
// node's reactive surface that drives the return type: declare the property value
// types, the input value types, and the command signatures ONCE, and `bound.signals`,
// `on`, `set`, `bindInput`, `command`, and `bindCommand` are all typed from it.
//
//   interface FetchShape extends NodeShape {
//     signals:  { value: Person[]; loading: boolean };
//     inputs:   { url: string };
//     commands: { fetch: (url: string) => Promise<Person[]>; abort: () => void };
//   }
//   const bound = bindNode<FetchShape>(el, desc);
//   bound.signals.value.get();        // ReadSignal<Person[]>  — key & type checked
//   bound.set("url", "/api/people");  // string enforced
//   bound.command("fetch", "/api");   // arg/return inferred
//
// The runtime is UNCHANGED — these types are erased; the adapter still validates names
// against the descriptor at runtime. The default shape below keeps every existing
// untyped call site compiling exactly as before (all-`unknown`, string keys).
// Open command map: a command name → any call signature. `(...args: any[])` (NOT
// `never[]`) is the constraint a USER shape's commands must satisfy — and, crucially,
// the OPEN fallback used when a shape omits `commands`. `Parameters<(...args: any[])
// => unknown>` is `any[]`, so an untyped `command("run", "/api")` accepts any args,
// preserving the pre-generic behaviour (symmetric with `inputs` → `unknown`). A shape
// that DECLARES a precise signature (e.g. `(url: string) => Promise<X>`) still gets
// exact arg/return checking on the typed path — the loose constraint only widens the
// DEFAULT, never a declared command. (`no-explicit-any` is disabled for this package.)
type OpenCommandMap = Record<string, (...args: any[]) => unknown>;

export interface NodeShape {
  /** propertyName → latest-snapshot value type (what `signals[name]` / `on(name)` carry). */
  signals?: Record<string, unknown>;
  /** inputName → settable value type (what `set` / `bindInput` accept). */
  inputs?: Record<string, unknown>;
  /** commandName → its call signature (what `command` / `bindCommand` invoke). */
  commands?: OpenCommandMap;
}

// Back-compat default: a fully-open shape so `bindNode(target, desc)` with no type
// argument behaves as before (signals keyed by arbitrary string → unknown; any
// input/command name; unknown values; any command args). Stronger typing is opt-in
// via the type arg.
export interface DefaultNodeShape extends NodeShape {
  signals: Record<string, unknown>;
  inputs: Record<string, unknown>;
  commands: OpenCommandMap;
}

// Resolve the three sub-maps with sane fallbacks when a shape omits one of them.
type SignalsOf<S extends NodeShape> = S["signals"] extends Record<string, unknown>
  ? S["signals"]
  : Record<string, unknown>;
type InputsOf<S extends NodeShape> = S["inputs"] extends Record<string, unknown>
  ? S["inputs"]
  : Record<string, unknown>;
type CommandsOf<S extends NodeShape> = S["commands"] extends OpenCommandMap ? S["commands"] : OpenCommandMap;

/** Options for `on` — how each event emission folds into the stream signal. */
export interface EventStreamOptions<T, C> {
  /** Combine the running value with each emission. Default: latest (replace). */
  fold?: (acc: T | undefined, chunk: C) => T;
  /** Seed value before the first emission. */
  initial?: T;
}

export interface BoundNode<S extends NodeShape = DefaultNodeShape> {
  /**
   * Output properties as read-only signals (latest value), keyed by property name and
   * typed from the node shape: `bound.signals.value.get()` carries the declared value
   * type (no longer `unknown`). Keys are the declared property names.
   */
  readonly signals: { readonly [K in keyof SignalsOf<S>]: ReadSignal<SignalsOf<S>[K]> };
  /**
   * An event-token STREAM for a declared property's event: a read signal that folds
   * every emission (latest by default). Unlike `signals[prop]`, it updates on EVERY
   * emit — even when the derived value is equal — because it models occurrences, not
   * state. The chunk per emit is `getter(event)` if the property declares one, else
   * the property's current value.
   *
   * With no fold the value type defaults to the property's declared snapshot type; a
   * `fold` may reshape it (explicit `T`/`C` type args override).
   */
  on<K extends keyof SignalsOf<S>>(prop: K): ReadSignal<SignalsOf<S>[K] | undefined>;
  on<T, C = SignalsOf<S>[keyof SignalsOf<S>]>(
    prop: keyof SignalsOf<S>,
    options: EventStreamOptions<T, C>,
  ): ReadSignal<T | undefined>;
  /** Write a declared input on the node (imperative); value type checked against the shape. */
  set<K extends keyof InputsOf<S>>(name: K, value: InputsOf<S>[K]): void;
  /**
   * Reactively write a declared input from a signal: an effect mirrors `source` into
   * `node[name]`. A same-value guard (`node[name] !== v`) skips redundant writes, so
   * a property whose write re-dispatches an event cannot feed back into an infinite
   * loop. Returns a disposer; the effect is also torn down by `dispose()`.
   */
  bindInput<K extends keyof InputsOf<S>>(name: K, source: ReadSignal<InputsOf<S>[K]>): () => void;
  /** Invoke a declared command on the node (imperative); args/return typed from the shape. */
  command<K extends keyof CommandsOf<S>>(name: K, ...args: Parameters<CommandsOf<S>[K]>): ReturnType<CommandsOf<S>[K]>;
  /**
   * Command-token: invoke a declared command whenever `trigger` CHANGES. The initial
   * value does not fire (subscribe-without-firing), so a command like `abort` is not
   * triggered on mount. `mapArgs` shapes the call arguments from the trigger value
   * (default: the value itself as a single argument). Returns a disposer; also torn
   * down by `dispose()`.
   */
  bindCommand<K extends keyof CommandsOf<S>, V = unknown>(
    name: K,
    trigger: ReadSignal<V>,
    mapArgs?: (value: V) => Parameters<CommandsOf<S>[K]>,
  ): () => void;
  /**
   * Detach all listeners/effects and make the adapter inert. After dispose the output
   * signals/streams stop updating and `set`/`command`/`bindInput`/`bindCommand`/`on`
   * throw (use-after-dispose). Idempotent.
   */
  dispose(): void;
}

// Internal target type. `Record<string, any>` is needed to index arbitrary declared
// members (target[name]) inside the adapter, but it is DELIBERATELY NOT in the public
// `bindNode` signature — exposing it there erased the caller's element type and let any
// stray member access type-check. Kept private; the public entry takes `EventTarget`.
type NodeTarget = EventTarget & Record<string, any>;

// Internal, fully-loose surface the adapter object is built against (string keys,
// `unknown` values). The public `BoundNode<S>` is a stricter projection of this same
// runtime object; `bindNode` casts the built `UntypedBoundNode` to `BoundNode<S>` at
// return. Kept private so the loose `unknown`-typed methods never leak to callers.
interface UntypedBoundNode {
  readonly signals: Record<string, ReadSignal<unknown>>;
  on<T = unknown, C = unknown>(prop: string, options?: EventStreamOptions<T, C>): ReadSignal<T | undefined>;
  set(name: string, value: unknown): void;
  bindInput(name: string, source: ReadSignal<unknown>): () => void;
  command(name: string, ...args: unknown[]): unknown;
  bindCommand(name: string, trigger: ReadSignal<unknown>, mapArgs?: (value: unknown) => unknown[]): () => void;
  dispose(): void;
}

// The error thrown by `assertLive` when an adapter method is called after dispose.
// Carries a brand symbol so callers that need to distinguish a post-dispose throw
// (e.g. nodeSource's abort bridge) can test it structurally instead of matching the
// message string — the message is free to change without silently breaking the
// guard. The brand survives even if a consumer's bundler duplicates the class (e.g.
// `instanceof` across realms), since it's a Symbol on the instance, not a class
// identity check.
const DISPOSED_ERROR = Symbol("bindNode.disposed");

/**
 * Error thrown when a {@link BoundNode} method is invoked after the adapter has been
 * disposed. Every surface that mutates or subscribes — `on` / `set` / `bindInput` /
 * `command` / `bindCommand` — throws this once `dispose()` has run, so a
 * use-after-dispose is loud instead of silently writing/invoking on an inert adapter.
 *
 * Prefer {@link isDisposedError} over `instanceof` for the check: the brand survives a
 * bundler that duplicates the class across realms, where `instanceof` would not. Use it
 * to make teardown-order races robust — e.g. swallow a post-dispose throw while letting
 * any other error surface:
 *
 * ```ts
 * try {
 *   bound.command("abort");
 * } catch (err) {
 *   if (!isDisposedError(err)) throw err; // expected during teardown; ignore
 * }
 * ```
 */
export class DisposedError extends Error {
  readonly [DISPOSED_ERROR] = true;
}

/**
 * True if `err` is a {@link DisposedError} — i.e. a use-after-dispose error thrown by a
 * {@link BoundNode} method after `dispose()`. Brand-based (checks a Symbol on the
 * instance), so it stays correct even if a consumer's bundler duplicates the
 * `DisposedError` class across module realms, where `err instanceof DisposedError`
 * could be false.
 */
export function isDisposedError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as Record<symbol, unknown>)[DISPOSED_ERROR] === true;
}

function readProperty(target: NodeTarget, name: string): unknown {
  return target[name];
}

/**
 * Adapt a wc-bindable node into signals. The public `target` parameter is a plain
 * `EventTarget` (the internal `Record<string, any>` indexing is cast away here, not
 * leaked to callers — see {@link NodeTarget}). Pass an optional {@link NodeShape} type
 * argument to type the result; omit it for the back-compat all-`unknown` shape.
 *
 * @example typed
 *   interface FetchShape extends NodeShape {
 *     signals:  { value: Person[]; loading: boolean };
 *     inputs:   { url: string };
 *     commands: { fetch: (url: string) => Promise<Person[]>; abort: () => void };
 *   }
 *   const bound = bindNode<FetchShape>(fetchEl, FetchCore.wcBindable);
 *   bound.signals.value.get();       // ReadSignal<Person[]>
 *   bound.set("url", "/api/people"); // string enforced
 */
export function bindNode<S extends NodeShape = DefaultNodeShape>(
  target: EventTarget,
  descriptor?: WcBindableDescriptor,
): BoundNode<S> {
  // The Record<string, any> indexing surface is needed internally to read/write/invoke
  // declared members by name; keep it private to this body.
  const node = target as NodeTarget;
  const desc = descriptor ?? (node.constructor as { wcBindable?: WcBindableDescriptor }).wcBindable;
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
      throw new DisposedError(`bindNode.${op}: "${name}" called after dispose (the adapter is inert).`);
    }
  };

  for (const prop of desc.properties) {
    // Seed with the node's current value so the signal is valid before the first
    // event fires (e.g. FetchCore.value === null at rest).
    const cell = signal<unknown>(readProperty(node, prop.name));
    signals[prop.name] = cell;

    const handler = (event: Event): void => {
      cell.set(prop.getter ? prop.getter(event) : readProperty(node, prop.name));
    };
    node.addEventListener(prop.event, handler);
    removers.push(() => node.removeEventListener(prop.event, handler));
    // Re-seed AFTER subscribing: the initial read above is a snapshot taken before
    // the listener was attached, so a value change in that gap would be missed.
    // Reading the property once more now closes the race (the equality guard makes
    // it a no-op when nothing changed). Note this is the property snapshot, not a
    // getter(event) — there is no event to derive from at bind time.
    cell.set(readProperty(node, prop.name));
  }

  // Implemented against a string-keyed, all-`unknown` surface (`UntypedBoundNode`); the
  // generic typing in `BoundNode<S>` is a compile-time projection over the SAME
  // runtime, so the object is built once and cast to `BoundNode<S>` at return. Runtime
  // name validation against the descriptor is unchanged.
  const bound: UntypedBoundNode = {
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
        const chunk = (propDesc.getter ? propDesc.getter(event) : readProperty(node, prop)) as C;
        cell.set(fold(cell.peek(), chunk));
      };
      node.addEventListener(propDesc.event, handler);
      removers.push(() => node.removeEventListener(propDesc.event, handler));
      return cell;
    },

    set(name: string, value: unknown): void {
      assertLive("set", name);
      if (!declaredInputs.has(name)) {
        throw new Error(`bindNode.set: "${name}" is not a declared input on this node.`);
      }
      node[name] = value;
    },

    bindInput(name: string, source: ReadSignal<unknown>): () => void {
      assertLive("bindInput", name);
      if (!declaredInputs.has(name)) {
        throw new Error(`bindNode.bindInput: "${name}" is not a declared input on this node.`);
      }
      const handle = effect(() => {
        const v = source.get();
        if (node[name] !== v) {
          node[name] = v; // same-value guard above breaks write→event→write loops
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
      if (typeof node[name] !== "function") {
        throw new TypeError(`bindNode.command: "${name}" is declared but not a function on the node.`);
      }
      return node[name](...args);
    },

    bindCommand(name: string, trigger: ReadSignal<unknown>, mapArgs?: (value: unknown) => unknown[]): () => void {
      assertLive("bindCommand", name);
      if (!declaredCommands.has(name)) {
        throw new Error(`bindNode.bindCommand: "${name}" is not a declared command on this node.`);
      }
      // Fail fast at bind time (not on first change), so a wrong name surfaces when
      // the subscription is set up rather than silently later inside a flush.
      if (typeof node[name] !== "function") {
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
        node[name](...args);
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

  return bound as unknown as BoundNode<S>;
}

/**
 * Build a `resource` source from a wc-bindable node, bridging the resource's
 * AbortSignal to the node's cancel command (default `"abort"`) before delegating to
 * `run`. This generalizes the earlier hand-wired `sig → core.abort()` bridge (docs §8
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
export function nodeSource<T, A = void, S extends NodeShape = DefaultNodeShape>(
  bound: BoundNode<S>,
  run: (node: BoundNode<S>, args: A) => Promise<T> | T,
  options: { abort?: string } = {},
): ResourceSource<T, A> {
  const abortName = options.abort ?? "abort";
  return (args, signal) => {
    // Honor the resource's cancel by invoking the node's abort command. `once`:
    // each resource run gets a fresh AbortSignal, so the listener fires at most once.
    //
    // GUARD: the abort listener runs SYNCHRONOUSLY inside AbortController.abort().
    // If `bound` was already disposed (e.g. the adapter and the resource share an
    // owner and the adapter's disposer ran first), `command` throws assertLive —
    // and a throw out of an abort listener surfaces as an unhandled exception during
    // the synchronous abort() call. Swallow a post-dispose throw so teardown order is
    // robust; report any OTHER error via the platform reporter without breaking abort.
    signal.addEventListener(
      "abort",
      () => {
        try {
          // `abortName` is a runtime string (validated by the adapter); the cast lets
          // it reach `command` regardless of the typed command-name union of `S`.
          (bound.command as (name: string, ...args: unknown[]) => unknown)(abortName);
        } catch (err) {
          // Brand-based check (not a message regex): a post-dispose throw is
          // expected here and swallowed; any OTHER error is reported.
          if (!isDisposedError(err)) {
            reportError(err);
          }
        }
      },
      { once: true },
    );
    return run(bound, args);
  };
}
