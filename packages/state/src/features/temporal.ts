/**
 * The temporal add-on (@wcstack/state/features/temporal): `$watch` and `$stream`.
 * At the end of every drain, after its report (`$renderedCallback`): the watches, then the
 * stream restarts. Both start after `$connectedCallback` and stop on disconnect.
 */
import type { Engine } from "../engine";
import { chain, first, handled, hooks, known, type Feature } from "../hooks";
import { raiseError } from "../parser/raiseError";
import { parseWatches, WatchRuntime } from "../temporal/watch";
import { internalWrite, parseStreams, StreamRuntime } from "../temporal/stream";

interface Runtime {
  watch: WatchRuntime;
  stream: StreamRuntime;
  connected: boolean;
  /** The state it was made for: a re-set refused after it (list-keys, recursion) leaves the old one in place. */
  target: object;
}

const runtimes = new WeakMap<Engine, Runtime>();
/** The engine's runtime when it is its state's (not one a refused re-set left: that one never runs). */
function live(engine: Engine): Runtime | undefined {
  const rt = runtimes.get(engine);
  return rt?.target === engine.target ? rt : undefined;
}

function declare(engine: Engine, target: Record<string, any>): void {
  const watch = new WatchRuntime(engine, parseWatches(engine, target.$watch));
  const stream = new StreamRuntime(engine, parseStreams(engine, target), watch);
  const old = runtimes.get(engine);
  if (old !== undefined) {
    old.watch.deactivate();
    old.stream.abortAll();
  }
  runtimes.set(engine, { watch, stream, connected: old?.connected ?? false, target });
}

function element(engine: Engine, phase: "mounting" | "connected" | "disconnected" | "reset"): void {
  const rt = runtimes.get(engine);
  // an engine made before the add-on was installed has no runtime (and declares nothing temporal);
  // a server render (@wcstack/server) keeps streams at their initial value and watches off
  if (rt === undefined || phase === "mounting" || document.documentElement?.hasAttribute("data-wcs-server")) return;
  // (kept on a runtime a refused re-set left too: the next re-set takes it over)
  if (phase !== "reset") rt.connected = phase === "connected";
  // a refused state's runtime never runs, nor stops (writes `$streamStatus`), on the state that stayed
  if (rt.target !== engine.target) return;
  if (phase === "disconnected") {
    rt.watch.deactivate();
    rt.stream.stopAll();
    return;
  }
  if (!rt.connected) return;
  rt.watch.activate();
  rt.stream.startAll();
}

const NAMESPACES = ["$streamStatus", "$streamError"];

export const temporal: Feature = {
  name: "temporal",
  install(): void {
    hooks.declare = chain(hooks.declare, declare);
    hooks.element = chain(hooks.element, element);
    hooks.written = chain(hooks.written, (engine, p, row, old, value, direct) => live(engine)?.watch.written(p, row, old, value, direct));
    hooks.getterReached = chain(hooks.getterReached, (engine, g, row) => {
      const rt = live(engine);
      if (rt === undefined) return;
      rt.watch.getterReached(g, row);
      rt.stream.getterReached(g);
    });
    hooks.listSynced = chain(hooks.listSynced, (engine, list, old) => live(engine)?.watch.listSynced(list, old));
    hooks.drained = chain(hooks.drained, (engine) => {
      const rt = live(engine);
      if (rt === undefined) return;
      rt.watch.drained();
      rt.stream.drained();
    });
    // `this.$streamStatus` (the object, untracked) and `this["$streamStatus.x"]` (tracked)
    hooks.dollar = first(known, hooks.dollar, (engine, key) => {
      const ns = key.split(".", 1)[0];
      if (!NAMESPACES.includes(ns)) return undefined;
      return ns === key ? engine.target[key] : engine.read(engine.pattern(key), null);
    });
    hooks.beforeWrite = first(handled, hooks.beforeWrite, (_engine, p) => {
      if (!internalWrite && p.path.charCodeAt(0) === 36 && NAMESPACES.includes(p.path.split(".", 1)[0])) {
        raiseError(`"${p.path}" is read-only (the stream runtime owns it).`);
      }
      return false;
    });
  },
};
export default temporal;
