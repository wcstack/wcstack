/**
 * accessorListValidator.ts
 *
 * The two script syntaxes of @wcstack/state 4.22, checked where the runtime is silent or fails late:
 *
 * - a path relative to the row (`this[".name"]`, `this["."]`): the path under the element of the list the
 *   code runs at a row of, as `.name` in a `for:` template — `this["users.*.name"]` in `get "users.*.fullname"()`;
 * - one accessor declared for several paths (`get "users.*.fullname,employees.*.fullname"()`), whose body
 *   names its row by relative paths only.
 *
 * - `wcs/accessor-list-syntax` (error): a key listing several accessor paths with a space beside a comma, an
 *   empty entry, or a recursive path (`**`). The runtime takes what is between the commas as it is, so a
 *   path with a space is one nothing reads (the diagnostics add-on refuses the state with the same code; a
 *   recursive path in a list is refused by the recursion add-on).
 * - `wcs/accessor-list-path` (error): the body of an accessor declared for several lists reads or writes the
 *   rows of one of them by a full path (`this["users.*.first"]`). At the rows of the other lists that path has
 *   no row: a read gives undefined and a write throws (the diagnostics add-on warns with the same code). Only
 *   `this[...]` — `$getAll("users.*.first", [])` names its rows itself.
 * - `wcs/wildcard-rank` (error): a relative path in an accessor whose key has no `*`. There is no row, and the
 *   runtime throws #1402 each time it is evaluated. (In markup the code is a warning: the enclosing `for:` is
 *   reconstructed; here the key says it.) Also a relative path handed to `$resolve`, `$setAll` or `$update`, in
 *   any body: they take their rows from `indexes`, the runtime expands no relative path there, and the call throws.
 *
 * A relative path in a method is not checked: its row is the caller's (a handler in a `for:` row, a `$setAll`
 * mapper), which the method's own text does not say.
 */

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import { accessorRow, analyzeCallableBodies, hasDefaultExportObject, type CallableBody } from './stateAnalyzer.js';
import { collectGetterReads } from './scriptAst.js';
import { hasRecursionWildcard } from './recursionPaths.js';

const OPTIONS = { templates: true, writes: true, resolveWrites: true, untracked: true } as const;
/** The APIs that take their rows from `indexes`: the runtime expands no relative path there. */
const INDEXED_APIS = new Set(['$resolve', '$setAll', '$update']);

/** `users.*.first` → `users.*`: the row a path with a `*` needs; null when it has none. */
function rowOfPath(path: string): string | null {
  const at = path.lastIndexOf('*');
  return at < 0 ? null : path.slice(0, at + 1);
}

/** Does code running at `row` have the row `needed` (the same one, or one of the lists above it)? */
function hasRow(row: string | null, needed: string): boolean {
  return row !== null && (row === needed || row.startsWith(`${needed}.`));
}

export function validateAccessorLists(html: string, stateTagName: string = 'wcs-state', locale?: string): WcsDiagnostic[] {
  const blocks = parseLoadedScriptBlocks(html, stateTagName).filter((block) => hasDefaultExportObject(block.content));
  if (blocks.length === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const block of blocks) {
    const at = (start: number, end: number) => ({ start: block.contentStart + start, end: block.contentStart + end });
    // (a key is declared once per path and once more by its setter: each key's text is checked once per place)
    const keys = new Set<number>();
    for (const callable of analyzeCallableBodies(block.content)) {
      const listed = callable.listed;
      if (listed !== undefined && !keys.has(listed.start)) {
        keys.add(listed.start);
        const why = listSyntax(listed.key, listed.paths);
        if (why !== null) {
          out.push({
            code: WcsDiagnosticCode.AccessorListSyntax,
            ...at(listed.start, listed.end),
            message: msgs.accessorListSyntax(listed.key, why),
            severity: 'error',
          });
        }
      }
      // the body is the same for every path of a list: read once, at the first
      if (listed !== undefined && listed.paths[0] !== callable.name) continue;
      const reads = collectGetterReads(callable.body, OPTIONS);
      if (reads === null) continue;
      const rows = (listed?.paths ?? [callable.name]).map((name) => accessorRow({ name, kind: callable.kind }));
      for (const read of reads) {
        if (read.form === 'opaque') continue;
        const place = at(callable.bodyStart + read.start, callable.bodyStart + read.end);
        // (wherever it runs, a method's body and a nested function too: these never read the row)
        if (read.path.startsWith('.') && read.api !== undefined && INDEXED_APIS.has(read.api)) {
          out.push({ code: WcsDiagnosticCode.WildcardRank, ...place, message: msgs.relativeApiPath(read.path, read.api), severity: 'error' });
          continue;
        }
        if (callable.kind !== 'getter' || read.nested === true) continue;
        if (read.path.startsWith('.')) {
          // no row at any of its paths: #1402 each time (a row at some of them is `wcs/accessor-list-path`'s kind
          // of mistake the other way round, and rare: a list mixing row and root paths)
          if (rows.every((row) => row === null)) {
            out.push({ code: WcsDiagnosticCode.WildcardRank, ...place, message: msgs.relativeNoRow(read.path, describe(callable)), severity: 'error' });
          }
          continue;
        }
        if (listed === undefined || read.form === 'api' || read.form === 'api-write' || read.form === 'track') continue;
        if (hasRecursionWildcard(read.path)) continue;
        const needed = rowOfPath(read.path);
        if (needed === null) continue;
        const home = rows.findIndex((row) => hasRow(row, needed));
        const away = rows.findIndex((row) => !hasRow(row, needed));
        if (home < 0 || away < 0) continue;
        const rest = read.path.slice(rows[home]!.length);
        out.push({
          code: WcsDiagnosticCode.AccessorListPath,
          ...place,
          message: msgs.accessorListPath(read.path, needed.slice(0, -2), listed.paths[away], rest === '' ? '.' : rest),
          severity: 'error',
        });
      }
    }
  }
  return out;
}

/** What is wrong with a key that lists several paths, or null. */
function listSyntax(key: string, paths: readonly string[]): 'space' | 'empty' | 'recursive' | null {
  if (/\s/.test(key)) return 'space';
  if (key.split(',').some((part) => part === '')) return 'empty';
  return paths.some(hasRecursionWildcard) ? 'recursive' : null;
}

/** The accessor as its key is written (the whole list, for one declared for several paths). */
function describe(callable: CallableBody): string {
  return callable.listed?.key ?? callable.name;
}
