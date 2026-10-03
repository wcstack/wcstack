// src/hooks.ts
var hooks = {};

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

// src/config.ts
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

// src/load.ts
var FEATURE_NAMES = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion", "ssr", "devtools"];

// src/pattern.ts
var WILDCARD = "*";

// src/filters/errorMessages.ts
function optionsRequired(fnName) {
  raise(26 /* FilterOptionsRequired */, [fnName]);
}
function optionMustBeNumber(fnName) {
  raise(27 /* FilterOptionNotNumber */, [fnName]);
}
function valueMustBeNumber(fnName) {
  raise(28 /* FilterValueNotNumber */, [fnName]);
}
function valueMustBeDate(fnName) {
  raise(29 /* FilterValueNotDate */, [fnName]);
}
function valueMustBeArray(fnName) {
  raise(30 /* FilterValueNotArray */, [fnName]);
}

// src/filters/options.ts
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

// src/filters/core.ts
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

// src/filters/formats.ts
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
      console.warn(`[@wcstack/state] ${text(48 /* LocaleInvalid */, [seen])}`);
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

// src/parser/types.ts
var STRUCTURAL_BINDING_TYPE_SET = /* @__PURE__ */ new Set([
  "if",
  "elseif",
  "else",
  "for"
]);

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
var COMMAND_NAMESPACE = "command";
var CLASS_NAMESPACE = "class";
var ATTR_NAMESPACE = "attr";
var STYLE_NAMESPACE = "style";
var MAX_INDEX_PARAM = 128;

// src/public/filterMeta.ts
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

// src/public/manifest.ts
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
export {
  DECLARATION_ALIASES,
  STATE_API_ALIASES,
  STRUCTURAL_BINDING_TYPE_SET,
  WCS_MANIFEST_VERSION,
  builtinFilterAliases,
  builtinFilterMeta,
  getWcsManifest
};
