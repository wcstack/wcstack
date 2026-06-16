type Cleanup = () => void;
type Equals<T> = (a: T, b: T) => boolean;
interface ReadSignal<T> {
    /** Read the value AND register the current observer as a dependent. */
    get(): T;
    /** Read the value WITHOUT tracking (no dependency edge created). */
    peek(): T;
}
interface WriteSignal<T> extends ReadSignal<T> {
    set(value: T): void;
}
interface EffectHandle {
    dispose(): void;
}
/**
 * Synchronously flush queued effects. Provided for tests and for callers that
 * need DOM updates applied before reading the DOM back. In normal use effects
 * settle on their own microtask.
 */
declare function flushSync(): void;
declare function signal<T>(initial: T, equals?: Equals<T>): WriteSignal<T>;
declare function computed<T>(fn: () => T, equals?: Equals<T>): ReadSignal<T>;
declare function effect(fn: () => Cleanup | void): EffectHandle;
/**
 * Run `fn` inside a fresh ownership scope and return its result. Every effect (or
 * nested cleanup) created during `fn` — directly or transitively — is owned by
 * this root; calling the `dispose` passed to `fn` tears them all down.
 *
 * The root is detached: it is NOT auto-disposed by an enclosing owner. The caller
 * holds `dispose` (e.g. a custom element disposes it in disconnectedCallback).
 *
 * If `fn` throws, any effects/cleanups it created BEFORE the throw are disposed
 * before the error propagates — a caller that never received `dispose` (because the
 * call threw) cannot leak the half-built scope.
 */
declare function createRoot<T>(fn: (dispose: () => void) => T): T;
/**
 * Register a teardown callback with the current owner. Runs when the owning effect
 * re-runs or is disposed, or when the enclosing root is disposed. A no-op when
 * there is no current owner.
 */
declare function onCleanup(fn: () => void): void;

interface ResourceState<T> {
    value: ReadSignal<T | undefined>;
    loading: ReadSignal<boolean>;
    /** Last error, or `null` when there is none. Initial value is `null`; a (re)start resets it to `null`. */
    error: ReadSignal<unknown>;
    /** Abort any in-flight request and stop reacting to `args` changes. */
    dispose(): void;
}
interface ResourceOptions<T, A> {
    /** Reactive inputs. Reading signals here wires restart-on-change. */
    args?: () => A;
    /** Seed value before the first resolution. */
    initial?: T;
}
type ResourceSource<T, A> = (args: A, signal: AbortSignal) => Promise<T> | T;
declare function resource<T, A = void>(source: ResourceSource<T, A>, options?: ResourceOptions<T, A>): ResourceState<T>;

type StreamStatus = "idle" | "active" | "done" | "error";
interface StreamResourceState<T> {
    value: ReadSignal<T | undefined>;
    status: ReadSignal<StreamStatus>;
    /** Last error, or `null` when there is none. Initial value is `null`; a (re)start resets it to `null`. */
    error: ReadSignal<unknown>;
    /** Abort the in-flight stream and stop reacting to `args`. */
    dispose(): void;
}
interface StreamResourceOptions<T, C, A> {
    /** Reactive inputs. Reading signals here wires restart-on-change. */
    args?: () => A;
    /** Combine the running value with each chunk. Default: latest (replace). */
    fold?: (acc: T | undefined, chunk: C) => T;
    /** Seed value, and the value `value` is reset to on each (re)start. */
    initial?: T;
}
type StreamProducer<C> = AsyncIterable<C> | ReadableStream<C>;
/**
 * Produce a stream for the current `args`. The `signal` aborts on restart/dispose —
 * the source **MUST honor it** (this is a hard contract, not a suggestion): a
 * `ReadableStream` is fully cancelled via `reader.cancel()`, and an async generator
 * should observe `signal` (e.g. reject/break on `signal.aborted`) so a parked `await`
 * can unwind. On abort the adapter also calls the iterator's `return()` to run a
 * generator's `finally`, but a generator that parks forever while ignoring `signal`
 * cannot be force-unwound and will leak. See the module header's CONTRACT.
 */
