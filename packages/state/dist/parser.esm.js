// src/hooks.ts
var hooks = {};

// src/diagnostics/guidance.ts
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}
function didYouMean(input, candidates) {
  if (input.length === 0) {
    return "";
  }
  const folded = input.toLowerCase();
  let best = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(folded, candidate.toLowerCase(), 2);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null ? ` Did you mean "${best}"?` : "";
}
var LINT_HINT = " Validate statically: npx @wcstack/lint <file>.";

// src/parser/raiseError.ts
function raiseError(message, subject, candidates) {
  throw new Error(`[@wcstack/state] ${message}${hooks.explain?.(message, subject, candidates) ?? ""}`);
}

// src/messages.ts
var CODES = [
  "",
  "binding-syntax",
  "template-syntax",
  "binding-path-missing",
  "binding-type-expectation",
  "filter-unknown",
  "filter-arity",
  "getter-cycle",
  "getter-depth-exceeded",
  "index-arity",
  "index-param-range",
  "recursion-unsupported",
  "token-misconfigured",
  "token-undeclared",
  "wildcard-rank",
  "spread-no-bindable",
  "declaration-alias",
  "name-alias"
];
var codeOf = (id) => {
  const c = CODES[id / 100 | 0];
  return c ? `[wcs/${c}] ` : "";
};
function text(id, args = []) {
  return hooks.render?.(id, args) ?? `${codeOf(id)}#${id}${args.map((a) => ` ${typeof a === "string" ? JSON.stringify(a) : String(a)}`).join("")}`;
}
function raise(id, args, subject, candidates) {
  raiseError(text(id, args), subject, candidates);
}

// src/filters/registry.ts
var FORMATS_FILTER_NAMES = [
  "toFixed",
  "locale",
  "upper",
  "lower",
  "capitalize",
  "trim",
  "slice",
  "padStart",
  "padEnd",
  "repeat",
  "reverse",
  "truncate",
  "join",
  "round",
  "floor",
  "ceil",
  "percent",
  "unit",
  "date",
  "time",
  "datetime",
  "ymd",
  "hms"
];
var definitions = /* @__PURE__ */ new Map();
function hasFilter(name) {
  return definitions.has(name);
}

// src/pattern.ts
var WILDCARD = "*";

// src/parser/define.ts
var DELIMITER = ".";
var BINDING_SEPARATOR = ";";
var PROP_VALUE_SEPARATOR = ":";
var MODIFIER_SEPARATOR = "#";
var FILTER_SEPARATOR = "|";
var ELSE_KEYWORD = "else";
var SPREAD_PROP = "...";
var EVENT_PROP_PREFIX = "on";
var EVENT_TOKEN_NAMESPACE = "eventToken";
var VOLUME_INJECTION_PROP = "state";
var COMMAND_NAMESPACE = "command";
var CLASS_NAMESPACE = "class";
var ATTR_NAMESPACE = "attr";
var STYLE_NAMESPACE = "style";
var MAX_PATH_SEGMENTS = 512;
var MAX_INDEX_PARAM = 128;
var RECURSION_WILDCARD = "**";

// src/parser/parseFilterArgs.ts
function finalizeArg(text2, firstQuoteStart, lastQuoteEnd) {
  const startLimit = firstQuoteStart === -1 ? text2.length : firstQuoteStart;
  const endLimit = lastQuoteEnd === -1 ? 0 : lastQuoteEnd;
  return text2.slice(startLimit - text2.slice(0, startLimit).trimStart().length, endLimit + text2.slice(endLimit).trimEnd().length);
}
var NUMBER_LITERAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function toLiteral(text2, quoted) {
  if (quoted) return text2;
  if (text2 === "true") return true;
  if (text2 === "false") return false;
  if (text2 === "null") return null;
  return NUMBER_LITERAL.test(text2) ? Number(text2) : text2;
}
function parseFilterArgsWithLiterals(argsText) {
  const args = [];
  const literals = [];
  let current = "";
  let inQuote = null;
  let hasQuote = false;
  let firstQuoteStart = -1;
  let lastQuoteEnd = -1;
  const flush = (last) => {
    const arg = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
    if (!last || arg || hasQuote) {
      args.push(arg);
      literals.push(toLiteral(arg, hasQuote));
    }
    current = "";
    hasQuote = false;
    firstQuoteStart = -1;
    lastQuoteEnd = -1;
  };
  for (let i = 0; i < argsText.length; i++) {
    const char = argsText[i];
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        if (firstQuoteStart === -1) {
          firstQuoteStart = current.length;
        }
        current += char;
        lastQuoteEnd = current.length;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasQuote = true;
    } else if (char === ",") {
      flush();
    } else {
      current += char;
    }
  }
  if (inQuote !== null) {
    raise(107 /* UnterminatedQuote */, [inQuote, argsText]);
  }
  flush(true);
  return { args, literals };
}

