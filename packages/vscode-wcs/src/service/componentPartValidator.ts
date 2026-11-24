/**
 * componentPartValidator.ts — a class part a page mounts (`bind-component`), checked as the page's own state and
 * markup are.
 *
 * **Its methods.** In a part's method `this.tenant.name = v` and `this.plots.push(p)` miss the state exactly as they
 * do on a page: the tile keeps the old name, no row is added, and nothing says so. On a page both are errors
 * (`wcs/nested-assign`, `wcs/array-mutation`); in a class file the lint read nothing (the garden-plots seam app —
 * `push` passed every check its author had). The part's `state = { … }` literal is read as a state script, and the
 * two rules are applied to it: they look at how a script writes, not at which keys exist, so the data the part is
 * mounted on does not matter.
 *
 * **Its template's paths.** Inside a mounted part a read falls through to the object it is mounted on and fails
 * nothing, so a wrong name at the seam showed an empty field and said nothing — `state.veiw: view` on the page,
 * `veiw.x` in the part, `nmae` in its template, a path of the page read in the part (the runtime reports these since
 * 4.28). A path of the template is reported (`wcs/binding-path-missing`, warning) when its **first key** is none of:
 * a key of the part's own state, a key the page hands it (`state.view:`), a key of the object it is mounted on. That
 * object is judged only where its shape is known — it has keys the validator can see (a seed, a JSDoc type, a
 * schema): rows of a list that starts empty say nothing. Deeper than the first key nothing is said: the part may
 * answer the path itself.
 *
 * A finding is in the part's file (`origin`): the CLI reports it there, once however many pages mount the part, and
 * the IDE shows it where the page names the part — the import map's entry for the tag or the tag's first element
 * (the methods), the element that mounts it (the template).
 *
 * pure (DOM / vscode 非依存).
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { createPositionMapper } from '../core/offsetToPosition.js';
import type { JsonSchemaNode } from '../core/sidecar/types.js';
import { validateArrayMutations } from './arrayMutationValidator.js';
import { pathExistsInCandidates } from './bindingValidator.js';
import {
  collectClassParts, mayMountParts, templateUses, walkMountSites, type ClassPart, type TemplateUse,
} from './componentParts.js';
import { validateNestedAssigns } from './nestedAssignValidator.js';
import { mergeSchemaCandidates, type PathCandidate } from './stateAnalyzer.js';
import { getStatePathIndex, isUnresolvedPath, type FileReader, type StatePathScopes } from './statePathResolver.js';
import { suggestion } from './suggestion.js';

const PREFIX = '<wcs-state><script type="module">export default ';
const SUFFIX = ';</script></wcs-state>';

/** Where a page names a part: the import map's value for the tag, or the tag's first start tag (the start of the page otherwise). */
function anchorOf(source: string, tag: string): { start: number; end: number } {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entry = new RegExp(`"@components/${escaped}(?:\\|[^"]*)?"\\s*:\\s*"([^"]*)"`, 'i').exec(source);
  if (entry !== null) {
    const start = entry.index + entry[0].length - 1 - entry[1].length;
    return { start, end: start + entry[1].length };
  }
  const element = new RegExp(`<${escaped}(?=[\\s/>])`, 'i').exec(source);
  if (element !== null) return { start: element.index + 1, end: element.index + 1 + tag.length };
  return { start: 0, end: Math.min(1, source.length) };
}

/** The script rules over one part's state literal, as findings in the part's file. */
function partFindings(part: ClassPart, locale: string | undefined): { code: string; start: number; end: number; message: string; severity: WcsDiagnostic['severity'] }[] {
  const virtual = PREFIX + part.text.slice(part.stateStart, part.stateEnd) + SUFFIX;
  const shift = part.stateStart - PREFIX.length;
  const out: { code: string; start: number; end: number; message: string; severity: WcsDiagnostic['severity'] }[] = [];
  for (const d of validateNestedAssigns(virtual, 'wcs-state', locale)) {
    out.push({ code: WcsDiagnosticCode.NestedAssign, start: d.start + shift, end: d.end + shift, message: d.message, severity: d.severity });
  }
  for (const d of validateArrayMutations(virtual, 'wcs-state', locale)) {
    out.push({ code: d.code, start: d.start + shift, end: d.end + shift, message: d.message, severity: d.severity });
  }
  return out;
}

