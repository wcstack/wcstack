// HTML → graph model parser for wcstack apps.
//
// Walks the DOM recursively so that bindings inside <template> blocks
// (loop / conditional content) are picked up with the correct
// wildcard scope. Each `data-wcs` declaration AND each `{{ path }}`
// mustache becomes a wire from a state path output port to a
// component port.
//
// Stage 0a notes:
//   - `for:` introduces a wildcard scope `<path>.*` for its template
//     content. Paths starting with `.` are resolved against that scope
//     (`.name` inside `for: users` → `users.*.name`).
//   - `if:` / `elseif:` / `else:` propagate the parent scope unchanged.
//   - Components inside a structural template appear as siblings of
//     the structural node in the right column; nested rendering is
//     deferred to a later stage.

const STRUCTURAL_KEYS = new Set(['for', 'if', 'elseif', 'else']);

const TWOWAY_BY_TAG = {
  textarea: new Set(['value']),
  select: new Set(['value']),
  input: new Set(['value', 'valueAsNumber', 'valueAsDate', 'checked']),
};
const TWOWAY_ANY_TAG = new Set(['radio', 'checkbox']);

const SKIP_TAGS = new Set(['wcs-state', 'script', 'style']);

const MUSTACHE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * @typedef {Object} StateNode
 * @property {string} id
 * @property {string} name
 * @property {string[]} paths
 *
 * @typedef {Object} Port
 * @property {string} property        - unique identifier within the component
 * @property {string} [label]         - display label (defaults to property)
 * @property {string} [modifier]
 * @property {'in'|'event'|'structural'} kind
 * @property {boolean} [mustache]     - true for ports synthesized from {{ }}
 * @property {boolean} [wildcard]     - true if the bound path contains `*`
 * @property {boolean} [invalid]      - true if the bound path could not be fully resolved (e.g. an orphan `.name`)
 *
 * @typedef {Object} TagSourceRange
 * @property {number} tagStart   - offset of the element's open tag `<`
 * @property {number} tagEnd     - offset just after the open tag's `>`
 * @property {number} insertPos  - offset right after the tag name; safe place to inject new attributes
 *
 * @typedef {Object} ComponentNode
 * @property {string} id
 * @property {string} tag
 * @property {Port[]} ports
 * @property {boolean} structural
 * @property {string} [structuralKind]
 * @property {string} [scope]         - wildcard scope active on this component
 * @property {string} [parentId]      - id of nearest structural ancestor (if any)
 * @property {TagSourceRange} [tagSourceRange] - source position of the element's open tag (for new-attribute insertion / DOM highlighting)
 * @property {boolean} [unbound]      - true when the element has no data-wcs and no mustache bindings
 *
 * @typedef {Object} WireEnd
 * @property {string} stateId
 * @property {string} path
 *
 * @typedef {Object} SourceRange
 * @property {number} attrStart   - start offset of the `data-wcs="..."` attribute (incl. leading whitespace) in source
 * @property {number} attrEnd     - end offset (exclusive)
 * @property {number} valueStart  - start of the attribute value (just after the opening quote)
 * @property {number} valueEnd    - end of the attribute value (just before the closing quote)
 * @property {number} pieceIdx    - index of this binding within the value (0-based, by `;`)
 * @property {{ start: number, end: number } | null} [filterRange] - absolute source range of `|f1|f2(...)` (incl. leading `|`); null if no filters
 * @property {{ start: number, end: number } | null} [pathRange]   - absolute source range of the path text (between `:` and the first `|`/`@`)
 *
 * @typedef {Object} Wire
 * @property {WireEnd} from
 * @property {{ componentId: string, property: string }} to
 * @property {string[]} filters
 * @property {string} [modifier]
 * @property {'out'|'in'|'inout'|'structural'} direction
 * @property {boolean} [wildcard]
 * @property {boolean} [invalid]            - true if the path could not be fully resolved (orphan relative path)
 * @property {SourceRange} [sourceRange]   - present for data-wcs bindings; absent for mustache
 * @property {string} raw
 *
 * @typedef {Object} GraphModel
 * @property {StateNode[]} states
 * @property {ComponentNode[]} components
 * @property {Wire[]} wires
 */

/**
 * @param {string} html
 * @returns {GraphModel}
 */
export function parseHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const maskedSource = maskScriptAndStyle(html);
  const ctx = {
    source: html,
    maskedSource,
    states: [],
    components: [],
    wires: [],
    stateByName: new Map(),
    nextCompIdx: 0,
    attrLocations: locateDataWcsAttrs(html),
    attrLocIdx: 0,
    sourceCursor: 0,
  };

  for (const el of doc.querySelectorAll('wcs-state')) {
    const name = el.getAttribute('name') || 'default';
    if (ctx.stateByName.has(name)) continue;
    ensureState(name, ctx);
  }

  walkChildren(doc.body, '', ctx, undefined);

  return { states: ctx.states, components: ctx.components, wires: ctx.wires };
}

