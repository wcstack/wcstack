/**
 * typeErasure.ts — TypeScript syntax erased from a source, every offset kept.
 *
 * The validators read a state's script with acorn, which reads JavaScript only: a `.ts` state file, a module a
 * page loads (`<script type="module" src="./main.ts">` and what it imports), a getter body with `x as T` or a
 * typed local did not parse, and each rule that reads one said nothing (the lending-desk seam app: a page-defined
 * element in a `.ts` module was never checked). This erases the types first, the way the runtime's build would:
 * annotations, `as` / `satisfies`, `!`, type parameters and arguments, `interface` / `type` declarations,
 * `import type` become spaces of the same length, so a position in the result is the same position in the source.
 *
 * The eraser is Node's `module.stripTypeScriptTypes` (mode `strip`; Node 22.13 / 23.2 and later, VS Code's
 * extension host included), reached through `process.getBuiltinModule` so that nothing is imported where Node is
 * not there, and nothing is bundled (`@wcstack/lint` keeps no dependency). Node marks it experimental and says so
 * once per process on stderr: that warning is held back while it runs, so the CLI's output is only its findings.
 * Where the eraser is missing (an older Node) or refuses the source (an `enum`, a `namespace`, a parameter property
 * — syntax that has to be rewritten, not erased — or a source that is not TypeScript either), the result is null
 * and the caller stays silent, as before.
 *
 * pure (DOM / vscode 非依存).
 */

import { parse, type AnyNode, type Options } from 'acorn';

type Strip = (code: string, options: { readonly mode: 'strip' }) => string;

interface NodeProcess {
  getBuiltinModule?: (id: string) => unknown;
  emitWarning: (...args: unknown[]) => void;
}

/** Node's eraser, or null where there is none. */
function stripper(): Strip | null {
  const proc = (globalThis as { process?: NodeProcess }).process;
  if (proc === undefined || typeof proc.getBuiltinModule !== 'function') return null;
  const mod = proc.getBuiltinModule('node:module') as { stripTypeScriptTypes?: unknown } | undefined;
  return typeof mod?.stripTypeScriptTypes === 'function' ? (mod.stripTypeScriptTypes as Strip) : null;
}

/** Runs `fn` with Node's ExperimentalWarning for the eraser held back (any other warning goes through). */
function quietly<T>(proc: NodeProcess, fn: () => T): T {
  const emit = proc.emitWarning;
  proc.emitWarning = (...args: unknown[]): void => {
    const [warning, type] = args;
    const text = typeof warning === 'string' ? warning : warning instanceof Error ? warning.message : '';
    const kind = typeof type === 'string' ? type : (type as { type?: unknown } | undefined)?.type;
    if ((kind === 'ExperimentalWarning' || (warning instanceof Error && warning.name === 'ExperimentalWarning'))
      && /strip|typescript/i.test(text)) return;
    emit.apply(proc, args);
  };
  try {
    return fn();
  } finally {
    proc.emitWarning = emit;
  }
}

// erased sources by text (one state file is read by many validators)
const erased = new Map<string, string | null>();
const MAX_ERASED = 64;

/**
 * `code` with its TypeScript syntax replaced by spaces (same length, same lines), or null when it cannot be erased:
 * no eraser in this runtime, or syntax that is not erasable / not valid.
 */
export function eraseTypeScript(code: string): string | null {
  const cached = erased.get(code);
  if (cached !== undefined || erased.has(code)) return cached ?? null;
  const strip = stripper();
  if (strip === null) return null;
  const proc = (globalThis as { process?: NodeProcess }).process as NodeProcess;
  let out: string | null;
  try {
    const result = quietly(proc, () => strip(code, { mode: 'strip' }));
    out = typeof result === 'string' && result.length === code.length ? result : null;
  } catch {
    out = null;
  }
  if (erased.size >= MAX_ERASED) erased.delete(erased.keys().next().value as string);
  erased.set(code, out);
  return out;
}

/**
 * acorn's `parse`, and when the source does not parse as JavaScript, the same source with its TypeScript syntax
 * erased (`eraseTypeScript` — the offsets are the source's). Throws as `parse` does when neither parses.
 */
export function parseErasingTypes(source: string, options: Options): AnyNode {
  try {
    return parse(source, options) as AnyNode;
  } catch (error) {
    const js = eraseTypeScript(source);
    if (js === null) throw error;
    return parse(js, options) as AnyNode;
  }
}