type StreamSource<C, A> = (args: A, signal: AbortSignal) => StreamProducer<C> | Promise<StreamProducer<C>>;
declare function streamResource<T, C = T, A = void>(source: StreamSource<C, A>, options?: StreamResourceOptions<T, C, A>): StreamResourceState<T>;

interface WcBindableProperty<V = unknown> {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => V;
}
interface WcBindableDescriptor {
    readonly properties: readonly WcBindableProperty[];
    readonly inputs?: readonly {
        readonly name: string;
    }[];
    readonly commands?: readonly {
        readonly name: string;
    }[];
}
type OpenCommandMap = Record<string, (...args: any[]) => unknown>;
interface NodeShape {
    /** propertyName → latest-snapshot value type (what `signals[name]` / `on(name)` carry). */
    signals?: Record<string, unknown>;
    /** inputName → settable value type (what `set` / `bindInput` accept). */
    inputs?: Record<string, unknown>;
    /** commandName → its call signature (what `command` / `bindCommand` invoke). */
    commands?: OpenCommandMap;
}
interface DefaultNodeShape extends NodeShape {
    signals: Record<string, unknown>;
    inputs: Record<string, unknown>;
    commands: OpenCommandMap;
}
type SignalsOf<S extends NodeShape> = S["signals"] extends Record<string, unknown> ? S["signals"] : Record<string, unknown>;
type InputsOf<S extends NodeShape> = S["inputs"] extends Record<string, unknown> ? S["inputs"] : Record<string, unknown>;
type CommandsOf<S extends NodeShape> = S["commands"] extends OpenCommandMap ? S["commands"] : OpenCommandMap;
/** Options for `on` — how each event emission folds into the stream signal. */
interface EventStreamOptions<T, C> {
    /** Combine the running value with each emission. Default: latest (replace). */
    fold?: (acc: T | undefined, chunk: C) => T;
    /** Seed value before the first emission. */
    initial?: T;
}
interface BoundNode<S extends NodeShape = DefaultNodeShape> {
    /**
     * Output properties as read-only signals (latest value), keyed by property name and
     * typed from the node shape: `bound.signals.value.get()` carries the declared value
     * type (no longer `unknown`). Keys are the declared property names.
     */
    readonly signals: {
        readonly [K in keyof SignalsOf<S>]: ReadSignal<SignalsOf<S>[K]>;
    };
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
    on<T, C = SignalsOf<S>[keyof SignalsOf<S>]>(prop: keyof SignalsOf<S>, options: EventStreamOptions<T, C>): ReadSignal<T | undefined>;
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
    bindCommand<K extends keyof CommandsOf<S>, V = unknown>(name: K, trigger: ReadSignal<V>, mapArgs?: (value: V) => Parameters<CommandsOf<S>[K]>): () => void;
    /**
     * Detach all listeners/effects and make the adapter inert. After dispose the output
     * signals/streams stop updating and `set`/`command`/`bindInput`/`bindCommand`/`on`
     * throw (use-after-dispose). Idempotent.
     */
    dispose(): void;
}
declare const DISPOSED_ERROR: unique symbol;
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
declare class DisposedError extends Error {
    readonly [DISPOSED_ERROR] = true;
}
/**
 * True if `err` is a {@link DisposedError} — i.e. a use-after-dispose error thrown by a
 * {@link BoundNode} method after `dispose()`. Brand-based (checks a Symbol on the
 * instance), so it stays correct even if a consumer's bundler duplicates the
 * `DisposedError` class across module realms, where `err instanceof DisposedError`
 * could be false.
 */
declare function isDisposedError(err: unknown): boolean;
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
declare function bindNode<S extends NodeShape = DefaultNodeShape>(target: EventTarget, descriptor?: WcBindableDescriptor): BoundNode<S>;
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
declare function nodeSource<T, A = void, S extends NodeShape = DefaultNodeShape>(bound: BoundNode<S>, run: (node: BoundNode<S>, args: A) => Promise<T> | T, options?: {
    abort?: string;
}): ResourceSource<T, A>;

