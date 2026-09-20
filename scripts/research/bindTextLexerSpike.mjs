// Quote-aware lexer → AST spike for the `data-wcs` binding text. A research artifact for the
// next-major survey, not the shipped parser: one pass over the characters, quotes honoured
// everywhere, diagnostics carry positions instead of throwing, and no filter function is built
// here (that is a later, separately loadable stage). `kind` mirrors the current parser's
// bindingType so both can be compared on one corpus (scripts/audit-state-tech-lexer.mjs).
//
// Rules that differ from the shipped parser on purpose:
//   - `;` `:` `|` `#` `,` `(` `)` are structural only outside quotes; a bare filter argument
//     that needs one of them must be quoted.
//   - Backslash escapes inside quotes (`'it\'s'`).
//   - Malformed input is reported, never silently trimmed (`value#ro#wo`, `else: x`,
//     `join('x` , `join(a) b`, `fix(1,2,3)`).
//   - Modifiers are parsed for every kind; whether a kind accepts them is a separate check,
//     so `radio#ro: x` keeps kind `radio` (the README documents it) instead of falling back
//     to a generic property binding.
const STRUCTURAL = new Set(['if', 'elseif', 'for']);
const FORM = new Set(['radio', 'checkbox']);
const PROP_SEGMENT = /^[A-Za-z_$][\w$-]*$/;
const PATH_SEGMENT = /^(\*|\d+|\$\d+|[A-Za-z_$][\w$]*)$/;
const FILTER_NAME = /^[A-Za-z_]\w*$/;
const WS = /\s/;

/** First `stops` character at or after `from`, skipping quoted spans. */
function scanTo(text, stops, from) {
  let quote = null;
  let quoteStart = -1;
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    if (quote !== null) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
      quoteStart = j;
    } else if (stops.includes(c)) {
      return { end: j, unterminated: -1 };
    }
  }
  return { end: text.length, unterminated: quote === null ? -1 : quoteStart };
}

function parseArgs(text, offset, diag) {
  const args = [];
  if (text.trim() === '') return args;
  let j = 0;
  for (;;) {
    while (j < text.length && WS.test(text[j])) j++;
    const argStart = j;
    let value = '';
    let quoted = false;
    if (text[j] === "'" || text[j] === '"') {
      const q = text[j++];
      quoted = true;
      let closed = false;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length) value += text[++j];
        else if (c === q) { closed = true; j++; break; }
        else value += c;
      }
      if (!closed) {
        diag('E_QUOTE_UNTERMINATED', offset + argStart, offset + text.length, 'quote is never closed');
        args.push({ value, quoted });
        return args;
      }
      while (j < text.length && WS.test(text[j])) j++;
      if (j < text.length && text[j] !== ',') {
        const k = scanTo(text, ',', j).end;
        diag('E_ARG_MIXED', offset + j, offset + k, `unexpected '${text.slice(j, k).trim()}' after a quoted argument`);
        j = k;
      }
    } else {
      const k = scanTo(text, ',', j).end;
      const raw = text.slice(j, k);
      if (/['"]/.test(raw)) diag('E_ARG_MIXED', offset + j, offset + k, `quote inside a bare argument: '${raw.trim()}'`);
      value = raw.trim();
      if (value === '') diag('W_ARG_EMPTY', offset + j, offset + k, 'empty argument');
      j = k;
    }
    args.push({ value, quoted });
    if (j >= text.length) break;
    j++;
    if (j >= text.length || text.slice(j).trim() === '') {
      diag('W_ARG_EMPTY', offset + j, offset + text.length, 'trailing comma');
      break;
    }
  }
  return args;
}

