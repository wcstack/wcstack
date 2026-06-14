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
interface BoundNode {
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
declare function bindNode(target: NodeTarget, descriptor?: WcBindableDescriptor): BoundNode;

declare const Fragment: unique symbol;
type Child = unknown;
type Props = Record<string, unknown> | null;
type Component = (props: Record<string, unknown>) => Node | Child[];
declare function h(tag: string | typeof Fragment | Component, props?: Props, ...children: Child[]): Node;
/** Append `child` into `container`, resolving fragments/arrays. */
declare function render(child: Child, container: Node): Node;
declare abstract class SignalsElement extends HTMLElement {
    private _dispose;
    /** Build the view with `h` + signals. Runs inside an ownership root. */
    protected abstract render(): Node;
    /** Mount target. Override to return a shadow root; default is light DOM. */
    protected getMountPoint(): Node;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { Fragment, SignalsElement, bindNode, computed, createRoot, effect, flushSync, h, onCleanup, render, resource, signal, streamResource };
export type { BoundNode, Child, Cleanup, Component, EffectHandle, Equals, Props, ReadSignal, ResourceOptions, ResourceSource, ResourceState, StreamProducer, StreamResourceOptions, StreamResourceState, StreamSource, StreamStatus, WcBindableDescriptor, WcBindableProperty, WriteSignal };