declare const Fragment: unique symbol;
type Child = unknown;
type Props = Record<string, unknown> | null;
type Component = (props: Record<string, unknown> & {
    children?: Child[];
}) => Node | Child[];
declare function h(tag: string | typeof Fragment | Component, props?: Props, ...children: Child[]): Node;
/** Append `child` into `container`, resolving fragments/arrays. */
declare function render(child: Child, container: Node): Node;
type ListAccessor<T> = ReadSignal<readonly T[]> | (() => readonly T[]);
type ForEach<T> = (item: T, index: () => number) => Node;
type IndexEach<T> = (item: () => T, index: number) => Node;
/**
 * The return type of {@link For} / {@link Index}: a keyed list that owns an anchored
 * region and reconciles rows in place. Exported (D4) so consumers can annotate
 * helpers that build or pass around lists. `mount` is called by `h`/`render` when the
 * list is used as a child; `__wcsList` is the brand `appendChild` checks.
 */
interface ListView {
    readonly __wcsList: true;
    mount(parent: Node): void;
}
interface ForOptions<T> {
    /** Derive a unique key per item. Default: the item value itself (identity). */
    key?: (item: T, index: number) => unknown;
}
declare function For<T>(list: ListAccessor<T>, each: ForEach<T>, options?: ForOptions<T>): ListView;
declare function Index<T>(list: ListAccessor<T>, each: IndexEach<T>): ListView;
declare abstract class SignalsElementType extends HTMLElement {
    /** Build the view with `h` + signals. Runs inside an ownership root. */
    protected abstract render(): Node;
    /** Mount target. Override to return a shadow root; default is light DOM. */
    protected getMountPoint(): Node;
    connectedCallback(): void;
    disconnectedCallback(): void;
}
/**
 * The lifecycle base contract: the abstract constructor type of the `SignalsElement`
 * base. Abstract, so `new SignalsElement()` is rejected (the base has an unimplemented
 * `render`) while `class X extends SignalsElement` is allowed. Returned by
 * {@link createSignalsElement} and the type of the {@link SignalsElement} value.
 */
type SignalsElementClass = typeof SignalsElementType;
/**
 * Build (once, memoized) the `SignalsElement` lifecycle base class. Resolves
 * `HTMLElement` at CALL TIME, so importing `@wcstack/signals/dom` no longer requires
 * a DOM at module-evaluation time — only *calling* this (or subclassing
 * {@link SignalsElement}) does.
 *
 * Contract:
 *   - The `.` entry (`@wcstack/signals`) is non-DOM: it evaluates and runs in SSR,
 *     Node, and Web Workers with no DOM globals.
 *   - The `./dom` entry (`@wcstack/signals/dom`) may now also be *evaluated* without a
 *     DOM (so an SSR pre-pass that imports it for the headless re-exports does not
 *     crash). The DOM-touching surface — `h`/`render`/`For`/`Index` and this base —
 *     still requires DOM globals when actually used.
 *
 * @throws a clear `Error` (not a raw `ReferenceError`) when no `HTMLElement` global is
 *   present, naming the offending entry so the failure is self-explanatory.
 */
declare function createSignalsElement(): SignalsElementClass;
declare const SignalsElement: SignalsElementClass;

export { DisposedError, For, Fragment, Index, SignalsElement, bindNode, computed, createRoot, createSignalsElement, effect, flushSync, h, isDisposedError, nodeSource, onCleanup, render, resource, signal, streamResource };
export type { BoundNode, Child, Cleanup, Component, DefaultNodeShape, EffectHandle, Equals, EventStreamOptions, ForEach, ForOptions, IndexEach, ListAccessor, ListView, NodeShape, Props, ReadSignal, ResourceOptions, ResourceSource, ResourceState, SignalsElementClass, StreamProducer, StreamResourceOptions, StreamResourceState, StreamSource, StreamStatus, WcBindableDescriptor, WcBindableProperty, WriteSignal };