/**
 * Scans the source HTML for `data-wcs="..."` attribute occurrences and
 * returns their byte offsets in document order. Content inside <script>
 * and <style> tags is masked out so embedded code that mentions
 * `data-wcs="..."` as a string literal does not produce false matches.
 *
 * @param {string} source
 * @returns {{ attrStart: number, attrEnd: number, valueStart: number, valueEnd: number, value: string }[]}
 */
function locateDataWcsAttrs(source) {
  const masked = maskScriptAndStyle(source);
  const re = /(\s+)(data-wcs)(\s*=\s*)(["'])([^"']*)\4/g;
  const out = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    const attrStart = m.index;
    const attrEnd = m.index + m[0].length;
    const valueStart = attrStart + m[1].length + m[2].length + m[3].length + 1;
    const valueEnd = valueStart + m[5].length;
    out.push({ attrStart, attrEnd, valueStart, valueEnd, value: m[5] });
  }
  return out;
}

function maskScriptAndStyle(source) {
  return source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (match) =>
    match.replace(/[^\n]/g, ' ')
  );
}

/**
 * Find the next open-tag matching `expectedTag` in `maskedSource`
 * starting at `cursor`. Tags that don't match (wrappers like <html>,
 * <body>, or tags inside skipped subtrees we already advanced past)
 * are skipped, up to a generous attempt cap to bound runtime.
 *
 * @param {string} maskedSource
 * @param {number} cursor
 * @param {string} expectedTag - lowercase
 * @returns {{ tagStart: number, tagEnd: number, insertPos: number } | null}
 */
function findTagInSource(maskedSource, cursor, expectedTag) {
  const re = /<([a-z][a-z0-9-]*)\b[^>]*>/gi;
  re.lastIndex = cursor;
  for (let attempts = 0; attempts < 256; attempts++) {
    const m = re.exec(maskedSource);
    if (!m) return null;
    if (m[1].toLowerCase() === expectedTag) {
      return {
        tagStart: m.index,
        tagEnd: m.index + m[0].length,
        // Right after the tag name — safe place to insert a new
        // attribute like ` data-wcs="..."` without disturbing existing
        // attributes or the closing `>` / `/>`.
        insertPos: m.index + 1 + m[1].length,
      };
    }
  }
  return null;
}

function walkChildren(parent, scope, ctx, structuralAncestorId) {
  if (!parent || !parent.childNodes) return;
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 1) {
      processElement(node, scope, ctx, structuralAncestorId);
    }
    // Text nodes are processed via their parent element so that
    // mustache ports attach to the correct component.
  }
}

function processElement(el, scope, ctx, structuralAncestorId) {
  const tag = el.tagName.toLowerCase();

  // Locate this element's open tag in source, advancing the cursor.
  // Skip-on-mismatch handles wrapper tags DOMParser inserts (html, body)
  // and elements inside skipped subtrees.
  const tagLoc = findTagInSource(ctx.maskedSource, ctx.sourceCursor, tag);
  if (tagLoc) ctx.sourceCursor = tagLoc.tagEnd;

  if (SKIP_TAGS.has(tag)) return;

  const dataWcs = el.getAttribute('data-wcs');
  const directTextNodes = Array.from(el.childNodes).filter(n => n.nodeType === 3);
  const mustachesInText = directTextNodes
    .flatMap(n => Array.from((n.textContent || '').matchAll(MUSTACHE_RE)))
    .map(m => m[1].trim());

  // Always create a ComponentNode for every walked element so that
  // unbound elements appear in the graph as wire targets too.
  /** @type {ComponentNode} */
  const comp = {
    id: `comp:${ctx.nextCompIdx++}:${tag}`,
    tag,
    ports: [],
    structural: false,
    structuralKind: undefined,
    scope: scope || undefined,
    parentId: structuralAncestorId,
    tagSourceRange: tagLoc || undefined,
    unbound: !(dataWcs || mustachesInText.length > 0),
  };
  ctx.components.push(comp);

  if (dataWcs) {
    const loc = ctx.attrLocations[ctx.attrLocIdx++];
    parseAttrBindings(el, comp, dataWcs, scope, ctx, loc);
  }
  if (mustachesInText.length > 0) {
    addMustacheBindings(mustachesInText, comp, scope, ctx);
  }

  // Determine the scope and structural-ancestor for descendants.
  let childScope = scope;
  if (tag === 'template' && comp && comp.structural && comp.structuralKind === 'for') {
    const forWire = ctx.wires.find(
      w => w.to.componentId === comp.id && w.to.property === 'for'
    );
    if (forWire) {
      childScope = forWire.from.path + '.*';
    }
  }
  // Only structural containers introduce a new visual nesting layer.
  const childAncestor = comp && comp.structural ? comp.id : structuralAncestorId;

  if (tag === 'template') {
    walkChildren(el.content, childScope, ctx, childAncestor);
  } else {
    walkChildren(el, childScope, ctx, childAncestor);
  }
}

