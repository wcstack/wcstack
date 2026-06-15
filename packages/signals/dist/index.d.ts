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
type StreamSource<C, A> = (args: A, signal: AbortSignal) => StreamProducer<C> | Promise<StreamProducer<C>>;
declare function streamResource<T, C = T, A = void>(source: StreamSource<C, A>, options?: StreamResourceOptions<T, C, A>): StreamResourceState<T>;

interface WcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => unknown;
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
/** Options for `on` — how each event emission folds into the stream signal. */
interface EventStreamOptions<T, C> {
    /** Combine the running value with each emission. Default: latest (replace). */
    fold?: (acc: T | undefined, chunk: C) => T;
    /** Seed value before the first emission. */
    initial?: T;
}
interface BoundNode {
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
declare function bindNode(target: NodeTarget, descriptor?: WcBindableDescriptor): BoundNode;
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
declare function nodeSource<T, A = void>(bound: BoundNode, run: (node: BoundNode, args: A) => Promise<T> | T, options?: {
    abort?: string;
}): ResourceSource<T, A>;

export { bindNode, computed, createRoot, effect, flushSync, nodeSource, onCleanup, resource, signal, streamResource };
export type { BoundNode, Cleanup, EffectHandle, Equals, EventStreamOptions, ReadSignal, ResourceOptions, ResourceSource, ResourceState, StreamProducer, StreamResourceOptions, StreamResourceState, StreamSource, StreamStatus, WcBindableDescriptor, WcBindableProperty, WriteSignal };