// src/parser/utils.ts
var trimFn = (s) => s.trim();
function outsideQuotes(text2, char) {
  const found = [];
  let quote = null;
  for (let i = 0; i < text2.length; i++) {
    const c = text2[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === char) {
      found.push(i);
    }
  }
  return found;
}
var indexOfOutsideQuotes = (text2, char) => outsideQuotes(text2, char)[0] ?? -1;
var lastIndexOfOutsideQuotes = (text2, char) => outsideQuotes(text2, char).pop() ?? -1;
function splitOutsideQuotes(text2, separator) {
  const parts = [];
  let start = 0;
  for (const i of outsideQuotes(text2, separator)) {
    parts.push(text2.slice(start, i));
    start = i + 1;
  }
  parts.push(text2.slice(start));
  return parts;
}

// src/parser/parseFilters.ts
function parseFilters(filterTextList, filterIOType, sourceText) {
  const source = sourceText ?? filterTextList.join("|");
  return filterTextList.map((filterText) => {
    const openParenIndex = indexOfOutsideQuotes(filterText, "(");
    let closeParenIndex = lastIndexOfOutsideQuotes(filterText, ")");
    if (closeParenIndex === -1) {
      closeParenIndex = filterText.lastIndexOf(")");
    }
    if (openParenIndex !== -1 && closeParenIndex === -1) {
      raise(108 /* FilterUnclosed */, [filterText]);
    }
    if (closeParenIndex !== -1 && openParenIndex === -1) {
      raise(109 /* FilterUnopened */, [filterText]);
    }
    if (closeParenIndex !== -1 && closeParenIndex < openParenIndex) {
      raise(110 /* FilterParenOrder */, [filterText]);
    }
    if (closeParenIndex !== -1 && filterText.slice(closeParenIndex + 1).trim().length > 0) {
      const trailing = filterText.slice(closeParenIndex + 1).trim();
      raise(111 /* FilterTrailing */, [filterText, trailing]);
    }
    const filterName = (openParenIndex === -1 ? filterText : filterText.substring(0, openParenIndex)).trim();
    if (filterName.length === 0) {
      raise(112 /* FilterEmpty */, [source]);
    }
    if (filterName.includes(MODIFIER_SEPARATOR)) {
      const [, modifiers] = filterName.split(MODIFIER_SEPARATOR);
      raise(filterIOType === "input" ? 113 /* FilterNameHasModifiersInput */ : 114 /* FilterNameHasModifiersOutput */, [filterName, modifiers]);
    }
    if (openParenIndex === -1) {
      return { filterName, args: [], literals: [] };
    }
    const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
    return { filterName, ...parseFilterArgsWithLiterals(argsText) };
  });
}
function splitFilters(part, filterIOType, cache2) {
  const pos = indexOfOutsideQuotes(part, FILTER_SEPARATOR);
  if (pos === -1) return [part.trim(), []];
  const filtersText = part.slice(pos + 1).trim();
  let filters = cache2.get(filtersText);
  if (filters === void 0) {
    filters = parseFilters(splitOutsideQuotes(filtersText, FILTER_SEPARATOR).map(trimFn), filterIOType, part);
    cache2.set(filtersText, filters);
  }
  return [part.slice(0, pos).trim(), filters];
}

// src/parser/parseStatePart.ts
var cacheFilterInfos = /* @__PURE__ */ new Map();
var clearStatePartCache = () => cacheFilterInfos.clear();
function checkPathLikeGetPathInfo(path) {
  if (path.includes(RECURSION_WILDCARD)) {
    recursionUnsupported(path);
  }
  const segmentCount = path.split(DELIMITER).length;
  if (segmentCount > MAX_PATH_SEGMENTS) {
    raise(117 /* TooManySegments */, [path, segmentCount]);
  }
}
function recursionUnsupported(path) {
  raise(1101 /* RecursionUnsupported */, [path]);
}
function parseStatePart(statePart) {
  const [stateAndPath, filters] = splitFilters(statePart, "output", cacheFilterInfos);
  if (stateAndPath.includes("@")) {
    raise(32 /* SelectorRemoved */, [stateAndPath]);
  }
  const statePathName = stateAndPath;
  const isLoopRelative = statePathName.startsWith(DELIMITER);
  const body = isLoopRelative ? statePathName.slice(DELIMITER.length) : statePathName;
  const hasEmptySegment = body.length > 0 && body.split(DELIMITER).some((segment) => segment.length === 0);
  if (hasEmptySegment || !isLoopRelative && body.length === 0) {
    raise(119 /* EmptySegment */, [statePart]);
  }
  checkPathLikeGetPathInfo(statePathName);
  return {
    statePathName,
    outFilters: filters
  };
}