function parseAttrBindings(el, comp, attr, scope, ctx, loc) {
  const tag = comp.tag;
  // Use the attribute value from the source location when available so
  // offsets stay aligned even if the DOM-decoded value differs (e.g.
  // entities). Fall back to the runtime attr value otherwise.
  const valueForSplit = loc ? loc.value : attr;
  const pieces = splitTopLevelWithPos(valueForSplit, ';');
  pieces.forEach((piece, pieceIdx) => {
    const trimmed = piece.text.trim();
    if (!trimmed) return;
    const b = parseBinding(trimmed);
    const { property, modifier, path: rawPath, stateName, filters, raw } = b;
    const resolvedPath = resolvePath(rawPath, scope);
    const wildcard = resolvedPath.includes('*');
    const invalid = isOrphanRelative(resolvedPath);

    let kind = 'in';
    if (STRUCTURAL_KEYS.has(property)) {
      comp.structural = true;
      comp.structuralKind = property;
      kind = 'structural';
    } else if (property.startsWith('on')) {
      kind = 'event';
    }

    comp.ports.push({ property, modifier, kind, wildcard, invalid });

    if (resolvedPath) {
      const state = ensureState(stateName, ctx);
      if (!state.paths.includes(resolvedPath)) state.paths.push(resolvedPath);
      const wire = {
        from: { stateId: state.id, path: resolvedPath },
        to: { componentId: comp.id, property },
        filters,
        modifier,
        direction: detectDirection(tag, property),
        wildcard,
        invalid,
        raw,
      };
      if (loc) {
        wire.sourceRange = {
          attrStart: loc.attrStart,
          attrEnd: loc.attrEnd,
          valueStart: loc.valueStart,
          valueEnd: loc.valueEnd,
          pieceIdx,
          filterRange: filters.length > 0
            ? findFilterRange(piece.text, piece.start, loc.valueStart)
            : null,
          pathRange: findPathRange(piece.text, piece.start, loc.valueStart),
        };
      }
      ctx.wires.push(wire);
    }
  });
}

function addMustacheBindings(mustaches, comp, scope, ctx) {
  mustaches.forEach((rawPath, i) => {
    // A mustache may carry a state suffix `@state` and filters too.
    const { path, stateName, filters } = parseMustacheExpression(rawPath);
    const resolved = resolvePath(path, scope);
    const portId = `text:${comp.ports.length}`;
    const wildcard = resolved.includes('*');
    const invalid = isOrphanRelative(resolved);
    comp.ports.push({
      property: portId,
      label: 'text',
      kind: 'in',
      mustache: true,
      wildcard,
      invalid,
    });

    if (resolved) {
      const state = ensureState(stateName, ctx);
      if (!state.paths.includes(resolved)) state.paths.push(resolved);
      ctx.wires.push({
        from: { stateId: state.id, path: resolved },
        to: { componentId: comp.id, property: portId },
        filters,
        direction: 'out',
        wildcard,
        invalid,
        raw: `{{ ${rawPath} }}`,
      });
    }
  });
}

/**
 * Locate the path text within a binding piece (the part between `:`
 * and the first top-level `|` or `@`, with leading/trailing whitespace
 * trimmed). Returns null when there is no `:`.
 *
 * @param {string} pieceText      - e.g. "class.plus: count|gt(0)"
 * @param {number} pieceStart     - offset of pieceText within the attribute value
 * @param {number} valueStart     - offset of the attribute value within the source
 * @returns {{ start: number, end: number } | null}
 */