function parseFilter(text, offset, io, ctx) {
  const { filterMeta, diag } = ctx;
  const open = scanTo(text, '(', 0).end;
  let name;
  let args = [];
  if (open >= text.length) {
    name = text.trim();
    const close = scanTo(text, ')', 0).end;
    if (close < text.length) diag('E_PAREN_UNOPENED', offset + close, offset + close + 1, "')' without '('");
  } else {
    name = text.slice(0, open).trim();
    const close = scanTo(text, ')', open + 1);
    let argsText;
    if (close.end >= text.length) {
      if (close.unterminated < 0) diag('E_PAREN_UNCLOSED', offset + open, offset + text.length, `'${name}(': missing ')' (quote arguments that contain ; : | or ))`);
      argsText = text.slice(open + 1);
    } else {
      argsText = text.slice(open + 1, close.end);
      const tail = text.slice(close.end + 1);
      if (tail.trim() !== '') diag('E_FILTER_TRAILING', offset + close.end + 1, offset + text.length, `unexpected '${tail.trim()}' after ')'`);
    }
    args = parseArgs(argsText, offset + open + 1, diag);
  }
  if (name === '') diag('E_FILTER_NAME', offset, offset + text.length, 'filter name is empty');
  else if (!FILTER_NAME.test(name)) diag('E_FILTER_NAME', offset, offset + text.length, `bad filter name '${name}'`);
  else if (filterMeta) {
    const meta = filterMeta[name];
    if (!meta) diag('W_FILTER_UNKNOWN', offset, offset + name.length, `unknown filter '${name}'`);
    else if (args.length < meta.minArgs || args.length > meta.maxArgs) {
      const want = meta.minArgs === meta.maxArgs ? String(meta.minArgs) : `${meta.minArgs}..${meta.maxArgs}`;
      diag('E_FILTER_ARITY', offset, offset + text.length, `'${name}' takes ${want} argument(s); got ${args.length}`);
    }
  }
  return { name, io, args, key: JSON.stringify([name, args.map(a => a.value)]) };
}

function parseFilters(text, offset, io, ctx) {
  const out = [];
  let from = 0;
  for (;;) {
    const { end } = scanTo(text, '|', from);
    out.push(parseFilter(text.slice(from, end), offset + from, io, ctx));
    if (end >= text.length) break;
    from = end + 1;
  }
  return out;
}

