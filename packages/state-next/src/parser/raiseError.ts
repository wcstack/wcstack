import { hooks } from "../hooks";

/**
 * Throws `[@wcstack/state] <message>`. The core's messages state the code and the fact; the
 * diagnostics add-on, when installed, appends the guidance (the nearest of `candidates` to
 * `subject`, how to fix it, the lint pointer).
 */
export function raiseError(message: string, subject?: string, candidates?: Iterable<string>): never {
  throw new Error(`[@wcstack/state] ${message}${hooks.explain === null ? "" : hooks.explain(message, subject, candidates)}`);
}