function findPathRange(pieceText, pieceStart, valueStart) {
  const colonIdx = pieceText.indexOf(':');
  if (colonIdx < 0) return null;
  const after = pieceText.slice(colonIdx + 1);
  const leadingWs = after.length - after.trimStart().length;
  let end = after.length;
  let depth = 0;
  let quote = '';
  for (let i = leadingWs; i < after.length; i++) {
    const ch = after[i];
    if (quote) {
      if (ch === quote && after[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && (ch === '|' || ch === '@')) { end = i; break; }
  }
  while (end > leadingWs && /\s/.test(after[end - 1])) end--;
  return {
    start: valueStart + pieceStart + colonIdx + 1 + leadingWs,
    end: valueStart + pieceStart + colonIdx + 1 + end,
  };
}

/**
 * Locate the filter pipeline within a binding piece and return its
 * absolute source range, including the leading `|`. Returns null when
 * the piece contains no top-level `|` after the colon.
 *
 * @param {string} pieceText      - e.g. "class.plus: count|gt(0)"
 * @param {number} pieceStart     - offset of pieceText within the attribute value
 * @param {number} valueStart     - offset of the attribute value within the source
 * @returns {{ start: number, end: number } | null}
 */
function findFilterRange(pieceText, pieceStart, valueStart) {
  const colonIdx = pieceText.indexOf(':');
  if (colonIdx < 0) return null;
  const after = pieceText.slice(colonIdx + 1);
  let depth = 0;
  let quote = '';
  for (let i = 0; i < after.length; i++) {
    const ch = after[i];
    if (quote) {
      if (ch === quote && after[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '|' && depth === 0) {
      const filterStart = valueStart + pieceStart + colonIdx + 1 + i;
      const filterEnd = valueStart + pieceStart + pieceText.length;
      return { start: filterStart, end: filterEnd };
    }
  }
  return null;
}

// A path is "orphan-relative" when it still begins with `.` after
// scope resolution. That happens when a binding lives outside any
// enclosing structural scope but uses a relative path syntax — i.e.
// the user (or an edit) removed the surrounding `for:` so the
// leading dot now refers to no loop.
function isOrphanRelative(path) {
  return typeof path === 'string' && path.startsWith('.');
}

function parseMustacheExpression(expr) {
  const segments = splitTopLevel(expr, '|');
  let pathSeg = (segments[0] || '').trim();
  const filters = segments.slice(1).map(f => f.trim()).filter(Boolean);
  let stateName;
  const at = pathSeg.indexOf('@');
  if (at !== -1) {
    stateName = pathSeg.slice(at + 1).trim();
    pathSeg = pathSeg.slice(0, at).trim();
  }
  return { path: pathSeg, stateName, filters };
}

function resolvePath(path, scope) {
  if (!path) return path;
  if (path.startsWith('.') && scope) {
    return scope + path;
  }
  return path;
}

function ensureState(name, ctx) {
  const key = name || 'default';
  let node = ctx.stateByName.get(key);
  if (!node) {
    node = { id: `state:${key}`, name: key, paths: [] };
    ctx.states.push(node);
    ctx.stateByName.set(key, node);
  }
  return node;
}

function detectDirection(tag, property) {
  if (STRUCTURAL_KEYS.has(property)) return 'structural';
  if (property.startsWith('on')) return 'in';
  if (TWOWAY_ANY_TAG.has(property)) return 'inout';
  const tagSet = TWOWAY_BY_TAG[tag];
  if (tagSet && tagSet.has(property)) return 'inout';
  return 'out';
}

function parseBinding(piece) {
  const colonIdx = piece.indexOf(':');
  if (colonIdx === -1) {
    return { property: piece.trim(), modifier: undefined, path: '', stateName: undefined, filters: [], raw: piece };
  }

  const propPart = piece.slice(0, colonIdx).trim();
  const valuePart = piece.slice(colonIdx + 1).trim();

  let property = propPart;
  let modifier;
  const hashIdx = propPart.indexOf('#');
  if (hashIdx !== -1) {
    property = propPart.slice(0, hashIdx).trim();
    modifier = propPart.slice(hashIdx + 1).trim();
  }

  const segments = splitTopLevel(valuePart, '|');
  let pathSeg = (segments[0] || '').trim();
  const filters = segments.slice(1).map(f => f.trim()).filter(Boolean);

  let stateName;
  const atIdx = pathSeg.indexOf('@');
  if (atIdx !== -1) {
    stateName = pathSeg.slice(atIdx + 1).trim();
    pathSeg = pathSeg.slice(0, atIdx).trim();
  }

  return { property, modifier, path: pathSeg, stateName, filters, raw: piece };
}

function splitTopLevel(s, delim) {
  return splitTopLevelWithPos(s, delim).map(p => p.text);
}

/**
 * Splits `s` on the top-level occurrences of `delim` (skipping inside
 * parens and quoted substrings) and returns each piece together with
 * its [start, end) offsets in the input.
 *
 * @param {string} s
 * @param {string} delim
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function splitTopLevelWithPos(s, delim) {
  const out = [];
  let depth = 0;
  let quote = '';
  let pieceStart = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote && s[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === delim && depth === 0) {
      out.push({ text: s.slice(pieceStart, i), start: pieceStart, end: i });
      pieceStart = i + 1;
    }
  }
  out.push({ text: s.slice(pieceStart), start: pieceStart, end: s.length });
  return out;
}