function parseBinding(text, start, colon, end, ctx) {
  const { flags, keyValue, diag } = ctx;
  // property side: name[#modifiers][|inputFilters]
  const propText = text.slice(start, colon);
  const pipeAt = scanTo(propText, '|', 0).end;
  const head = propText.slice(0, pipeAt);
  const inFilters = pipeAt < propText.length ? parseFilters(propText.slice(pipeAt + 1), start + pipeAt + 1, 'input', ctx) : [];
  const hashes = [];
  for (let k = 0; k < head.length; k++) if (head[k] === '#') hashes.push(k);
  if (hashes.length > 1) diag('E_MODIFIER_SEPARATOR', start + hashes[1], start + hashes[1] + 1, `only one '#' is allowed; '${head.trim()}' has ${hashes.length}`);
  const name = (hashes.length ? head.slice(0, hashes[0]) : head).trim();
  const modifiers = [];
  if (hashes.length) {
    const modsText = head.slice(hashes[0] + 1).replace(/#/g, ',');
    let offset = start + hashes[0] + 1;
    for (const raw of modsText.split(',')) {
      const t = raw.trim();
      const at = offset + raw.indexOf(t);
      offset += raw.length + 1;
      if (t === '') { diag('E_MODIFIER_EMPTY', at, at, 'empty modifier'); continue; }
      const eq = t.indexOf('=');
      const mName = (eq === -1 ? t : t.slice(0, eq)).trim();
      const value = eq === -1 ? undefined : t.slice(eq + 1).trim();
      if (modifiers.some(m => m.name === mName)) diag('W_MODIFIER_DUPLICATE', at, at + t.length, `modifier '${mName}' repeated`);
      if (keyValue.has(mName)) {
        if (value === undefined || value === '') diag('E_MODIFIER_VALUE', at, at + t.length, `'#${mName}=' needs a value`);
      } else if (flags.has(mName) || /^on[a-z]/.test(mName)) {
        if (value !== undefined) diag('E_MODIFIER_VALUE', at, at + t.length, `'#${mName}' takes no value`);
      } else {
        diag('W_MODIFIER_UNKNOWN', at, at + t.length, `unknown modifier '#${mName}'`);
      }
      modifiers.push(value === undefined ? { name: mName } : { name: mName, value });
    }
  }
  const segments = name === '...' ? ['...'] : name.split('.');
  if (name === '') diag('E_PROP_EMPTY', start, colon, 'property name is empty');
  else if (name !== '...') for (const s of segments) if (!PROP_SEGMENT.test(s)) diag('E_PROP_SEGMENT', start, colon, `'${name}': bad property segment '${s}'`);
  let kind;
  let namespace = null;
  if (name === 'else') kind = 'else';
  else if (name === '...') kind = 'spread';
  else if (STRUCTURAL.has(name) || FORM.has(name)) kind = name;
  else if (segments[0] === 'eventToken') { kind = 'event'; namespace = 'eventToken'; }
  else if (segments[0] === 'command') { kind = 'prop'; namespace = 'command'; }
  else if (segments.length === 1 && /^on[a-z]/i.test(name)) { kind = 'event'; namespace = 'on'; }
  else if (['class', 'attr', 'style'].includes(segments[0]) && segments.length > 1) { kind = 'prop'; namespace = segments[0]; }
  else kind = 'prop';
  if (modifiers.length && (STRUCTURAL.has(kind) || kind === 'else' || kind === 'spread')) diag('E_MODIFIER_NOT_ALLOWED', start, colon, `'${kind}' takes no modifiers`);
  if (inFilters.length && kind !== 'prop' && !FORM.has(kind)) diag('E_INPUT_FILTERS_NOT_ALLOWED', start, colon, `'${kind}' takes no input filters`);
  // state side: path[|outputFilters]
  const stateStart = colon + 1;
  const stateText = text.slice(stateStart, end);
  const spipe = scanTo(stateText, '|', 0).end;
  const pathRaw = stateText.slice(0, spipe);
  const pathText = pathRaw.trim();
  const pathAt = stateStart + pathRaw.indexOf(pathText);
  const outFilters = spipe < stateText.length ? parseFilters(stateText.slice(spipe + 1), stateStart + spipe + 1, 'output', ctx) : [];
  const path = { text: pathText, segments: [], relative: 0 };
  if (kind === 'else') {
    if (stateText.trim() !== '') diag('E_ELSE_STATE_PART', stateStart, end, `'else' takes no path; found '${stateText.trim()}'`);
  } else if (pathText === '') {
    diag('E_PATH_REQUIRED', stateStart, end, `'${name}': path is required`);
  } else if (pathText.includes('@')) {
    diag('E_NAME_SELECTOR_REMOVED', pathAt, pathAt + pathText.length, `'${pathText}': the "@name" selector was removed in v2`);
  } else {
    let k = 0;
    while (pathText[k] === '.') k++;
    path.relative = k;
    const rest = pathText.slice(k);
    // `.` alone (or `..`) names the loop item itself: relative depth with no segments.
    path.segments = rest === '' && k > 0 ? [] : rest.split('.');
    for (const s of path.segments) if (!PATH_SEGMENT.test(s)) diag('E_PATH_SEGMENT', pathAt, pathAt + pathText.length, `'${pathText}': bad path segment '${s}'`);
  }
  if (kind === 'spread' && outFilters.length) diag('E_SPREAD_FILTERS', stateStart, end, 'spread takes no filters');
  return { kind, namespace, prop: { name, segments, modifiers }, inFilters, path, outFilters };
}

/**
 * @param {string} text the data-wcs attribute value
 * @param {{ flags?: string[], keyValue?: string[], filterMeta?: Record<string, { minArgs: number, maxArgs: number }> | null }} [options]
 */
export function parseBindText(text, options = {}) {
  const ctx = {
    flags: new Set(options.flags ?? ['prevent', 'stop', 'ro']),
    keyValue: new Set(options.keyValue ?? ['init', 'sync']),
    filterMeta: options.filterMeta ?? null,
    diag: (code, start, end, message) => {
      if (diagnostics.some(d => d.code === code && d.start === start)) return;
      diagnostics.push({ code, start, end, message });
    },
  };
  const bindings = [];
  const diagnostics = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (WS.test(text[i]) || text[i] === ';')) i++;
    if (i >= text.length) break;
    const start = i;
    const prop = scanTo(text, ':;', i);
    if (prop.unterminated >= 0) { ctx.diag('E_QUOTE_UNTERMINATED', prop.unterminated, text.length, 'quote is never closed'); break; }
    if (prop.end >= text.length || text[prop.end] === ';') {
      ctx.diag('E_MISSING_COLON', start, prop.end, `"${text.slice(start, prop.end).trim()}": missing ':' between property and path`);
      i = prop.end;
      continue;
    }
    const state = scanTo(text, ';', prop.end + 1);
    if (state.unterminated >= 0) ctx.diag('E_QUOTE_UNTERMINATED', state.unterminated, text.length, 'quote is never closed');
    const binding = parseBinding(text, start, prop.end, state.end, ctx);
    binding.span = [start, state.end];
    bindings.push(binding);
    i = state.end;
  }
  if (bindings.length > 1) {
    for (const b of bindings) {
      if (STRUCTURAL.has(b.kind) || b.kind === 'else') ctx.diag('E_STRUCTURAL_SINGLE', b.span[0], b.span[1], `'${b.kind}' must be the only binding on the element`);
    }
  }
  return { bindings, diagnostics };
}
