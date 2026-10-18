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
 *   optional key on purpose. A path built at run time (`this[key]`, `` this[`drafts.${key}`] ``) is not read.
 * - `wcs/path-dynamic-unknown` (info): a top-level spread in `export default { … }` (`...sanitizeInputs({}).inputs`)
 *   with no stateSchema. The keys it brings in cannot be read, so the state's paths are not checked at all — said
 *   once, at the spread, with what turns the checks on (a stateSchema, which `wcs-schema` derives from the types).
 *
 * The existence is the bindings' (bindingValidator): the candidates of the document's states with the stateSchema's,
 * a stateSchema deciding where it is declared (`nonexistent` only), silence in a state that could not be read.
 * A volume's script reads its own state: its paths are looked up under the mount path.
 */

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import type { JsonSchemaNode } from '../core/sidecar/types.js';
import { analyzeCallableBodies, findTopLevelSpread, mergeSchemaCandidates, type PathCandidate } from './stateAnalyzer.js';
import { getStatePathIndex, isUnresolvedPath, type FileReader } from './statePathResolver.js';
import { pathExistsInCandidates, resolveIndexedSchemaPath } from './bindingValidator.js';
import { collectGetterReads } from './scriptAst.js';
import { hasIndexSegment, toWildcardForm } from './indexPath.js';
import { hasRecursionWildcard } from './recursionPaths.js';
import { suggestion } from './suggestion.js';

export function validateScriptReads(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
  applicationSchema?: JsonSchemaNode,
): WcsDiagnostic[] {
  const blocks = parseLoadedScriptBlocks(html, stateTagName);
  if (blocks.length === 0) return [];
  const msgs = getMessages(locale);
  const index = getStatePathIndex(html, stateTagName, fileReader);
  const candidates = mergeSchemaCandidates(index.paths, applicationSchema);
  const candidateSet = new Set(candidates.map((p) => p.path));
  let tree: Map<string, Set<string>> | null = null;
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
    for (const callable of analyzeCallableBodies(block.content)) {
      for (const read of collectGetterReads(callable.body) ?? []) {
        // (a compound assignment's read is a write first: wcs/write-path-missing)
        if (read.written || read.path.split('.').some((s) => s === '' || s.startsWith('$')) || hasRecursionWildcard(read.path)) continue;
        const path = prefix + read.path;
        if (pathExistsInCandidates(path, candidates, candidateSet)) continue;
        if (applicationSchema !== undefined ? resolveIndexedSchemaPath(applicationSchema, path).kind !== 'nonexistent' : isUnresolvedPath(path, index.scopes)) continue;
        const near = nearName(path, (tree ??= treeOf(candidates)));
        if (near === null) continue;
        const said = suggestion(near.segment, near.names, msgs);
        if (said === '') continue;
        const at = block.contentStart + callable.bodyStart;
        out.push({
          code: WcsDiagnosticCode.ReadPathMissing,
          start: at + read.start,
          end: read.form === 'member' ? at + read.start + statePart(callable.body.slice(read.start, read.end)) : at + read.end,
          message: msgs.readPathMissing(read.path, !read.path.includes('.')) + said,
          // a stateSchema says the path is not there, as for a binding's `wcs/path-nonexistent`
          severity: applicationSchema !== undefined ? 'error' : 'warning',
        });
      }
    }
  }
  return out;
}

/** `this.totl` / `this["a.b"]` of a longer chain (`this.totl.length`): the length of what reads the state. */
const THIS_PART = /^this\s*(?:\?\.\s*|\.\s*)(?:[A-Za-z_$][\w$]*)|^this\s*(?:\?\.)?\s*\[\s*(["'`])[^"'`]*\1\s*\]/;

function statePart(text: string): number {
  return THIS_PART.exec(text)?.[0].length ?? text.length;
}

/** The candidates as a tree: a path → the names under it. A deeper candidate makes the segments on its way. */
function treeOf(candidates: readonly PathCandidate[]): Map<string, Set<string>> {
  const tree = new Map<string, Set<string>>();
  for (const c of candidates) {
    let parent = '';
    for (const segment of c.path.split('.')) {
      let names = tree.get(parent);
      if (names === undefined) tree.set(parent, (names = new Set()));
      names.add(segment);
      parent = parent === '' ? segment : `${parent}.${segment}`;
    }
  }
  return tree;
}

/**
 * The first segment of `path` the candidates lack, with the names they have beside it (the keys of its parent). A
 * numeric index reads as `*`, as the runtime reads it. null when every segment is there.
 */
function nearName(path: string, tree: ReadonlyMap<string, ReadonlySet<string>>): { segment: string; names: string[] } | null {
  let parent = '';
  for (const segment of (hasIndexSegment(path) ? toWildcardForm(path) : path).split('.')) {
    const names = tree.get(parent);
    if (names?.has(segment)) {
      parent = parent === '' ? segment : `${parent}.${segment}`;
      continue;
    }
    return { segment, names: [...(names ?? [])].filter((name) => name !== '*' && !name.startsWith('$')) };
  }
  return null;
}
