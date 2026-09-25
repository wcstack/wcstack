/**
 * The temporal add-on (@wcstack/state/features/temporal): `$watch` and `$stream`.
 * At the end of every drain, after its report (`$renderedCallback`): the watches, then the
 * stream restarts. Both start after `$connectedCallback` and stop on disconnect.
 */
import type { Engine } from "../engine";
import { addHook, type Feature } from "../hooks";
import { raiseError } from "../parser/raiseError";
import { parseWatches, WatchRuntime } from "../temporal/watch";
import { internalWrite, parseStreams, StreamRuntime } from "../temporal/stream";

interface Runtime {
  watch: WatchRuntime;
  stream: StreamRuntime;
  connected: boolean;
}

const runtimes = new WeakMap<Engine, Runtime>();

function declare(engine: Engine, target: Record<string, any>): void {
  const watch = new WatchRuntime(engine, parseWatches(engine, target.$watch));
  const stream = new StreamRuntime(engine, parseStreams(engine, target));
  const old = runtimes.get(engine);
  if (old !== undefined) {
    old.watch.deactivate();
    old.stream.abortAll();
  }
  runtimes.set(engine, { watch, stream, connected: old?.connected ?? false });
}

function element(engine: Engine, phase: "mounting" | "connected" | "disconnected" | "reset"): void {
  const rt = runtimes.get(engine)!;
  if (phase === "mounting") return;
  if (phase === "disconnected") {
    rt.connected = false;
    rt.watch.deactivate();
    rt.stream.stopAll();
    return;
  }
  if (phase === "connected") rt.connected = true;
  else if (!rt.connected) return;
  rt.watch.activate();
  rt.stream.startAll();
}

const NAMESPACES = ["$streamStatus", "$streamError"];

export const temporal: Feature = {
  name: "temporal",
  install(): void {
    addHook("declare", declare);
    addHook("element", element);
    addHook("written", (engine, p, row, old, value, direct) => runtimes.get(engine)?.watch.written(p, row, old, value, direct));
    addHook("getterReached", (engine, g, row) => {
      const rt = runtimes.get(engine);
      if (rt === undefined) return;
      rt.watch.getterReached(g, row);
      rt.stream.getterReached(g);
    });
    addHook("listSynced", (engine, list, old) => runtimes.get(engine)?.watch.listSynced(list, old));
    addHook("drained", (engine) => {
      const rt = runtimes.get(engine);
      if (rt === undefined) return;
      rt.watch.drained();
      rt.stream.drained();
    });
    // `this.$streamStatus` (the object, untracked) and `this["$streamStatus.x"]` (tracked)
    addHook("dollar", (engine, key) => {
      const ns = key.split(".", 1)[0];
      if (!NAMESPACES.includes(ns)) return undefined;
      return ns === key ? engine.target[key] : engine.read(engine.pattern(key), null);
    });
    addHook("beforeWrite", (_engine, p) => {
      if (!internalWrite && p.path.charCodeAt(0) === 36 && NAMESPACES.includes(p.path.split(".", 1)[0])) {
        raiseError(`"${p.path}" is read-only (the stream runtime owns it).`);
      }
      return false;
    });
  },
};
export default temporal;
