"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/tscCore.ts
var tscCore_exports = {};
__export(tscCore_exports, {
  WCS_PREAMBLE: () => WCS_PREAMBLE,
  WCS_PREAMBLE_LENGTH: () => WCS_PREAMBLE_LENGTH,
  createWcsLanguagePlugin: () => createWcsLanguagePlugin,
  stripWcsImport: () => stripWcsImport
});
module.exports = __toCommonJS(tscCore_exports);

// src/language/htmlParse.ts
function asciiLowerCase(text2) {
  return text2.replace(/[A-Z]+/g, (upper2) => upper2.toLowerCase());
}
function parseWcsScriptBlocks(html, stateTagName = "wcs-state") {
  return parseWcsStateElements(html, stateTagName).flatMap((element) => element.scriptBlocks);
}
var RAW_TEXT_ELEMENTS = /* @__PURE__ */ new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext"
]);
function matchRawTextElement(html, lower2, pos) {
  if (html[pos] !== "<") return null;
  for (const tag of RAW_TEXT_ELEMENTS) {
    const open = matchOpenTag(html, pos, tag);
    if (open === null) continue;
    if (tag === "plaintext") return { tag, open, contentEnd: html.length, closed: false };
    let from = open.end;
    for (; ; ) {
      const idx = lower2.indexOf(`</${tag}`, from);
      if (idx === -1) return { tag, open, contentEnd: html.length, closed: false };
      const after = html[idx + tag.length + 2];
      if (after === void 0 || after === ">" || after === "/" || /\s/.test(after)) return { tag, open, contentEnd: idx, closed: true };
      from = idx + 1;
    }
  }
  return null;
}
function afterCloseTag(html, closeStart) {
  const gt = html.indexOf(">", closeStart);
  return gt === -1 ? html.length : gt + 1;
}
function parseWcsStateElements(html, stateTagName = "wcs-state") {
  const elements = [];
  const lower2 = asciiLowerCase(html);
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const raw = matchRawTextElement(html, lower2, pos);
    if (raw !== null) {
      pos = raw.closed ? afterCloseTag(html, raw.contentEnd) : len;
      continue;
    }
    const wcsMatch = matchOpenTag(html, pos, stateTagName);
    if (wcsMatch === null) {
      pos++;
      continue;
    }
    const mountPath = extractAttribute(wcsMatch.tagContent, "mount");
    const bindComponent = parseAttributeNames(wcsMatch.tagContent).has("bind-component");
    const jsonAttr = extractAttribute(wcsMatch.tagContent, "json") ?? void 0;
    const stateAttr = extractAttribute(wcsMatch.tagContent, "state") ?? void 0;
    const srcAttr = extractAttribute(wcsMatch.tagContent, "src") ?? void 0;
    const tagStart = pos;
    const tagEnd = wcsMatch.end;
    pos = wcsMatch.end;
    const scriptBlocks = [];
    let wcsCloseIdx = findCloseTag(html, pos, stateTagName, lower2);
    let wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
    while (pos < wcsEnd) {
      if (html.startsWith("<!--", pos)) {
        const commentEnd = html.indexOf("-->", pos + 4);
        if (commentEnd === -1) break;
        pos = commentEnd + 3;
        continue;
      }
      const inner = matchRawTextElement(html, lower2, pos);
      if (inner === null) {
        pos++;
        continue;
      }
      if (inner.tag === "script") {
        const typeAttr = extractAttribute(inner.open.tagContent, "type");
        if (typeAttr?.toLowerCase() === "module" && inner.closed) {
          const contentStart = inner.open.end;
          scriptBlocks.push({
            contentStart,
            contentEnd: inner.contentEnd,
            content: html.slice(contentStart, inner.contentEnd),
            mountPath,
            bindComponent
          });
        }
      }
      if (!inner.closed) {
        pos = len;
        wcsCloseIdx = -1;
        wcsEnd = len;
        break;
      }
      pos = afterCloseTag(html, inner.contentEnd);
      if (pos > wcsEnd) {
        wcsCloseIdx = findCloseTag(html, pos, stateTagName, lower2);
        wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
      }
    }
    elements.push({ mountPath, bindComponent, jsonAttr, stateAttr, srcAttr, scriptBlocks, tagStart, tagEnd });
    pos = wcsEnd;
    if (wcsCloseIdx !== -1) pos = afterCloseTag(html, wcsCloseIdx);
  }
  return elements;
}
function matchOpenTag(html, pos, tagName) {
  if (html[pos] !== "<") return null;
  const nameStart = pos + 1;
  const nameEnd = nameStart + tagName.length;
  if (nameEnd > html.length) return null;
  const slice2 = html.slice(nameStart, nameEnd);
  if (asciiLowerCase(slice2) !== asciiLowerCase(tagName)) return null;
  const charAfter = html[nameEnd];
  if (charAfter !== ">" && charAfter !== " " && charAfter !== "	" && charAfter !== "\n" && charAfter !== "\r" && charAfter !== "/") {
    return null;
  }
  let i = nameEnd;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  while (i < html.length) {
    const ch = html[i];
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
    } else if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
    } else if (ch === "'") {
      inSingleQuote = true;
    } else if (ch === '"') {
      inDoubleQuote = true;
    } else if (ch === ">") {
      return {
        start: pos,
        end: i + 1,
        tagContent: html.slice(nameEnd, i)
      };
    }
    i++;
  }
  return null;
}
function findCloseTag(html, startPos, tagName, lower2 = asciiLowerCase(html)) {
  const pattern = "</" + tagName;
  const patternLower = asciiLowerCase(pattern);
  const htmlLower = lower2;
  let pos = startPos;
  while (pos < html.length) {
    const idx = htmlLower.indexOf(patternLower, pos);
    if (idx === -1) return -1;
    const afterIdx = idx + pattern.length;
    if (afterIdx < html.length) {
      const ch = html[afterIdx];
      if (ch === ">" || ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        return idx;
      }
    }
    pos = idx + 1;
  }
  return -1;
}
function parseAttributeNames(tagContent) {
  const names = /* @__PURE__ */ new Set();
  const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?/g;
  let match;
  while ((match = attribute.exec(tagContent)) !== null) {
    names.add(match[1].toLowerCase());
  }
  return names;
}
function extractAttribute(tagContent, attrName) {
  const regex = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`,
    "i"
  );
  const match = tagContent.match(regex);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

// ../state/dist/manifest.esm.js
var hooks = {};
function raiseError(message, subject, candidates) {
  throw new Error(`[@wcstack/state] ${message}${hooks.explain?.(message, subject, candidates) ?? ""}`);
}
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
var config = {
  bindAttributeName: "data-wcs",
  commentForPrefix: "wcs-for",
  commentIfPrefix: "wcs-if",
  commentElseIfPrefix: "wcs-elseif",
  commentElsePrefix: "wcs-else",
  tagNames: { state: "wcs-state", ssr: "wcs-ssr" },
  locale: typeof document !== "undefined" ? document.documentElement?.lang || "en" : "en",
  enableContractAnalyzer: false
};
var FEATURE_NAMES = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion", "ssr", "devtools"];
var WILDCARD = "*";
function optionsRequired(fnName) {
  raise(26, [fnName]);
}
function optionMustBeNumber(fnName) {
  raise(27, [fnName]);
}
function valueMustBeNumber(fnName) {
  raise(28, [fnName]);
}
function valueMustBeDate(fnName) {
  raise(29, [fnName]);
}
function valueMustBeArray(fnName) {
  raise(30, [fnName]);
}
function validateNumberString(value) {
  if (!value || isNaN(Number(value))) {
    return false;
  }
  return true;
}
function numberOption(value, fnName) {
  if (!validateNumberString(value)) {
    optionMustBeNumber(fnName);
  }
  return Number(value);
}
function requiredNumberOption(options, index, fnName) {
  return numberOption(options?.[index] ?? optionsRequired(fnName), fnName);
}
function firstLiteral(opt, literals) {
  return literals !== void 0 && literals.length > 0 ? literals[0] : opt;
}
var eq = (options, literals) => {
  const opt = options?.[0] ?? optionsRequired("eq");
  const literal = firstLiteral(opt, literals);
  return (value) => {
    if (typeof value === "number") {
      if (typeof literal !== "string") {
        return value === literal;
      }
      if (!validateNumberString(opt)) {
        optionMustBeNumber("eq");
      }
      return value === Number(opt);
    }
    if (typeof value === "string") {
      return value === opt;
    }
    return value === literal;
  };
};
var ne = (options, literals) => {
  const opt = options?.[0] ?? optionsRequired("ne");
  const literal = firstLiteral(opt, literals);
  return (value) => {
    if (typeof value === "number") {
      if (typeof literal !== "string") {
        return value !== literal;
      }
      if (!validateNumberString(opt)) {
        optionMustBeNumber("ne");
      }
      return value !== Number(opt);
    }
    if (typeof value === "string") {
      return value !== opt;
    }
    return value !== literal;
  };
};
var not = () => (value) => !value;
var numeric = (name, op) => ({
  factory: (options) => {
    const opt = requiredNumberOption(options, 0, name);
    return (value) => {
      if (typeof value !== "number") {
        valueMustBeNumber(name);
      }
      return op(value, opt);
    };
  },
  arity: [1, 1]
});
var truthy = () => (value) => !!value;
var falsy = () => (value) => !value;
var boolean = () => (value) => Boolean(value);
var abs = () => (value) => {
  if (typeof value !== "number") {
    valueMustBeNumber("abs");
  }
  return Math.abs(value);
};
var clamp = (options) => {
  const min = requiredNumberOption(options, 0, "clamp");
  const max = requiredNumberOption(options, 1, "clamp");
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("clamp");
    }
    return Math.min(Math.max(value, min), max);
  };
};
var number = () => (value) => Number(value);
var string = () => (value) => String(value);
var int = () => (value) => parseInt(String(value), 10);
var float = () => (value) => parseFloat(String(value));
var defaults = (options, literals) => {
  const opt = options?.[0] ?? optionsRequired("defaults");
  const fallback = firstLiteral(opt, literals);
  return (value) => {
    if (!value) {
      return fallback;
    }
    return value;
  };
};
var coalesce = (options, literals) => {
  const opt = options?.[0] ?? optionsRequired("coalesce");
  const fallback = firstLiteral(opt, literals);
  return (value) => value ?? fallback;
};
var nullIfEmpty = () => (value) => value === "" ? null : value;
var coreFilters = {
  eq: { factory: eq, arity: [1, 1] },
  ne: { factory: ne, arity: [1, 1] },
  not: { factory: not, arity: [0, 0] },
  lt: numeric("lt", (value, opt) => value < opt),
  le: numeric("le", (value, opt) => value <= opt),
  gt: numeric("gt", (value, opt) => value > opt),
  ge: numeric("ge", (value, opt) => value >= opt),
  add: numeric("add", (value, opt) => value + opt),
  sub: numeric("sub", (value, opt) => value - opt),
  mul: numeric("mul", (value, opt) => value * opt),
  div: numeric("div", (value, opt) => value / opt),
  mod: numeric("mod", (value, opt) => value % opt),
  abs: { factory: abs, arity: [0, 0] },
  clamp: { factory: clamp, arity: [2, 2] },
  int: { factory: int, arity: [0, 0] },
  float: { factory: float, arity: [0, 0] },
  falsy: { factory: falsy, arity: [0, 0] },
  truthy: { factory: truthy, arity: [0, 0] },
  defaults: { factory: defaults, arity: [1, 1] },
  coalesce: { factory: coalesce, arity: [1, 1] },
  boolean: { factory: boolean, arity: [0, 0] },
  number: { factory: number, arity: [0, 0] },
  string: { factory: string, arity: [0, 0] },
  nullIfEmpty: { factory: nullIfEmpty, arity: [0, 0] }
};
var nullishPassthrough = (factory) => (options) => {
  const filterFn = factory(options);
  return (value) => value == null ? value : filterFn(value);
};
var toFixed = (options) => {
  const opt = numberOption(options?.[0] ?? "0", "toFixed");
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("toFixed");
    }
    return value.toFixed(opt);
  };
};
var round = (options) => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? "0", "round"));
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("round");
    }
    return Math.round(value * optValue) / optValue;
  };
};
var floor = (options) => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? "0", "floor"));
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("floor");
    }
    return Math.floor(value * optValue) / optValue;
  };
};
var ceil = (options) => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? "0", "ceil"));
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("ceil");
    }
    return Math.ceil(value * optValue) / optValue;
  };
};
var percent = (options) => {
  const opt = numberOption(options?.[0] ?? "0", "percent");
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("percent");
    }
    return `${(value * 100).toFixed(opt)}%`;
  };
};
var unit = (options) => {
  const opt = options?.[0] ?? optionsRequired("unit");
  return (value) => String(value) + opt;
};
var seen;
var valid = "en";
function defaultLocale() {
  if (config.locale !== seen) {
    seen = config.locale;
    try {
      valid = Intl.getCanonicalLocales(seen)[0];
    } catch {
      console.warn(`[@wcstack/state] ${text(48, [seen])}`);
      valid = "en";
    }
  }
  return valid;
}
var locale = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("locale");
    }
    return value.toLocaleString(explicit ?? defaultLocale());
  };
};
var upper = () => (value) => String(value).toUpperCase();
var lower = () => (value) => String(value).toLowerCase();
var capitalize = () => (value) => {
  const v = String(value);
  if (v.length === 0) {
    return v;
  }
  if (v.length === 1) {
    return v.toUpperCase();
  }
  return v.charAt(0).toUpperCase() + v.slice(1);
};
var trim = () => (value) => String(value).trim();
var slice = (options) => {
  const numberedOpts = [requiredNumberOption(options, 0, "slice")];
  const opt2 = options?.[1];
  if (typeof opt2 !== "undefined") {
    numberedOpts.push(numberOption(opt2, "slice"));
  }
  return (value) => String(value).slice(...numberedOpts);
};
var padStart = (options) => {
  const opt1 = requiredNumberOption(options, 0, "padStart");
  const opt2 = options?.[1] ?? "0";
  return (value) => String(value).padStart(opt1, opt2);
};
var padEnd = (options) => {
  const opt1 = requiredNumberOption(options, 0, "padEnd");
  const opt2 = options?.[1] ?? " ";
  return (value) => String(value).padEnd(opt1, opt2);
};
var repeat = (options) => {
  const opt = requiredNumberOption(options, 0, "repeat");
  return (value) => String(value).repeat(opt);
};
var reverse = () => (value) => String(value).split("").reverse().join("");
var truncate = (options) => {
  const maxLength = requiredNumberOption(options, 0, "truncate");
  const suffix = options?.[1] ?? "\u2026";
  return (value) => {
    const v = String(value);
    if (v.length <= maxLength) {
      return v;
    }
    return v.slice(0, maxLength) + suffix;
  };
};
var join = (options) => {
  const opt = options?.[0] ?? ", ";
  return (value) => {
    if (!Array.isArray(value)) {
      valueMustBeArray("join");
    }
    return value.join(opt);
  };
};
var date = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("date");
    }
    return value.toLocaleDateString(explicit ?? defaultLocale());
  };
};
var time = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("time");
    }
    return value.toLocaleTimeString(explicit ?? defaultLocale());
  };
};
var datetime = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("datetime");
    }
    return value.toLocaleString(explicit ?? defaultLocale());
  };
};
var ymd = (options) => {
  const opt = options?.[0] ?? "-";
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("ymd");
    }
    const year = value.getFullYear().toString();
    const month = (value.getMonth() + 1).toString().padStart(2, "0");
    const day = value.getDate().toString().padStart(2, "0");
    return `${year}${opt}${month}${opt}${day}`;
  };
};
var hms = (options) => {
  const opt = options?.[0] ?? ":";
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("hms");
    }
    const hours = value.getHours().toString().padStart(2, "0");
    const minutes = value.getMinutes().toString().padStart(2, "0");
    const seconds = value.getSeconds().toString().padStart(2, "0");
    return `${hours}${opt}${minutes}${opt}${seconds}`;
  };
};
var formatFilters = {
  toFixed: { factory: toFixed, arity: [0, 1] },
  locale: { factory: locale, arity: [0, 1] },
  // The `String(value)` family passes an absent value through (B8 — see nullishPassthrough)
  upper: { factory: nullishPassthrough(upper), arity: [0, 0] },
  lower: { factory: nullishPassthrough(lower), arity: [0, 0] },
  capitalize: { factory: nullishPassthrough(capitalize), arity: [0, 0] },
  trim: { factory: nullishPassthrough(trim), arity: [0, 0] },
  slice: { factory: nullishPassthrough(slice), arity: [1, 2] },
  // The length is required too (the implementation reads both)
  padStart: { factory: nullishPassthrough(padStart), arity: [1, 2] },
  padEnd: { factory: nullishPassthrough(padEnd), arity: [1, 2] },
  repeat: { factory: nullishPassthrough(repeat), arity: [1, 1] },
  reverse: { factory: nullishPassthrough(reverse), arity: [0, 0] },
  truncate: { factory: nullishPassthrough(truncate), arity: [1, 2] },
  join: { factory: join, arity: [0, 1] },
  round: { factory: round, arity: [0, 1] },
  floor: { factory: floor, arity: [0, 1] },
  ceil: { factory: ceil, arity: [0, 1] },
  percent: { factory: percent, arity: [0, 1] },
  unit: { factory: nullishPassthrough(unit), arity: [1, 1] },
  // The locale-dependent three take a locale like `locale` does (`date(ja-JP)`)
  date: { factory: date, arity: [0, 1] },
  time: { factory: time, arity: [0, 1] },
  datetime: { factory: datetime, arity: [0, 1] },
  ymd: { factory: ymd, arity: [0, 1] },
  hms: { factory: hms, arity: [0, 1] }
};
var STRUCTURAL_BINDING_TYPE_SET = /* @__PURE__ */ new Set([
  "if",
  "elseif",
  "else",
  "for"
]);
var DELIMITER = ".";
var BINDING_SEPARATOR = ";";
var PROP_VALUE_SEPARATOR = ":";
var MODIFIER_SEPARATOR = "#";
var FILTER_SEPARATOR = "|";
var ELSE_KEYWORD = "else";
var SPREAD_PROP = "...";
var EVENT_PROP_PREFIX = "on";
var EVENT_TOKEN_NAMESPACE = "eventToken";
var COMMAND_NAMESPACE = "command";
var CLASS_NAMESPACE = "class";
var ATTR_NAMESPACE = "attr";
var STYLE_NAMESPACE = "style";
var MAX_INDEX_PARAM = 128;
var builtinFilterMeta = {
  // 比較・論理
  eq: { description: "\u7B49\u3057\u3044\u304B\u6BD4\u8F03", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  ne: { description: "\u7570\u306A\u308B\u304B\u6BD4\u8F03", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  // `not` は真偽性（truthy / falsy）の反転。`if:` が `Boolean()` で寄せるのと同じ規則で、
  // `else:` はこのフィルタを足した束縛として組み立てられる（structural/createNotFilter.ts）
  not: { description: "\u771F\u507D\u6027\u3092\u53CD\u8EE2\uFF08falsy \u2192 true\uFF09", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  lt: { description: "\u3088\u308A\u5C0F\u3055\u3044\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  le: { description: "\u4EE5\u4E0B\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  gt: { description: "\u3088\u308A\u5927\u304D\u3044\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  ge: { description: "\u4EE5\u4E0A\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  // 算術
  add: { description: "\u52A0\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  sub: { description: "\u6E1B\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  mul: { description: "\u4E57\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  div: { description: "\u9664\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  mod: { description: "\u5270\u4F59", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  abs: { description: "\u7D76\u5BFE\u5024", hasArgs: false, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 0 },
  clamp: { description: "\u7BC4\u56F2\u5185\u306B\u4E38\u3081\u308B (min,max)", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 2, maxArgs: 2, argTypes: ["number", "number"] },
  // 数値フォーマット
  toFixed: { description: "\u56FA\u5B9A\u5C0F\u6570\u70B9\u8868\u8A18", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  locale: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u3067\u6570\u5024\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 文字列
  upper: { description: "\u5927\u6587\u5B57\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  lower: { description: "\u5C0F\u6587\u5B57\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  capitalize: { description: "\u5148\u982D\u6587\u5B57\u3092\u5927\u6587\u5B57\u306B", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  trim: { description: "\u524D\u5F8C\u306E\u7A7A\u767D\u3092\u524A\u9664", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  slice: { description: "\u90E8\u5206\u6587\u5B57\u5217 (start[,end])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
  padStart: { description: "\u5148\u982D\u3092\u57CB\u3081\u308B (length[,char]\u3002char \u306E\u65E2\u5B9A\u306F 0 \u2014 JS \u306E\u65E2\u5B9A\u306F\u7A7A\u767D\u306A\u306E\u3067\u6CE8\u610F)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  padEnd: { description: "\u672B\u5C3E\u3092\u57CB\u3081\u308B (length[,char]\u3002char \u306E\u65E2\u5B9A\u306F\u7A7A\u767D \u2014 JS \u3068\u540C\u3058)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  repeat: { description: "\u7E70\u308A\u8FD4\u3057 (count)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  reverse: { description: "\u6587\u5B57\u9806\u3092\u53CD\u8EE2", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  truncate: { description: "\u5207\u308A\u8A70\u3081\u3066\u7701\u7565\u8A18\u53F7 (length[,suffix]\u3002suffix \u306E\u65E2\u5B9A\u306F \u2026 \u2014 U+2026 \u306E 1 \u6587\u5B57)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  join: { description: "\u914D\u5217\u3092\u9023\u7D50 ([separator]\u3002\u65E2\u5B9A\u306F\u30AB\u30F3\u30DE + \u7A7A\u767D)", hasArgs: true, resultType: "string", acceptTypes: ["array"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 数値パース・丸め
  int: { description: "\u6574\u6570\u306B\u30D1\u30FC\u30B9", hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
  float: { description: "\u6D6E\u52D5\u5C0F\u6570\u70B9\u6570\u306B\u30D1\u30FC\u30B9", hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
  round: { description: "\u56DB\u6368\u4E94\u5165", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  floor: { description: "\u5207\u308A\u4E0B\u3052", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  ceil: { description: "\u5207\u308A\u4E0A\u3052", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  percent: { description: "\u30D1\u30FC\u30BB\u30F3\u30C6\u30FC\u30B8\u5F62\u5F0F", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  // number だけでなく string も受ける。実用チェーンは fix / percent の後ろに繋がり、
  // それらは既に string を返すため（builtinFilters.ts の unit を参照）
  unit: { description: "\u5358\u4F4D\uFF08\u63A5\u5C3E\u8F9E\uFF09\u3092\u4ED8\u52A0", hasArgs: true, resultType: "string", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["string"] },
  // 日付・時刻
  // `locale` と同じくロケールを 1 つ受ける（`date(ja-JP)`）。実装は最初からこれを読んでいたが、
  // メタデータ側が maxArgs: 0 だったため lint と補完が正しい書き方を誤りとして報告していた
  date: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u65E5\u4ED8 ([locale]\u3002\u65E2\u5B9A\u306F config.locale)", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  time: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u6642\u523B ([locale]\u3002\u65E2\u5B9A\u306F config.locale)", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  datetime: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u65E5\u6642 ([locale]\u3002\u65E2\u5B9A\u306F config.locale)", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  ymd: { description: "YYYY-MM-DD \u5F62\u5F0F ([separator]\u3002\u65E2\u5B9A\u306F -)", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  hms: { description: "HH:MM:SS \u5F62\u5F0F ([separator]\u3002\u65E2\u5B9A\u306F :)", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 真偽値・変換
  falsy: { description: "\u507D\u5024\u304B\u5224\u5B9A", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  truthy: { description: "\u771F\u5024\u304B\u5224\u5B9A", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  defaults: { description: "\u507D\u5024\u306E\u5834\u5408\u30C7\u30D5\u30A9\u30EB\u30C8\u5024", hasArgs: true, resultType: "passthrough", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  coalesce: { description: "null / undefined \u306E\u5834\u5408\u30C7\u30D5\u30A9\u30EB\u30C8\u5024", hasArgs: true, resultType: "passthrough", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  boolean: { description: "\u30D6\u30FC\u30EB\u5024\u306B\u5909\u63DB", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  number: { description: "\u6570\u5024\u306B\u5909\u63DB", hasArgs: false, resultType: "number", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  string: { description: "\u6587\u5B57\u5217\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  nullIfEmpty: { description: "\u7A7A\u6587\u5B57\u5217\u3092null\u306B\u5909\u63DB", hasArgs: false, resultType: "passthrough", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 }
};
var WCS_MANIFEST_VERSION = 2;
var builtinFilterAliases = Object.freeze({});
var DECLARATION_ALIASES = Object.freeze({});
var STATE_API_ALIASES = Object.freeze({});
var MODIFIER_FLAGS = Object.freeze(["prevent", "stop", "ro", "direct"]);
var MODIFIER_KEYS = Object.freeze(["init", "sync"]);
var INDEX_PARAM_PREFIX = "$";
var BEHAVIOR_OPTION_KEYS = ["enableMustache", "sameValueGuard", "enableDirectionalInitialSync"];
function getWcsManifest() {
  return {
    version: WCS_MANIFEST_VERSION,
    syntax: {
      bindAttribute: config.bindAttributeName,
      tagName: config.tagNames.state,
      pathDelimiter: DELIMITER,
      wildcard: WILDCARD,
      delimiters: { binding: BINDING_SEPARATOR, propValue: PROP_VALUE_SEPARATOR, modifier: MODIFIER_SEPARATOR, filter: FILTER_SEPARATOR },
      structuralDirectives: Array.from(STRUCTURAL_BINDING_TYPE_SET),
      modifiers: { flags: MODIFIER_FLAGS, keyValue: MODIFIER_KEYS, eventNamePrefix: EVENT_PROP_PREFIX },
      indexParam: { prefix: INDEX_PARAM_PREFIX, maxDepth: MAX_INDEX_PARAM },
      bindingTypes: {
        elseKeyword: ELSE_KEYWORD,
        spread: SPREAD_PROP,
        eventPropertyPrefix: EVENT_PROP_PREFIX,
        explicitPropertyPrefix: DELIMITER,
        propNamespaces: { eventToken: EVENT_TOKEN_NAMESPACE, command: COMMAND_NAMESPACE, class: CLASS_NAMESPACE, attr: ATTR_NAMESPACE, style: STYLE_NAMESPACE }
      }
    },
    // quoted: `filters` is an internal name the bundles shorten (mangle.mjs)
    "filters": [...Object.keys(coreFilters), ...Object.keys(formatFilters)],
    filterMeta: builtinFilterMeta,
    filterAliases: builtinFilterAliases,
    declarationAliases: DECLARATION_ALIASES,
    apiAliases: STATE_API_ALIASES,
    reservedLifecycle: ["$connectedCallback", "$disconnectedCallback", "$renderedCallback", "$errorCallback", "$stateReadyCallback"],
    reservedStateApi: [
      "$bindables",
      "$commands",
      "$commandTokens",
      "$command",
      "$eventTokens",
      "$on",
      "$stream",
      "$watch",
      "$listKeys",
      "$recursion",
      "$streamStatus",
      "$streamError",
      "$behavior",
      "$features"
    ],
    // every option is a boolean, true when left out (engine.ts `loadTarget`: `typeof … === "boolean"`, `?? true`)
    behaviorOptions: Object.fromEntries(BEHAVIOR_OPTION_KEYS.map((key) => [key, { type: "boolean", default: true }])),
    features: [...FEATURE_NAMES]
  };
}

// src/language/preamble.ts
var manifest = getWcsManifest();
var BEHAVIOR_TYPE = `{ ${Object.entries(manifest.behaviorOptions).map(([key, option]) => `${key}?: ${option.type}`).join("; ")} }`;
var FEATURE_NAME_TYPE = manifest.features.map((name) => JSON.stringify(name)).join(" | ");
var WCS_PREAMBLE = `
// --- @wcstack/state type preamble (auto-injected by vscode-wcs) ---
type _IsAny<T> = 0 extends (1 & T) ? true : false;
type _IsPlainObject<T> =
  _IsAny<T> extends true ? false :
  T extends
    | string | number | boolean | null | undefined | symbol | bigint
    | Function | Date | RegExp | Error
    | Map<any, any> | Set<any> | WeakMap<any, any> | WeakSet<any>
    | Promise<any> | readonly any[]
    ? false
    : T extends Record<string, any> ? true : false;
type _DataKeys<T> = {
  [K in keyof T & string]:
    K extends \`$\${string}\` ? never :
    _IsAny<T[K]> extends true ? K : T[K] extends Function ? never : K;
}[keyof T & string];
type _WcsPaths<T, D extends readonly any[] = []> =
  D["length"] extends 4 ? never :
  { [K in _DataKeys<T>]:
    | K
    | (T[K] extends readonly (infer E)[]
        ? _IsPlainObject<E> extends true
          ? \`\${K}.*\` | _WcsSubPaths<E, \`\${K}.*.\`, [...D, 0]>
          : \`\${K}.*\`
        : _IsPlainObject<T[K]> extends true
          ? _WcsSubPaths<T[K], \`\${K}.\`, [...D, 0]>
          : never)
  }[_DataKeys<T>];
type _WcsSubPaths<T, P extends string, D extends readonly any[]> =
  _WcsPaths<T, D> extends infer R extends string ? \`\${P}\${R}\` : never;
type _WcsPathValue<T, P extends string> =
  P extends keyof T ? T[P]
  : P extends \`\${infer K}.*\`
    ? K extends keyof T ? T[K] extends readonly (infer E)[] ? E : never : never
  : P extends \`\${infer K}.\${infer R}\`
    ? K extends keyof T
      ? T[K] extends readonly (infer E)[]
        ? R extends \`*.\${infer S}\` ? _WcsPathValue<E, S> : R extends "*" ? E : never
        : T[K] extends Record<string, any> ? _WcsPathValue<T[K], R> : never
      : never
    : never;
type _WcsPathAccessor<T> = { [P in _WcsPaths<T>]: _WcsPathValue<T, P> };
type _WcsStreamStatus = "idle" | "active" | "done" | "error";
interface WcsStateApi {
  $getAll<V = any>(path: string, indexes?: number[]): V[];
  $setAll<V = any>(path: string, indexes: number[], value: V | ((current: V, ...indexes: number[]) => V | undefined)): number;
  $setAll<V = any>(path: string, indexes: number[], values: readonly V[], options: { spread: true }): number;
  $postUpdate(path: string): void;
  $resolve(path: string, indexes: number[], value?: any): any;
  $dependOn(path: string): void;
  $untracked<T>(fn: () => T): T;
  $eq(path: string, key: unknown): boolean;
  $eqPath(path: string, keyPath: string): boolean;
  $eqIndex(path: string, level?: number): boolean;
  readonly $stateElement: HTMLElement;
  readonly $command: Record<string, { emit(...args: any[]): any }>;
  readonly $streamStatus: Record<string, _WcsStreamStatus>;
  readonly $streamError: Record<string, unknown>;
  readonly [key: \`$streamStatus.\${string}\`]: _WcsStreamStatus;
  readonly [key: \`$streamError.\${string}\`]: unknown;
  readonly $1: number; readonly $2: number; readonly $3: number;
  readonly $4: number; readonly $5: number; readonly $6: number;
  readonly $7: number; readonly $8: number; readonly $9: number;
  // $recursion \u5BA3\u8A00\u6E08\u307F\u306E\u518D\u5E30\u30D1\u30B9\uFF08\`nodes.**.total\`\uFF09\u3002\u6DF1\u3055\u306E\u65CF\u306A\u306E\u3067 \`_WcsPaths\` \u306E
  // \u6709\u9650\u5C55\u958B\u306B\u306F\u73FE\u308C\u305A\u3001getter \u306E\u30AD\u30FC\u306B\u66F8\u3044\u305F 1 \u672C\u3057\u304B T \u306B\u73FE\u308C\u306A\u3044\u3002\u30D1\u30BF\u30FC\u30F3\u7D22\u5F15\u3067
  // \u300C\`**\` \u3092\u542B\u3080\u30AD\u30FC\u306F\u8AAD\u3081\u308B\u300D\u3068\u3060\u3051\u8A00\u3046\uFF08\u578B\u306F any \u2014 \u6DF1\u3055\u3092\u578B\u3067\u8868\u305B\u306A\u3044\u4EE5\u4E0A\u3001\u5024\u306E\u578B\u3082
  // \u8FBF\u308C\u306A\u3044\uFF09\u3002\u30D1\u30BF\u30FC\u30F3\u306F \`**\` \u3092\u5FC5\u305A\u542B\u3080\u306E\u3067\u3001\u901A\u5E38\u306E\u30C9\u30C3\u30C8\u30D1\u30B9\u306E\u578B\u4ED8\u3051\u306F\u640D\u306A\u308F\u306A\u3044\u3002
  readonly [key: \`\${string}.**.\${string}\`]: any;
  // \u7D20\u306E \`nodes.**\`\uFF08\u518D\u5E30 getter \u306E\u4E2D\u3067\u30CE\u30FC\u30C9\u81EA\u8EAB\u306B\u675F\u7E1B\u3055\u308C\u308B\u8AAD\u307F\uFF09\u306F \`.**.\` \u3092\u542B\u307E\u306A\u3044\u306E\u3067
  // \u672B\u5C3E\u304C \`.**\` \u306E\u30AD\u30FC\u306B\u3082\u540C\u3058\u7D22\u5F15\u3092\u7F6E\u304F\uFF08@wcstack/state \u306E defineState \u3068\u5BFE\uFF09\u3002
  readonly [key: \`\${string}.**\`]: any;
}
// $stream \u306E\u5024\u306F\u3001\u30E9\u30F3\u30BF\u30A4\u30E0\u304C\u5BA3\u8A00\u30AD\u30FC\u306E\u540D\u524D\u3067\u5B9F\u4F53\u5316\u3059\u308B\u30D7\u30ED\u30D1\u30C6\u30A3\u3002T \u306B\u306F\u5BA3\u8A00\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u306E\u4E2D\u306B\u3057\u304B
// \u73FE\u308C\u306A\u3044\u306E\u3067\u3001getter \u3084\u30E1\u30BD\u30C3\u30C9\u306E this \u304B\u3089\u8AAD\u3081\u308B\u3088\u3046 any \u3067\u5199\u3059\u3002initial \u306E\u578B\u306F\u4F7F\u308F\u306A\u3044 \u2014 \u7A7A\u914D\u5217\u306E
// initial \u304C never[] \u306B\u306A\u308A\u3001\u6B63\u3057\u3044\u8AAD\u307F\uFF08\u8981\u7D20\u306E\u30D7\u30ED\u30D1\u30C6\u30A3\uFF09\u307E\u3067\u578B\u30A8\u30E9\u30FC\u306B\u306A\u308B\u305F\u3081\u3002
// T \u306B\u540C\u540D\u306E\u30D7\u30ED\u30D1\u30C6\u30A3\u3092\u660E\u793A\u7684\u306B\u4E8B\u524D\u5BA3\u8A00\u3057\u3066\u3044\u308C\u3070\u5199\u3055\u306A\u3044\uFF08\u4EA4\u5DEE\u3067\u305D\u306E\u578B\u307E\u3067 any \u306B\u6F70\u3055\u306A\u3044\u305F\u3081\uFF09\u3002
type _WcsDeclaredValues<T> =
  (T extends { $stream: infer S } ? { [K in Exclude<keyof S & string, keyof T>]: any } : {});
type _WcsThis<T> = T & WcsStateApi & _WcsPathAccessor<T> & _WcsDeclaredValues<T>;
// $listKeys: { "<listPath>": "<field>" | (row) => key }\uFF08list/listKeys.ts\uFF09\u3002
// \u30AD\u30FC\u6307\u5B9A\u306E\u95A2\u6570\u5F15\u6570\u306B\u6587\u8108\u578B\u3092\u4E0E\u3048\u308B\u305F\u3081\u3060\u3051\u306E\u5BA3\u8A00\uFF08noImplicitAny \u4E0B\u306E\u507D\u30A8\u30E9\u30FC\u56DE\u907F\uFF09\u3002
type _WcsListKeys = Record<string, string | ((row: any) => unknown)>;
// $watch: { "<path>": (cur, prev, ...indexes) => void }\uFF08watch/processWatchDeclaration.ts\uFF09\u3002
// \u30CF\u30F3\u30C9\u30E9\u5F15\u6570\u306B\u6587\u8108\u578B\u3092\u4E0E\u3048\u308B\u305F\u3081\u3060\u3051\u306E\u5BA3\u8A00\uFF08$listKeys \u3068\u540C\u3058\u7406\u7531\uFF09\u3002
// this \u306F ThisType<_WcsThis<T>> \u306B\u3088\u308A state \u578B\u306B\u306A\u308B\u3002
type _WcsWatch = Record<string, (cur: any, prev: any, ...indexes: number[]) => void>;
// $recursion: { "<anchor>": "<repeat>" }\uFF08recursion/declaration.ts\uFF09\u3002\u521D\u7248\u306F\u5358\u4E00\u306E\u81EA\u5DF1\u518D\u5E30
// \u306E\u307F\u3067\u3001\u30A2\u30F3\u30AB\u30FC\u3082\u53CD\u5FA9\u30B5\u30D6\u30D1\u30B9\u3082\u300C\u56FA\u5B9A\u30D7\u30ED\u30D1\u30C6\u30A3\u5217 + \u672B\u5C3E\u306E .*\u300D\u306B\u9650\u308B\u3002\u5F62\u306E\u691C\u8A3C\u306F
// service/recursionValidator.ts\uFF08wcs/recursion-declaration-invalid\uFF09\u304C\u62C5\u3046\u3002
type _WcsRecursion = Record<string, string>;
// $behavior: \u305D\u306E\u6728\u306E\u632F\u308B\u821E\u3044\uFF084.0 \u3067 bootstrapState \u304B\u3089\u79FB\u3063\u305F 3 \u30AD\u30FC\u3002\u65E2\u5B9A\u306F\u3069\u308C\u3082 true\uFF09\u3002
// \u5024\u304C boolean \u3067\u306A\u3044\u5F62\u306F\u578B\u30A8\u30E9\u30FC\u306B\u306A\u308B\u3002\u77E5\u3089\u306A\u3044\u30AD\u30FC\u306F lint\uFF08wcs/behavior-invalid\uFF09\u304C\u5831\u544A\u3059\u308B\u3002
type _WcsBehavior = ${BEHAVIOR_TYPE};
// $features: \u305D\u306E state \u304C\u8981\u308B\u5F8C\u4ED8\u3051\uFF084.0\u3002\u5206\u5272 auto \u306F\u8AAD\u307F\u8FBC\u307F\u3001\u5168\u90E8\u5165\u308A\u30FB\u30D0\u30F3\u30C9\u30E9\u306F\u5165\u3063\u3066\u3044\u308B\u304B\u3092\u691C\u67FB\u3059\u308B\uFF09\u3002
type _WcsFeatureName = ${FEATURE_NAME_TYPE};
function defineState<T extends Record<string, any>>(
  def: T & {
    $listKeys?: _WcsListKeys; $watch?: _WcsWatch; $recursion?: _WcsRecursion;
    $behavior?: _WcsBehavior; $features?: readonly _WcsFeatureName[];
  } & ThisType<_WcsThis<T>>
): T { return def; }
// --- end preamble ---
`;
var WCS_PREAMBLE_LENGTH = WCS_PREAMBLE.length;

// src/language/plugin.ts
var fullFeatures = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true
};
function pathOfScriptId(id) {
  return typeof id === "string" ? id : id.path;
}
function createWcsLanguagePlugin(stateTagName = "wcs-state", options = {}) {
  const tscMode = options.mode === "tsc";
  const build = (html) => {
    const blocks = parseWcsScriptBlocks(html, stateTagName);
    if (blocks.length === 0) return tscMode ? createWcsHtmlVirtualCodeForTsc([], html) : void 0;
    return tscMode ? createWcsHtmlVirtualCodeForTsc(blocks, html) : createWcsHtmlVirtualCode(blocks, html);
  };
  return {
    getLanguageId(id) {
      const path = pathOfScriptId(id);
      if (path.endsWith(".html") || path.endsWith(".htm")) {
        return "html";
      }
      return void 0;
    },
    createVirtualCode(_id, languageId, snapshot, _ctx) {
      if (languageId !== "html") return void 0;
      return build(snapshot.getText(0, snapshot.getLength()));
    },
    updateVirtualCode(_id, _virtualCode, newSnapshot, _ctx) {
      return build(newSnapshot.getText(0, newSnapshot.getLength()));
    },
    typescript: tscMode ? {
      extraFileExtensions: [
        {
          extension: "html",
          isMixedContent: true,
          scriptKind: 7
          /* ts.ScriptKind.Deferred */
        }
      ],
      // tsc: 合成スクリプト 1 本をこのファイルのサービススクリプトにする。
      // getExtraServiceScripts は**定義しない** — proxyCreateProgram は存在するだけで
      // 「not available in this use case」を出力する。
      getServiceScript(root) {
        const combined = root.embeddedCodes?.find((code) => code.id === COMBINED_SCRIPT_ID);
        if (combined === void 0) return void 0;
        return {
          code: combined,
          extension: ".ts",
          scriptKind: 3
          /* ts.ScriptKind.TS */
        };
      }
    } : {
      extraFileExtensions: [
        {
          extension: "html",
          isMixedContent: true,
          scriptKind: 7
          /* ts.ScriptKind.Deferred */
        }
      ],
      getServiceScript(_root) {
        return void 0;
      },
      getExtraServiceScripts(fileName, root) {
        const scripts = [];
        for (const embedded of root.embeddedCodes ?? []) {
          if (embedded.id.startsWith("wcs-script-")) {
            scripts.push({
              fileName: fileName + ".__" + embedded.id + ".ts",
              code: embedded,
              extension: ".ts",
              scriptKind: 3
              // ts.ScriptKind.TS
            });
          }
        }
        return scripts;
      }
    }
  };
}
var COMBINED_SCRIPT_ID = "wcs-combined";
function createWcsHtmlVirtualCodeForTsc(blocks, html) {
  const { code, mappings } = blocks.length === 0 ? { code: "", mappings: [] } : buildCombinedScript(blocks);
  const combined = {
    id: COMBINED_SCRIPT_ID,
    languageId: "typescript",
    snapshot: {
      getText(start, end) {
        return code.slice(start, end);
      },
      getLength() {
        return code.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings
  };
  return {
    id: "root",
    languageId: "html",
    snapshot: {
      getText(start, end) {
        return html.slice(start, end);
      },
      getLength() {
        return html.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings: [{
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [html.length],
      data: htmlFeatures
    }],
    embeddedCodes: [combined]
  };
}
var IMPORT_STATEMENT_RE = /import\s+(?:[\s\S]*?\sfrom\s*)?['"][^'"]+['"]\s*;?/g;
function buildCombinedScript(blocks) {
  let code = WCS_PREAMBLE;
  const mappings = [];
  const map = (sourceOffset, generatedOffset, length) => {
    if (length <= 0) return;
    mappings.push({ sourceOffsets: [sourceOffset], generatedOffsets: [generatedOffset], lengths: [length], data: fullFeatures });
  };
  const bodies = blocks.map((block) => {
    const stripped = stripWcsImport(block.content);
    const userCode = stripped.replace(IMPORT_STATEMENT_RE, (match, offset) => {
      map(block.contentStart + offset, code.length, match.length);
      code += match + "\n";
      return " ".repeat(match.length);
    });
    return { block, userCode };
  });
  bodies.forEach(({ block, userCode }, index) => {
    code += "{\n";
    const decl = `const __wcs_state_${index} = `;
    const exportMatch = /export\s+default\s+/.exec(userCode);
    if (exportMatch === null) {
      map(block.contentStart, code.length, userCode.length);
      code += userCode;
    } else {
      const before = userCode.slice(0, exportMatch.index);
      const afterExport = userCode.slice(exportMatch.index + exportMatch[0].length);
      const afterExportSource = block.contentStart + exportMatch.index + exportMatch[0].length;
      map(block.contentStart, code.length, before.length);
      code += before + decl;
      if (/\bdefineState\s*\(/.test(userCode)) {
        map(afterExportSource, code.length, afterExport.length);
        code += afterExport;
      } else {
        const trailingMatch = afterExport.match(/(\s*;?\s*)$/);
        const trailing = trailingMatch ? trailingMatch[0] : "";
        const objectPart = afterExport.slice(0, afterExport.length - trailing.length);
        code += "defineState(";
        map(afterExportSource, code.length, objectPart.length);
        code += objectPart + ")";
        map(afterExportSource + objectPart.length, code.length, trailing.length);
        code += trailing;
      }
    }
    code += `
void __wcs_state_${index};
}
`;
  });
  return { code, mappings };
}
var htmlFeatures = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: false,
  format: false
};
function createWcsHtmlVirtualCode(blocks, html) {
  const embeddedCodes = blocks.map(
    (block, index) => createScriptVirtualCode(block, index)
  );
  return {
    id: "root",
    languageId: "html",
    snapshot: {
      getText(start, end) {
        return html.slice(start, end);
      },
      getLength() {
        return html.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings: [{
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [html.length],
      data: htmlFeatures
    }],
    embeddedCodes
  };
}
function createScriptVirtualCode(block, index) {
  const userCode = stripWcsImport(block.content);
  const { code: wrappedCode, mappings } = wrapWithDefineState(userCode, block);
  return {
    id: `wcs-script-${index}`,
    languageId: "typescript",
    snapshot: {
      getText(start, end) {
        return wrappedCode.slice(start, end);
      },
      getLength() {
        return wrappedCode.length;
      },
      getChangeRange() {
        return void 0;
      }
    },
    mappings
  };
}
function wrapWithDefineState(userCode, block) {
  const alreadyWrapped = /\bdefineState\s*\(/.test(userCode);
  if (alreadyWrapped) {
    const code2 = WCS_PREAMBLE + userCode;
    return {
      code: code2,
      mappings: [{
        sourceOffsets: [block.contentStart],
        generatedOffsets: [WCS_PREAMBLE_LENGTH],
        lengths: [block.content.length],
        data: fullFeatures
      }]
    };
  }
  const exportDefaultRe = /export\s+default\s+/;
  const match = exportDefaultRe.exec(userCode);
  if (!match) {
    const code2 = WCS_PREAMBLE + userCode;
    return {
      code: code2,
      mappings: [{
        sourceOffsets: [block.contentStart],
        generatedOffsets: [WCS_PREAMBLE_LENGTH],
        lengths: [block.content.length],
        data: fullFeatures
      }]
    };
  }
  const exportEnd = match.index + match[0].length;
  const before = userCode.slice(0, exportEnd);
  const after = userCode.slice(exportEnd);
  const trailingMatch = after.match(/(\s*;?\s*)$/);
  const objectPart = trailingMatch ? after.slice(0, after.length - trailingMatch[0].length) : after;
  const trailing = trailingMatch ? trailingMatch[0] : "";
  const wrapPrefix = "defineState(";
  const wrapSuffix = ")";
  const code = WCS_PREAMBLE + before + wrapPrefix + objectPart + wrapSuffix + trailing;
  const preambleLen = WCS_PREAMBLE_LENGTH;
  const mappings = [{
    sourceOffsets: [
      block.contentStart,
      // before の HTML 開始位置
      block.contentStart + exportEnd,
      // objectPart の HTML 開始位置
      block.contentStart + exportEnd + objectPart.length
      // trailing の HTML 開始位置
    ],
    generatedOffsets: [
      preambleLen,
      // before の仮想コード開始位置
      preambleLen + before.length + wrapPrefix.length,
      // objectPart の仮想コード開始位置
      preambleLen + before.length + wrapPrefix.length + objectPart.length + wrapSuffix.length
      // trailing
    ],
    lengths: [
      before.length,
      objectPart.length,
      trailing.length
    ],
    data: fullFeatures
  }];
  return { code, mappings };
}
function stripWcsImport(code) {
  return code.replace(
    /import\s*\{[^}]*\}\s*from\s*['"](?:@wcstack\/state|https?:\/\/[^'"]*\/@wcstack\/state(?:@[^'"/]*)?(?:\/[^'"]*)?)['"];?[ \t]*/g,
    (match) => match.replace(/[^\n]/g, " ")
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  WCS_PREAMBLE,
  WCS_PREAMBLE_LENGTH,
  createWcsLanguagePlugin,
  stripWcsImport
});
//# sourceMappingURL=tsc-core.cjs.map
