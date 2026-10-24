import { hooks } from "../hooks";

/**
 * Throws `[@wcstack/state] <message>`. The core's messages state the fact (a number and values); the
 * diagnostics add-on, when installed, appends the guidance (the nearest of `candidates` to
 * `subject`, how to fix it, the lint pointer).
 */
export function raiseError(message: string, subject?: string, candidates?: Iterable<string>): never {
  throw new Error(`[@wcstack/state] ${message}${hooks.explain?.(message, subject, candidates) ?? ""}`);
}

/**
 * Reports an error the engine caught or found — a getter, a filter, a handler or a callback of the
 * page that threw, a `<wcs-state>` that failed to initialize, an update loop cut — through the
 * platform's `reportError()`, so the page's error handlers (`window.onerror`, an `error` listener)
 * see it as an uncaught error, and the console shows it. A production error reporter heard none of
 * them when they went to `console.error` (docs/seam-apps.md, prod-booking). `message` says where
 * (the element, the binding): the reported Error carries both, with the original as its `cause`.
 * Where there is no `reportError()` (happy-dom, Node) it is `console.error` with the arguments as
 * before.
 */
export function report(error: unknown, message?: string, ...rest: unknown[]): void {
  if (typeof reportError !== "function") console.error(...(message === undefined ? [error] : [message, error]), ...rest);
  else reportError(message === undefined ? error : new Error(`${message} ${error}`, { cause: error }));
}
