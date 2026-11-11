/**
 * scriptReadValidator.ts
 *
 * The state paths a state's own script reads, checked against the state as the bindings are. An outside evaluation
 * (an AI author's tax return draft on @wcstack/state 4.2.0: 96 getters over 34 inputs and 3 tables) found the lint
 * checked only the markup's paths, so a typo in a getter was left to the tests — where the result is a sum of money.
 *
 * - `wcs/read-path-missing` (warning; error where a stateSchema says the path is not there, as a binding's
 *   `wcs/path-nonexistent`): a path a getter, setter or method reads through `this` — `this["items.*.amout"]`,
 *   `this.totl`, `this.$getAll("items.*.amout", [])`, `$resolve` / `$dependOn` — that the state does not have, beside
 *   a near one it has. A nested read gives undefined, and what is computed from it is wrong without a word (the
 *   runtime's diagnostics add-on warns once, with the same code, when a getter has read it); a top-level key the
 *   state lacks throws when it is read. Only with a near name, as at runtime: `this["opts.flag"] ?? false` reads an
 *   optional key on purpose. A path built at run time (`this[key]`, `` this[`drafts.${key}`] `` under an object) is not
 *   read; a template whose expressions each fill a segment under a list (`` this[`items.${i}.amout`] ``) is read as
 *   `items.*.amout`, as the runtime reads it.
 * - `wcs/write-path-missing` (warning): a nested path a script writes — `this["items.*.nmae"] = …`, a compound
 *   assignment, the template form, `$setAll` / `$update`'s path — that the state does not have, beside a near one it has.
 *   The write creates a key in the object, and the declared path's bindings stay as they were. The top-level
 *   `this.<key> = …` is scriptStateUseValidator's.
 * - `wcs/path-dynamic-unknown` (info): a top-level spread in `export default { … }` (`...sanitizeInputs({}).inputs`)
 *   with no stateSchema. The keys it brings in cannot be read, so the state's paths are not checked at all — said
 *   once, at the spread, with what turns the checks on (a stateSchema, which `wcs-schema` derives from the types).
 *   Also a key whose value the analyzer could not read — a name it could not follow to a literal (`{ t }` with `t`
 *   imported and computed — the i18n dictionary volume; moduleValues.ts) — when the document binds paths under it:
 *   those are not checked. Said once per key, at the key, with what has them checked (a JSDoc `@type`, or a
 *   stateSchema); a key nothing reads under says nothing. The same for a key seeded with an object literal that spreads
 *   what the analyzer cannot read (`draft: { ...makeDraft() }` — a spread of a module's `const` object literal is read:
 *   the homeroom seam app), with its own message naming the spread.
 *
 * The existence is the bindings' (bindingValidator): the candidates of the document's states with the stateSchema's,
 * a stateSchema deciding where it is declared (`nonexistent` only), silence in a state that could not be read.
 * A volume's script reads its own state: its paths are looked up under the mount path.
 */

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { buildReferenceIndex } from '../core/index/referenceIndex.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import type { JsonSchemaNode } from '../core/sidecar/types.js';
import { accessorRow, analyzeCallableBodies, analyzeDeclarationSpans, analyzeStatePaths, findTopLevelSpread, mergeSchemaCandidates, type PathCandidate } from './stateAnalyzer.js';
import { getStatePathIndex, isUnresolvedPath, moduleLocationOf, type FileReader } from './statePathResolver.js';
import { pathExistsInCandidates, resolveIndexedSchemaPath } from './bindingValidator.js';
import { collectGetterReads } from './scriptAst.js';
import { hasIndexSegment, toWildcardForm } from './indexPath.js';
import { hasRecursionWildcard } from './recursionPaths.js';
import { missingSegment, pathTree, suggestion } from './suggestion.js';