// src/engine.ts
var MAX_DRAIN_PASSES = 32;
var MAX_RENDER_CHAIN = 100;

// src/diagnostics/messages.ts
var MOVED = ["enableMustache", "sameValueGuard", "enableDirectionalInitialSync"];
var element = (tag, at) => `<${tag}${at.map((a, i) => i % 2 ? `="${a}"` : ` ${a}`).join("")}>`;
var CSP_GUIDE = "https://github.com/wcstack/wcstack/blob/main/docs/csp.md";
var SENTENCES = {
  [1 /* ScanRemoved */]: () => "$scan was removed (use $watch or $on)",
  [2 /* GetterWithoutSetter */]: (p) => `"${p}" is a getter without a setter`,
  [3 /* NoRow */]: (p) => `no row for "${p}"`,
  [4 /* ParentNotObject */]: (p, parent) => `cannot write "${p}": its parent is ${parent}`,
  [5 /* NotAMethod */]: (name) => `"${name}" is not a method`,
  [6 /* GetAllNoCommonLevel */]: (p) => `$getAll("${p}"): no loop level in common with the context`,
  [7 /* EqIndexNoRow */]: (p) => `$eqIndex("${p}") needs a list row scope.`,
  [8 /* Readonly */]: () => "This state is readonly.",
  [9 /* SetAllNeedsIndexes */]: (p) => `$setAll("${p}") needs indexes ([] for every match)`,
  [10 /* SetAllSpreadLength */]: (p, n) => `$setAll("${p}", \u2026, { spread: true }) needs an array of ${n} values`,
  [11 /* DrainNotSettled */]: () => `updates did not settle after ${MAX_DRAIN_PASSES} passes`,
  [41 /* RenderChain */]: () => `render chain depth limit exceeded (${MAX_RENDER_CHAIN} drains that rendering itself started); bindings for this batch were not applied.`,
  [12 /* BindingFailed */]: (type, p) => `binding "${type}: ${p}" failed to apply.`,
  [13 /* LoadFailed */]: (src, status) => `failed to load "${src}": ${status}`,
  [14 /* ElementFailed */]: () => "this <wcs-state> failed to initialize; create a new one",
  [15 /* NotInitialized */]: () => "state is not initialized",
  [16 /* NoScript */]: (id) => `no <script> with id "${id}"`,
  [42 /* InlineBlocked */]: () => `The inline <script> of <wcs-state> was blocked by Content-Security-Policy. Inline state is evaluated through a blob: URL: give the page's nonce to the <script> that loads @wcstack/state, or allow blob: in script-src. Moving the state into an external file (src="./state.js") needs neither. See ${CSP_GUIDE}`,
  [43 /* InlineFailed */]: (detail) => `Failed to evaluate the inline <script> of <wcs-state>: ${detail}. If this page sets a Content-Security-Policy, see ${CSP_GUIDE}`,
  [17 /* TokenSubscriberThrew */]: (name) => `a subscriber of token "${name}" threw.`,
  [18 /* TokenListNotArray */]: (key) => `${key} must be an array of strings.`,
  [19 /* TokenEntryEmpty */]: (key) => `${key} entries must be non-empty strings.`,
  [20 /* TokenEntryReserved */]: (key, name, reserved) => `${key} entry "${name}" conflicts with the reserved namespace name "${reserved}".`,
  [21 /* TokenEntryDuplicated */]: (key, name) => `${key} entry "${name}" is duplicated.`,
  [22 /* OnNotObject */]: () => "$on must be an object of handlers.",
  [23 /* OnEntryUndeclared */]: (name) => `$on entry "${name}" is not declared in $eventTokens.`,
  [24 /* OnEntryNotFunction */]: (name) => `$on entry "${name}" must be a function.`,
  [25 /* NamingLimit */]: (limit) => `view-transition naming-limit (${limit}) reached.`,
  [26 /* FilterOptionsRequired */]: (fn) => `filter ${fn} requires at least one option`,
  [27 /* FilterOptionNotNumber */]: (fn) => `filter ${fn} requires a number as option`,
  [28 /* FilterValueNotNumber */]: (fn) => `filter ${fn} requires a number value`,
  [29 /* FilterValueNotDate */]: (fn) => `filter ${fn} requires a date value`,
  [30 /* FilterValueNotArray */]: (fn) => `filter ${fn} requires an array value`,
  [31 /* DirectionalSyncDisabled */]: () => "init=/sync= modifiers require enableDirectionalInitialSync.",
  [33 /* ModifierUnknown */]: (key, modifier) => `Unknown binding modifier "${key}" in "${modifier}".`,
  [34 /* ModifierTwice */]: (key) => `Binding modifier "${key}" may only be specified once.`,
  [35 /* ModifierValue */]: (key, value) => `Invalid ${key} modifier value "${value}".`,
  [36 /* EventInitNone */]: () => "Event bindings only allow init=none.",
  [37 /* InitUnsupported */]: (type, init) => `Binding type "${type}" does not support init=${init}.`,
  [38 /* MemberUndeclared */]: (name) => `Property "${name}" is not declared by wcBindable.`,
  [39 /* InitIncompatible */]: (init, name) => `init=${init} is incompatible with wcBindable member "${name}".`,
  [40 /* SyncConnectNeedsOutput */]: (name) => `sync=connect requires observable property "${name}".`,
  [44 /* OptionInvalid */]: (where, key) => `${where}: "${key}" is not one of its options, or not of the option's type.${where === "bootstrapState" && MOVED.includes(key) ? " 4.0 moved it to the state's $behavior." : ""}`,
  [45 /* BehaviorChanged */]: () => "a re-set state may not change $behavior: create the element again.",
  [47 /* SecondRoot */]: () => `a second <wcs-state> on the same root: there is one state tree per root \u2014 graft a subtree with <wcs-state mount="path"> (v1's name="\u2026" is gone: read the mounted state by its path).`,
  [48 /* LocaleInvalid */]: (l) => `the locale "${l}" (<html lang> or bootstrapState's locale) is not a language tag Intl takes (en-US, not en_US): the locale filters use "en".`,
  [46 /* FeaturesNotArray */]: () => '$features must be an array of add-on names (["temporal", "formats"]).',
  [49 /* InitFailed */]: (tag, ...at) => `${element(tag, at)} failed to initialize.`,
  [50 /* ConnectedFailed */]: (tag, ...at) => `${element(tag, at)} $connectedCallback failed.`,
  [101 /* BindTextNoColon */]: (t) => `Invalid bindText: "${t}". Missing ':' separator between propPart and statePart.`,
  [102 /* StructuralTakesNoModifiers */]: (t, keyword) => `"${t}": "${keyword}" takes no modifiers or filters on its left side \u2014 write "${keyword}:".`,
  [103 /* ElseTakesNoValue */]: (t) => `"${t}": "else" takes no value \u2014 write "else:".`,
  [104 /* SpreadNoPath */]: (t) => `Invalid spread binding "${t}": spread target path is required.`,
  [105 /* SpreadNoFilters */]: (t) => `Invalid spread binding "${t}": filters are not allowed on spread targets.`,
  [106 /* LeadingDotNamespace */]: (prop) => `"${prop}": a leading "." binds an element property by name \u2014 write a non-empty property that is not a namespace (class, attr, style, command, eventToken, state).`,
  [107 /* UnterminatedQuote */]: (quote, args) => `unterminated ${quote} quote in the filter arguments "(${args})". Close the quote.`,
  [108 /* FilterUnclosed */]: (f) => `Invalid filter format: missing closing parenthesis in "${f}".`,
  [109 /* FilterUnopened */]: (f) => `Invalid filter format: missing opening parenthesis in "${f}".`,
  [110 /* FilterParenOrder */]: (f) => `Invalid filter format: ")" comes before "(" in "${f}".`,
  [111 /* FilterTrailing */]: (f, trailing) => `"${f}": unexpected "${trailing}" after the filter's closing ")" \u2014 separate filters with "|" (write "${f.slice(0, f.lastIndexOf(")") + 1)}|${trailing}").`,
  [112 /* FilterEmpty */]: (source) => `an empty filter in "${source}" \u2014 remove the extra "|" or name the filter.`,
  [113 /* FilterNameHasModifiersInput */]: (name, mods) => `"${name}" is not a filter name: a modifier list "${MODIFIER_SEPARATOR}${mods}" comes before the input filters, not inside one`,
  [114 /* FilterNameHasModifiersOutput */]: (name) => `"${name}" is not a filter name: "${MODIFIER_SEPARATOR}" cannot appear in one.`,
  [115 /* OneModifierList */]: (prop) => `"${prop}": a binding takes one modifier list after a single "#"`,
  [116 /* NoPropertyName */]: (prop) => `"${prop}": the left side of a binding must name a property \u2014 write "<property>: <path>" (modifiers and input filters come after the name).`,
  [117 /* TooManySegments */]: (p, n) => `"${p}" has ${n} path segments \u2014 the limit is ${MAX_PATH_SEGMENTS}.`,
  [32 /* SelectorRemoved */]: (t) => `"${t}": the "@name" selector was removed in v2 \u2014 there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.`,
  [120 /* UnsafeSegment */]: (p) => `"${p}": a state path cannot go through "__proto__" or "prototype" (it would reach every object's prototype).`,
  [121 /* ForNoFilters */]: (t) => `"${t}": "for:" takes no filters \u2014 a row is "<path>.<index>", so the rows of a filtered list would name other elements. Declare a getter that returns the filtered list and loop over it ("for: <getter>").`,
  [119 /* EmptySegment */]: (t) => `"${t}": the right side of a binding must name a state path \u2014 write "<property>: <path>" (a path segment cannot be empty; "." alone and a leading "." are the loop-relative shorthand).`,
  [201 /* StructuralNotSingle */]: (t) => `Invalid bindText: "${t}". 'if', 'elseif', 'else', and 'for' bindings must be single binding.`,
  [202 /* ElseWithoutIf */]: (type) => `"${type}:" must follow an "if:" template`,
  [204 /* TemplateHandedOver */]: (type) => `a "${type}:" template at the top of inserted content was not rendered, as it would render beside itself out of the inserter's reach: wrap it in an element.`,
  [203 /* OuterInTemplate */]: (name) => `"${name}:" replaces its element, so it cannot be used inside a "for" / "if" template (a row or branch keeps its nodes by position): bind innerHTML: on a wrapper element instead.`,
  [301 /* PathMissing */]: (p) => `Path "${p}" does not exist on the state tree.`,
  [401 /* ClassNeedsBoolean */]: (name, type) => `class.${name} needs a boolean, got ${type}.`,
  [501 /* FilterUnknown */]: (name) => `filter not found: ${name}.`,
  [601 /* FilterTooFewArgs */]: (name, min, given) => `filter "${name}" requires at least ${min} argument(s) (${given} given).`,
  [602 /* FilterTooManyArgs */]: (name, max, given) => `filter "${name}" accepts at most ${max} argument(s) (${given} given).`,
  [701 /* GetterCycle */]: (p) => `"${p}" depends on itself`,
  [801 /* GetterDepth */]: (p) => `"${p}"`,
  [901 /* IndexArityExact */]: (api, p, depth, n) => `${api}("${p}") takes ${depth} index(es), got ${n}.`,
  [902 /* IndexArityAtMost */]: (api, p, depth, n) => `${api}("${p}") takes at most ${depth} index(es), got ${n}.`,
  [1001 /* IndexParamRange */]: (key) => `"${key}": list index parameters run from $1 to $${MAX_INDEX_PARAM}.`,
  [1101 /* RecursionUnsupported */]: (p) => `"${p}" uses "${RECURSION_WILDCARD}", which is not accepted here.`,
  [1201 /* CommandRightSide */]: (prop, p) => `"${prop}: ${p}": the right-hand side must be $command.<name>`,
  [1202 /* NoBindable */]: (tag, what) => `<${tag}> declares no static wcBindable (${what}).`,
  [1203 /* NoCommand */]: (tag, method) => `<${tag}> declares no command "${method}".`,
  [1204 /* NoProperty */]: (tag, prop) => `<${tag}> declares no property "${prop}".`,
  [1301 /* EventTokenUndeclared */]: (name) => `eventToken "${name}" is not declared in $eventTokens.`,
  [1302 /* CommandTokenUndeclared */]: (name) => `"$command.${name}" is not declared in $commandTokens.`,
  [1401 /* WildcardNoLoop */]: (p, depth, n = 0) => `"${p}" needs ${depth} enclosing loop level(s); the scope provides ${n}.`,
  [1402 /* WildcardRelative */]: (p) => `"${p}" is relative: it needs an enclosing "for" template`,
  [1403 /* WildcardOtherList */]: (p, over, loop) => `"${p}" ranges over the rows of "${over}", but the enclosing "for" template at that level renders "${loop}".`,
  [1501 /* SpreadNoBindable */]: (tag, what) => `<${tag}> declares no static wcBindable (${what}).`,
  [1601 /* DeclarationRemoved */]: (old, name) => `${old} was removed: write ${name}.`,
  [1701 /* ApiRemoved */]: (old, name) => `${old} was removed: write ${name}.`
};