/** The parts a page mounts (`source`: the whole page), each part's state checked once. */
export function validateClassPartScripts(source: string, locale?: string, fileReader?: FileReader): WcsDiagnostic[] {
  if (fileReader === undefined || !mayMountParts(source)) return [];
  const out: WcsDiagnostic[] = [];
  const files = new Set<string>();
  for (const part of collectClassParts(source, fileReader).values()) {
    // (two tags defined by one class file are one state)
    const key = `${part.path}\u0000${part.stateStart}`;
    if (files.has(key)) continue;
    files.add(key);
    const found = partFindings(part, locale);
    if (found.length === 0) continue;
    const anchor = anchorOf(source, part.tag);
    const position = createPositionMapper(part.text);
    for (const d of found) {
      out.push({
        code: d.code as WcsDiagnostic['code'],
        start: anchor.start,
        end: anchor.end,
        message: d.message,
        severity: d.severity,
        origin: { path: part.path, start: d.start, end: d.end, startPosition: position(d.start), endPosition: position(d.end) },
      });
    }
  }
  return out;
}

/** The page's candidates, read once when a part's path lands on the page's tree. */
interface PageTree {
  readonly paths: readonly PathCandidate[];
  readonly set: ReadonlySet<string>;
  readonly scopes: StatePathScopes;
}

/**
 * The data keys the page's tree has directly under `object` (`users.*` → `name`, `email`): what says its shape is
 * known. Accessors do not count — a part's exported getters are there whatever the rows hold (and a JSDoc type is
 * followed only so deep: a list of lists of rows has its rows' keys cut off).
 */
function keysUnder(object: string, tree: PageTree): string[] {
  const prefix = `${object}.`;
  const out = new Set<string>();
  for (const candidate of tree.paths) {
    if (!candidate.path.startsWith(prefix) || (candidate.kind !== 'data' && candidate.kind !== 'list')) continue;
    const rest = candidate.path.slice(prefix.length);
    const key = rest.split('.')[0];
    if (key !== '' && key !== '*') out.add(key);
  }
  return [...out];
}

/**
 * The paths of the templates of the parts `text` mounts (a page, or one definition's scope): a first key that is
 * neither the part's, nor handed to it, nor on the object it is mounted on. Once per part, key and element.
 */
export function validateClassPartTemplates(
  text: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
  applicationSchema?: JsonSchemaNode,
): WcsDiagnostic[] {
  if (fileReader === undefined || !mayMountParts(text) || !text.includes(bindAttribute)) return [];
  const parts = collectClassParts(text, fileReader);
  if (parts.size === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  let tree: PageTree | null = null;
  const page = (): PageTree => {
    if (tree === null) {
      const index = getStatePathIndex(text, stateTagName, fileReader, bindAttribute);
      const paths = mergeSchemaCandidates(index.paths, applicationSchema);
      tree = { paths, set: new Set(paths.map((p) => p.path)), scopes: index.scopes };
    }
    return tree;
  };
  const known = (path: string): boolean => isUnresolvedPath(path, page().scopes) || pathExistsInCandidates(path, page().paths as PathCandidate[], page().set);
  const uses = new Map<ClassPart, TemplateUse[]>();
  const positions = new Map<ClassPart, ReturnType<typeof createPositionMapper>>();
  const said = new Set<string>();

  walkMountSites(text, bindAttribute, parts, ({ site, inside, at, top }) => {
    const part = site.part;
    const template = part.template;
    if (template === null) return;
    // the object the part is mounted on is not on the page's tree: the page's own binding says so, once
    if (at !== null && !known(at)) return;
    let list = uses.get(part);
    if (list === undefined) uses.set(part, (list = templateUses(template.html, bindAttribute)));
    for (const use of list) {
      if (part.keys.includes(use.key) || site.handed.has(use.key)) continue;
      const landing = inside(use.key);
      if (landing.kind === 'own') continue;
      let object: string | null = null;
      let near: string[] = [...part.keys, ...site.handed.keys()];
      if (landing.kind === 'page') {
        if (known(landing.path)) continue;
        object = landing.path.slice(0, landing.path.length - use.key.length - 1);
        // an object whose shape the validator cannot see (a list that starts empty, `null`): nothing is said of its keys
        const keys = keysUnder(object, page());
        if (keys.length === 0) continue;
        near = [...near, ...keys];
      }
      const key = `${part.path}\u0000${use.key}\u0000${top.valueStart}`;
      if (said.has(key)) continue;
      said.add(key);
      let position = positions.get(part);
      if (position === undefined) positions.set(part, (position = createPositionMapper(part.text)));
      const start = template.start + use.start;
      const end = template.start + use.end;
      out.push({
        code: WcsDiagnosticCode.BindingPathMissing,
        start: top.valueStart,
        end: top.valueEnd,
        // (a key the page's own tree has at its top: the part cannot read it there — it is handed over)
        message: msgs.partPathMissing(use.path, part.tag, use.key, part.stateName, object)
          + (page().set.has(use.key) ? msgs.partPathOfPage(use.key, part.stateName) : suggestion(use.key, near.filter((n) => n !== use.key), msgs)),
        severity: 'warning',
        origin: { path: part.path, start, end, startPosition: position(start), endPosition: position(end) },
      });
    }
  });
  return out;
}