export function validateScriptReads(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
  applicationSchema?: JsonSchemaNode,
  bindAttribute: string = 'data-wcs',
): WcsDiagnostic[] {
  const blocks = parseLoadedScriptBlocks(html, stateTagName);
  if (blocks.length === 0) return [];
  const msgs = getMessages(locale);
  const index = getStatePathIndex(html, stateTagName, fileReader);
  const candidates = mergeSchemaCandidates(index.paths, applicationSchema);
  const candidateSet = new Set(candidates.map((p) => p.path));
  let tree: Map<string, Set<string>> | null = null;
  // the paths the document binds (attributes, mustache, comment bindings), read once when a key's value is unknown
  let bound: string[] | null = null;
  const out: WcsDiagnostic[] = [];

  for (const block of blocks) {
    // --- the lint's limit: a spread whose keys cannot be read, and no stateSchema to read them from
    const spread = applicationSchema === undefined ? findTopLevelSpread(block.content) : null;
    if (spread !== null) {
      out.push({
        code: WcsDiagnosticCode.PathDynamicUnknown,
        start: block.contentStart + spread.start,
        end: block.contentStart + spread.end,
        message: msgs.pathDynamicUnknownSpread(block.content.slice(spread.start, spread.end)),
        severity: 'info',
      });
    }

    // --- the paths its getters, setters and methods read
    const prefix = block.mountPath === null || block.mountPath === '' ? '' : `${block.mountPath}.`;

    // --- the lint's limit: a key whose value it could not read, with bindings under it (a stateSchema decides instead)
    if (applicationSchema === undefined) {
      const opaque = analyzeStatePaths(block.content, moduleLocationOf(fileReader, block.modulePath)).filter((p) => p.opaque !== undefined);
      const spans = opaque.length === 0 ? [] : analyzeDeclarationSpans(block.content);
      for (const candidate of opaque) {
        const path = prefix + candidate.path;
        bound ??= buildReferenceIndex(html, { bindAttribute, stateTagName }).occurrences
          .filter((o) => o.kind === 'path')
          .map((o) => (hasIndexSegment(o.path) ? toWildcardForm(o.path) : o.path));
        const count = bound.filter((b) => b.startsWith(`${path}.`)).length;
        const span = spans.find((s) => candidate.path === s.name || candidate.path.startsWith(`${s.name}.`));
        if (count === 0 || span === undefined) continue;
        out.push({
          code: WcsDiagnosticCode.PathDynamicUnknown,
          start: block.contentStart + span.start,
          end: block.contentStart + span.end,
          message: candidate.opaque?.spread !== undefined
            ? msgs.pathDynamicUnknownObjectSpread(path, count, candidate.opaque.spread, candidate.opaque.from)
            : msgs.pathDynamicUnknownValue(path, count, candidate.opaque?.name, candidate.opaque?.from),
          severity: 'info',
        });
      }
    }
    // an accessor declared for several paths is read once per path (a relative path is another list's rows each
    // time): what is said at one place of its body is said once
    const saidInListed = new Set<string>();
    for (const callable of analyzeCallableBodies(block.content)) {
      // a path relative to the row (`this[".name"]` in `get "users.*.fullname"()`) is read as the path under it;
      // in a method the row is the caller's, so it stays as written and is not checked
      for (const read of collectGetterReads(callable.body, { templates: true, writes: true, row: accessorRow(callable) }) ?? []) {
        // a compound assignment reads and then writes: a write first
        const write = read.written || read.form === 'write' || read.form === 'api-write';
        // (`this.<key> = …` at the top level is scriptStateUseValidator's wcs/write-path-missing)
        if (write && read.form !== 'api-write' && !read.path.includes('.')) continue;
        if (read.path.split('.').some((s) => s === '' || s.startsWith('$')) || hasRecursionWildcard(read.path)) continue;
        const path = prefix + read.path;
        // `` this[`drafts.${key}`] ``: under an object that is not a list, the expression is a key, not an index
        if (read.indexed !== undefined && !read.indexed.every((list) => isList(prefix + list, candidates, candidateSet))) continue;
        if (pathExistsInCandidates(path, candidates, candidateSet)) continue;
        if (applicationSchema !== undefined ? resolveIndexedSchemaPath(applicationSchema, path).kind !== 'nonexistent' : isUnresolvedPath(path, index.scopes)) continue;
        const near = missingSegment(path, (tree ??= pathTree(candidates)));
        if (near === null) continue;
        const said = suggestion(near.segment, near.names, msgs);
        if (said === '') continue;
        const at = block.contentStart + callable.bodyStart;
        if (callable.listed !== undefined) {
          const place = `${write}:${at + read.start}`;
          if (saidInListed.has(place)) continue;
          saidInListed.add(place);
        }
        const member = read.form === 'member' || read.form === 'write';
        out.push({
          code: write ? WcsDiagnosticCode.WritePathMissing : WcsDiagnosticCode.ReadPathMissing,
          start: at + read.start,
          end: member ? at + read.start + statePart(callable.body.slice(read.start, read.end)) : at + read.end,
          message: (write ? msgs.nestedWritePathMissing(read.path) : msgs.readPathMissing(read.path, !read.path.includes('.')))
            + (read.relative === undefined ? '' : msgs.relativePathOf(read.relative, callable.name)) + said,
          // a stateSchema says the path is not there, as for a binding's `wcs/path-nonexistent` (a write stays a
          // warning, as the top-level one: a key the state adds on purpose is not a mistake)
          severity: !write && applicationSchema !== undefined ? 'error' : 'warning',
        });
      }
    }
  }
  return out;
}

/** Is `path` a list of the state: a list candidate, or one with rows (`items.*`)? */
function isList(path: string, candidates: readonly PathCandidate[], candidateSet: ReadonlySet<string>): boolean {
  return candidateSet.has(`${path}.*`) || candidates.some((c) => c.path === path && c.kind === 'list');
}

/** `this.totl` / `this["a.b"]` of a longer chain (`this.totl.length`): the length of what reads the state. */
const THIS_PART = /^this\s*(?:\?\.\s*|\.\s*)(?:[A-Za-z_$][\w$]*)|^this\s*(?:\?\.)?\s*\[\s*(["'`])[^"'`]*\1\s*\]/;

function statePart(text: string): number {
  return THIS_PART.exec(text)?.[0].length ?? text.length;
}