// src/diagnostics/explain.ts
function render(id, args) {
  const sentence = SENTENCES[id];
  return sentence === void 0 ? `${codeOf(id)}#${id} ${args.join(" ")}` : codeOf(id) + sentence(...args);
}
var LINT_CODES = /* @__PURE__ */ new Set([
  "binding-syntax",
  "template-syntax",
  "filter-unknown",
  "filter-arity",
  "index-arity",
  "wildcard-rank",
  "token-undeclared",
  "binding-path-missing",
  "index-param-range"
]);
var GUIDES = [
  [/no loop level in common with the context/, "; pass indexes ([] for all)."],
  [/"([^"#]+)#([^"]*)" is not a filter name: a modifier list .* comes before the input filters/, ' \u2014 write "<property>#$2|$1".'],
  [/\[wcs\/recursion-unsupported\]/, " It is only meaningful in a $recursion declaration, in a recursive getter key, and in the path argument of $getAll / $setAll \u2014 and only when the state declares a $recursion anchor."],
  [/must be single binding/, ' Put the structural binding alone in its own data-wcs (e.g. <template data-wcs="for: items">).'],
  [/\[wcs\/wildcard-rank\] .* needs \d+ enclosing/, ' Wrap it in that many "for" templates, or use $resolve(path, indexes) to name the row explicitly.'],
  [/\[wcs\/wildcard-rank\] .* ranges over the rows of/, ' A "*" in a binding is the row of the loop around it: read a row of another list in a getter, with $resolve(path, indexes).'],
  [/\[wcs\/binding-type-expectation\] class\.([^ ]+)/, ' Write "class.$1: path|truthy" to toggle on truthiness.'],
  [/path segments — the limit/, " Every prefix of a path is interned, so the cost grows with the square of the depth."],
  [/\[wcs\/index-arity\] \$resolve/, ' $resolve takes one index per "*"; $getAll / $setAll take at most that many (fewer expands the rest).'],
  [/"([^"#]+)#[^"]*" is not a filter name: "#" cannot appear in one/, ' Modifiers belong on the left side of the binding, before the ":" \u2014 write "$1" here.']
];
var RENAMED_FILTERS = {
  inc: "add",
  dec: "sub",
  fix: "toFixed",
  uc: "upper",
  lc: "lower",
  cap: "capitalize",
  rep: "repeat",
  rev: "reverse",
  pad: "padStart",
  null: "nullIfEmpty"
};
function removedFilter(name) {
  if (name === "substr") return ' "substr" was removed in 4.0 \u2014 write slice(start, start + length): slice takes the end index, not a length.';
  const to = Object.hasOwn(RENAMED_FILTERS, name) ? RENAMED_FILTERS[name] : null;
  return to === null ? null : ` "${name}" was renamed "${to}" in 3.2 and removed in 4.0 \u2014 write "${to}".`;
}
function explain(message, subject, candidates) {
  const removed = subject !== void 0 && message.includes("[wcs/filter-unknown]") ? removedFilter(subject) : null;
  let out = removed ?? (subject !== void 0 && candidates !== void 0 ? didYouMean(subject, candidates) : "");
  for (const [re, text2] of GUIDES) {
    const m = re.exec(message);
    if (m !== null) out += text2.replace(/\$(\d)/g, (_, i) => m[Number(i)]);
  }
  const mods = /"([^"#]+)#([^"]+)": a binding takes one modifier list/.exec(message);
  if (mods !== null) out += ` \u2014 write "${mods[1]}#${mods[2].split("#").join(",")}".`;
  if (message.includes("[wcs/filter-unknown]")) {
    if (message.includes("formats add-on")) out += ` On a split auto page: features="formats" on the root, or "$features": ["formats"].`;
    else if (!FORMATS_FILTER_NAMES.some(hasFilter)) {
      out += ` No formatting filters are installed \u2014 add the formats add-on: installFeatures([formats]) from "@wcstack/state/features/formats" (a split auto page: features="formats", or "$features").`;
    }
  }
  const code = /\[wcs\/([\w-]+)\]/.exec(message);
  if (code !== null && LINT_CODES.has(code[1]) && !/ path segments — the limit is |inserted content was not rendered|formats add-on/.test(message)) out += LINT_HINT;
  return out;
}

// src/parser/parsePropPart.ts
var cacheFilterInfos2 = /* @__PURE__ */ new Map();
var clearPropPartCache = () => cacheFilterInfos2.clear();
function parsePropPart(propPart) {
  const [propText, filters] = splitFilters(propPart, "input", cacheFilterInfos2);
  const modifierParts = propText.split(MODIFIER_SEPARATOR).map(trimFn);
  if (modifierParts.length > 2) {
    raise(115 /* OneModifierList */, [propText]);
  }
  const [propName, propModifiersText] = modifierParts;
  const propSegments = propName.split(DELIMITER).map(trimFn);
  const isExplicitProperty = propSegments.length > 1 && propSegments[0] === "";
  if (!isExplicitProperty && (propName.length === 0 || propSegments.some((segment) => segment.length === 0))) {
    raise(116 /* NoPropertyName */, [propPart]);
  }
  const propModifiers = propModifiersText ? propModifiersText.split(",").map(trimFn) : [];
  return {
    propName,
    propSegments,
    propModifiers,
    inFilters: filters
  };
}

// src/parser/types.ts
var STRUCTURAL_BINDING_TYPE_SET = /* @__PURE__ */ new Set([
  "if",
  "elseif",
  "else",
  "for"
]);

// src/parser/parseBindTextsForElement.ts
var KEYWORDS_WITHOUT_MODIFIERS = /* @__PURE__ */ new Set([ELSE_KEYWORD, "if", "elseif", "for", SPREAD_PROP]);
var EXPLICIT_PROPERTY_REJECTED_HEADS = /* @__PURE__ */ new Set([
  CLASS_NAMESPACE,
  ATTR_NAMESPACE,
  STYLE_NAMESPACE,
  COMMAND_NAMESPACE,
  EVENT_TOKEN_NAMESPACE,
  VOLUME_INJECTION_PROP
]);
function splitBindTexts(bindText) {
  return splitOutsideQuotes(bindText, BINDING_SEPARATOR);
}
function parseBindTextsForElement(bindText) {
  const bindTexts = splitBindTexts(bindText).map(trimFn).filter((s) => s.length > 0);
  const results = bindTexts.map((bindText2) => {
    const separatorIndex = indexOfOutsideQuotes(bindText2, PROP_VALUE_SEPARATOR);
    if (separatorIndex === -1) {
      raise(101 /* BindTextNoColon */, [bindText2]);
    }
    const propPart = bindText2.slice(0, separatorIndex).trim();
    const statePart = bindText2.slice(separatorIndex + 1).trim();
    const keyword = propPart.split(MODIFIER_SEPARATOR)[0].split(FILTER_SEPARATOR)[0].trim();
    if (KEYWORDS_WITHOUT_MODIFIERS.has(keyword)) {
      if (keyword !== propPart) {
        raise(102 /* StructuralTakesNoModifiers */, [bindText2, keyword]);
      }
      let stateResult2;
      if (keyword === ELSE_KEYWORD) {
        if (statePart.length > 0) {
          raise(103 /* ElseTakesNoValue */, [bindText2]);
        }
        stateResult2 = { statePathName: "#else", outFilters: [] };
      } else if (keyword === SPREAD_PROP) {
        if (statePart.length === 0) {
          raise(104 /* SpreadNoPath */, [bindText2]);
        }
        stateResult2 = parseStatePart(statePart);
        if (stateResult2.outFilters.length > 0) {
          raise(105 /* SpreadNoFilters */, [bindText2]);
        }
      } else {
        stateResult2 = parseStatePart(statePart);
        if (keyword === "for" && stateResult2.outFilters.length > 0) {
          raise(121 /* ForNoFilters */, [bindText2]);
        }
      }
      return {
        propName: keyword,
        propSegments: [keyword],
        propModifiers: [],
        inFilters: [],
        ...stateResult2,
        bindingType: keyword === SPREAD_PROP ? "spread" : keyword
      };
    }
    const stateResult = parseStatePart(statePart);
    const propResult = parsePropPart(propPart);
    const [head] = propResult.propSegments;
    if (head === "" && propResult.propSegments.length > 1) {
      const propSegments = propResult.propSegments.slice(1);
      if (propSegments.includes("") || EXPLICIT_PROPERTY_REJECTED_HEADS.has(propSegments[0])) {
        raise(106 /* LeadingDotNamespace */, [propPart]);
      }
      return {
        ...propResult,
        propName: propSegments.join(DELIMITER),
        propSegments,
        ...stateResult,
        bindingType: "prop"
      };
    }
    return {
      ...propResult,
      ...stateResult,
      // 修飾子（`#ro`・`#onchange` …）と入力フィルタは radio / checkbox のハンドラが読む（要件 B4）。
      // eventToken.<prop>: <name> は要素 dispatch を state へ流す pub/sub 配線。
      // 値適用ではないため bindingType 'event' として listener attach 経路に乗せる。
      bindingType: keyword === "radio" || keyword === "checkbox" ? keyword : head === EVENT_TOKEN_NAMESPACE || head.startsWith(EVENT_PROP_PREFIX) ? "event" : "prop"
    };
  });
  if (results.length > 1) {
    const isIncludeSingleBinding = results.some((r) => STRUCTURAL_BINDING_TYPE_SET.has(r.bindingType));
    if (isIncludeSingleBinding) {
      raise(201 /* StructuralNotSingle */, [bindText]);
    }
  }
  return results;
}

// src/parser/parseBindTextForEmbeddedNode.ts
function parseBindTextForEmbeddedNode(bindText) {
  const stateResult = parseStatePart(bindText);
  return {
    propName: "textContent",
    propSegments: ["textContent"],
    propModifiers: [],
    inFilters: [],
    ...stateResult,
    bindingType: "text"
  };
}

// src/public/pathInfo.ts
var cache = /* @__PURE__ */ new Map();
var ids = 0;
function clearPathInfoCache() {
  cache.clear();
}
function getPathInfo(path) {
  const known = cache.get(path);
  if (known !== void 0) return known;
  if (path.includes(RECURSION_WILDCARD)) raise(1101 /* RecursionUnsupported */, [path]);
  const count = path.split(DELIMITER).length;
  if (count > MAX_PATH_SEGMENTS) raise(117 /* TooManySegments */, [path, count]);
  const info = Object.freeze(new PathInfo(path));
  cache.set(path, info);
  return info;
}
var PathInfo = class {
  constructor(path) {
    this.id = ++ids;
    this.cumulativePaths = [];
    this.cumulativePathInfos = [];
    this.wildcardPaths = [];
    this.indexByWildcardPath = {};
    this.wildcardPathInfos = [];
    this.wildcardParentPaths = [];
    this.wildcardParentPathInfos = [];
    this.wildcardPositions = [];
    const info = (p) => p === path ? this : getPathInfo(p);
    const segments = path.split(DELIMITER);
    let current = "";
    let prev = "";
    for (let i = 0; i < segments.length; i++) {
      current += segments[i];
      if (segments[i] === WILDCARD) {
        this.indexByWildcardPath[current] = this.wildcardPaths.length;
        this.wildcardPaths.push(current);
        this.wildcardPathInfos.push(info(current));
        this.wildcardParentPaths.push(prev);
        this.wildcardParentPathInfos.push(info(prev));
        this.wildcardPositions.push(i);
      }
      this.cumulativePaths.push(current);
      this.cumulativePathInfos.push(info(current));
      prev = current;
      current += DELIMITER;
    }
    const last = this.wildcardPaths.length > 0 ? this.wildcardPaths[this.wildcardPaths.length - 1] : null;
    const parent = this.cumulativePaths.length > 1 ? this.cumulativePaths[this.cumulativePaths.length - 2] : null;
    this.path = path;
    this.segments = segments;
    this.lastSegment = segments[segments.length - 1];
    this.cumulativePathSet = new Set(this.cumulativePaths);
    this.cumulativePathInfoSet = new Set(this.cumulativePathInfos);
    this.wildcardPathSet = new Set(this.wildcardPaths);
    this.wildcardPathInfoSet = new Set(this.wildcardPathInfos);
    this.wildcardParentPathSet = new Set(this.wildcardParentPaths);
    this.wildcardParentPathInfoSet = new Set(this.wildcardParentPathInfos);
    this.lastWildcardPath = last;
    this.lastWildcardInfo = last !== null ? info(last) : null;
    this.parentPath = parent;
    this.parentPathInfo = parent !== null ? info(parent) : null;
    this.wildcardCount = this.wildcardPaths.length;
  }
};

// src/public/parser.ts
hooks.render = render;
hooks.explain = explain;
var withInfo = (b) => {
  const path = b.statePathName;
  const notPath = path.startsWith("$command.") || b.bindingType === "event" && (b.propSegments[0] === "eventToken" || !path.includes("."));
  if (!notPath && path.split(".").some((s) => s === "__proto__" || s === "prototype")) raise(120 /* UnsafeSegment */, [path]);
  return { ...b, statePathInfo: getPathInfo(path) };
};
function parseBindTextsForElement2(bindText) {
  return parseBindTextsForElement(bindText).map(withInfo);
}
function parseBindTextForEmbeddedNode2(bindText) {
  return withInfo(parseBindTextForEmbeddedNode(bindText));
}
function clearParserCaches() {
  clearPathInfoCache();
  clearPropPartCache();
  clearStatePartCache();
}
export {
  clearParserCaches,
  getPathInfo,
  indexOfOutsideQuotes,
  parseBindTextForEmbeddedNode2 as parseBindTextForEmbeddedNode,
  parseBindTextsForElement2 as parseBindTextsForElement,
  splitBindTexts,
  splitOutsideQuotes
};
