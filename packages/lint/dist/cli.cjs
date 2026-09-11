#!/usr/bin/env node
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
var __toCommonJS = (mod3) => __copyProps(__defProp({}, "__esModule", { value: true }), mod3);

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  createFileReader: () => createFileReader,
  main: () => main,
  parseArgs: () => parseArgs,
  resolveCliLocale: () => resolveCliLocale
});
module.exports = __toCommonJS(cli_exports);
var import_node_fs2 = require("node:fs");

// src/fileReader.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function createFileReader(htmlPath, read = (p) => (0, import_node_fs.readFileSync)(p, "utf8")) {
  const base = (0, import_node_path.dirname)(htmlPath);
  const cache = /* @__PURE__ */ new Map();
  return (relativePath) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relativePath) || relativePath.startsWith("/")) {
      return void 0;
    }
    if (cache.has(relativePath)) {
      return cache.get(relativePath);
    }
    let content;
    try {
      content = read((0, import_node_path.resolve)(base, relativePath));
      if (content.charCodeAt(0) === 65279) {
        content = content.slice(1);
      }
    } catch {
      content = void 0;
    }
    cache.set(relativePath, content);
    return content;
  };
}

// src/core/offsetToPosition.ts
function createPositionMapper(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      lineStarts.push(i + 1);
    } else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      lineStarts.push(i + 1);
    }
  }
  return (offset2) => {
    const clamped = Math.max(0, Math.min(offset2, text.length));
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (lineStarts[mid] <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: clamped - lineStarts[lo] + 1 };
  };
}

// src/core/diagnostics.ts
var WcsDiagnosticCode = {
  // --- sidecar manifest envelope / schema subset ---
  ManifestBroken: "wcs/manifest-broken",
  ManifestSchemaVersion: "wcs/manifest-schema-version",
  ManifestKindInvalid: "wcs/manifest-kind-invalid",
  ManifestUnknownKeyword: "wcs/manifest-unknown-keyword",
  ManifestExternalRef: "wcs/manifest-external-ref",
  ManifestRefCycle: "wcs/manifest-ref-cycle",
  ManifestRefUnresolved: "wcs/manifest-ref-unresolved",
  ManifestNamespaceVersion: "wcs/manifest-namespace-version",
  // --- sidecar resolution: collision / override ---
  // 同名 tag / filter の後勝ち禁止(§5-3)。override:true が無い再定義もこの collision で表す。
  ManifestTagCollision: "wcs/manifest-tag-collision",
  ManifestFilterCollision: "wcs/manifest-filter-collision",
  // 同名 state の stateSchema が複数の application artifact に宣言されている(§5-3 の
  // application 版・D8)。勝者なし: その state は未宣言扱い(schema 検証は沈黙)。
  ManifestStateCollision: "wcs/manifest-state-collision",
  // 明示 override:true(§5-4)。衝突ではなく意図的な shadow の告知(info)。
  ManifestOverride: "wcs/manifest-override",
  // --- sidecar vs live declaration drift ---
  DriftMissingMember: "wcs/drift-missing-member",
  DriftEventMismatch: "wcs/drift-event-mismatch",
  // --- path / type resolution against a stateSchema ---
  PathNonexistent: "wcs/path-nonexistent",
  PathTypeMismatch: "wcs/path-type-mismatch",
  PathReadonly: "wcs/path-readonly",
  PathReservedName: "wcs/path-reserved-name",
  PathDynamicUnknown: "wcs/path-dynamic-unknown",
  // --- existing binding-expression validators (retrofitted) ---
  FilterUnknown: "wcs/filter-unknown",
  FilterArity: "wcs/filter-arity",
  FilterArgType: "wcs/filter-arg-type",
  FilterInputType: "wcs/filter-input-type",
  BindingPathMissing: "wcs/binding-path-missing",
  BindingTypeExpectation: "wcs/binding-type-expectation",
  TokenUndeclared: "wcs/token-undeclared",
  TokenMisconfigured: "wcs/token-misconfigured",
  NestedAssign: "wcs/nested-assign",
  // --- 意味論（構文・存在検査では捕まらない取り違え。service/semanticValidator.ts） ---
  // `$getAll` / `$setAll` / `$resolve` の添字の本数がパスの `*` の本数と噛み合わない。
  // ランタイムは同じ code で raiseError する（超過は以前は黙って無視されていた）。
  IndexArity: "wcs/index-arity",
  // ワイルドカードの階数がスコープの段数を超える（`matrix.*.*` を 1 段の for で読む、
  // `$2` を 1 段のループで読む）。既存の「for の外」検査の深さ方向の一般化。
  WildcardRank: "wcs/wildcard-rank",
  // パス getter どうしの循環参照。ランタイムはアドレススタック上限まで再帰してから落ちる。
  GetterCycle: "wcs/getter-cycle",
  // `$updatedCallback` が、どのバインディングにも現れないパスを判定に使っている。
  // 同コールバックは **binding 駆動**（live binding が適用された path しか報告しない）
  // なので、その分岐は一度も実行されない。表示要素が購読の実体になる事故
  // （examples/state-intersect-scroll の README に記録）の静的検出。
  UpdatedCallbackUnbound: "wcs/updated-callback-unbound",
  // getter の中で `this.form.name` のように、パス読み取りの先で素のプロパティアクセスを
  // 続けている。追跡されるのは `form` だけで、`form.name` の変更では再評価されない
  // （state README「依存追跡の境界」規則 1）。ランタイムは素のアクセスと区別できないので
  // 静的にしか検出できない。対象はオブジェクトリテラル初期値のルートだけ（配列は `items`
  // の依存で足りる — 行の置換は `items` 自体を書き換え、in-place 変異は array-mutation が止める）。
  GetterUntrackedRead: "wcs/getter-untracked-read",
  // --- <wcs-state> script: $watch declaration ---
  // ランタイム（watch/processWatchDeclaration.ts）が raiseError で落とす宣言。
  // 越境 `@` / `$` 始まり / 空キー・空セグメント / 明らかな非関数ハンドラ。
  WatchDeclarationInvalid: "wcs/watch-declaration-invalid",
  // `$watch` のキーが状態定義に存在しない。バインディング側と違い黙って発火しない
  // だけなので気づけない。severity は binding-path-missing に揃える（warning）。
  WatchPathMissing: "wcs/watch-path-missing",
  // --- <wcs-state> script: $recursion declaration / `**` paths ---
  // ランタイムと同じ code 語彙(@wcstack/state src/recursion/ が正本。
  // docs/state-recursive-path-impl-plan.md §7)。静的に出すのは**パス文字列と宣言だけで
  // 決まる**ものに限る。データを見ないと決まらない wcs/recursion-shared-list /
  // wcs/recursion-cycle / wcs/recursion-depth-exceeded、および評価時の呼び出し文脈に
  // 依存する wcs/recursion-context は runtime 専用(静的側は出さない)。
  //
  // `**` を解釈しない場所へ `**` が渡った(data-wcs / $watch / $resolve)、または
  // `$recursion` 宣言が無いのに `**` を使った。runtime は PathInfo の不変条件として
  // raiseError するか(API 経由)、getter を黙って無視する(宣言なしの `**` getter)。
  RecursionUnsupported: "wcs/recursion-unsupported",
  // 宣言済みアンカーと合致しない `**`(綴り違い・2 つ目の `**`)。
  RecursionAnchor: "wcs/recursion-anchor",
  // `$getAll` の添字の形が `**` に対して定義できない(非空の接頭辞)。
  RecursionGetAllForm: "wcs/recursion-getall-form",
  // `$setAll` の添字・値の形が `**` に対して定義できない
  //(非空の接頭辞 / 添字省略 / mapper / spread)。
  RecursionSetAllForm: "wcs/recursion-setall-form",
  // ノード自身・子リスト・子ノードへの一括書き込み(確定済みの子アドレスを壊す)。
  RecursionStructuralWrite: "wcs/recursion-structural-write",
  // 再帰 getter(およびその派生値の中)への書き込み。setter は初版では持てない。
  RecursionReadonly: "wcs/recursion-readonly",
  // `$recursion` 宣言そのもの、または `**` getter の宣言の形が不正
  //(ランタイムは初期化時に raiseError)。wcs/watch-declaration-invalid の再帰版。
  RecursionDeclarationInvalid: "wcs/recursion-declaration-invalid",
  TypeAnnotation: "wcs/type-annotation",
  TemplateSyntax: "wcs/template-syntax",
  // --- <wcs-state> script: array reactivity hazards ---
  // 配列破壊的メソッド呼び出し(push 等 9 種)。Proxy を素通りしリアクティブ更新されない。
  // 同一参照の自己再代入でも要素の追加・削除は反映されない(docs/array-mutation-diagnostic-design.md §3)。
  ArrayMutation: "wcs/array-mutation",
  // 配列インデックスへの直接代入(bracket-only チェーン)。同上。正はドットパス代入。
  // ドットアクセスを含むチェーン代入は NestedAssign の担当(相補・二重報告なし)。
  ArrayIndexAssign: "wcs/array-index-assign",
  // --- built-in wcs-* tag contract (generated/builtinTags.generated.ts が正本) ---
  // 未知メンバーへのバインド(プロパティ / command. / eventToken. キー)。黙って無視される。
  TagMemberUnknown: "wcs/tag-member-unknown",
  // wcBindable 無宣言タグ(wcs-fetch-header 等のヘルパー)への spread。
  // ランタイム(expandSpread)は raiseError で落とす。
  SpreadNoBindable: "wcs/spread-no-bindable",
  // trigger バインド先スロットの true シード(エッジ検出なし・manual バイパスで即発火)。
  TriggerSeededTruthy: "wcs/trigger-seeded-truthy",
  // 非 manual <wcs-storage> value バインド先の空値シード(初期書き戻しが保存値を上書き)。
  StorageSeedClobber: "wcs/storage-seed-clobber",
  // --- accessibility (docs/a11y-design.md §8 / D9) ---
  // `attr.aria-*` バインドの属性名が WAI-ARIA に存在しない(タイポ)。
  // setAttribute はそのまま書き、支援技術は黙って無視する。severity は warning
  // (error 昇格時は packages/lint/scripts/smoke-test.mjs の対ケース更新が必須)。
  AriaAttrUnknown: "wcs/aria-attr-unknown",
  // --- document-level load configuration ---
  // @wcstack/state/auto より後に他 wcstack /auto が読まれている。
  ScriptOrder: "wcs/script-order",
  // router/auto があるのに <base href> がない(SPA の basename 誤導出)。
  BaseHrefMissing: "wcs/base-href-missing",
  // @wcstack/signals と /dom エントリの同一ページ混在(リアクティブコア二重化)。
  SignalsDualEntry: "wcs/signals-dual-entry",
  // --- deprecations ---
  // 名前付き State（`<wcs-state name>` / `path@name`）。v2 でマウント（`mount=` と接頭辞付きパス）に
  // 置き換わる（docs/state-mount-design.md D16）。1.x では warning、v2 では parse error と同時に error。
  NamedStateDeprecated: "wcs/named-state-deprecated",
  // --- volume mount ---
  // `<wcs-state mount="...">` の値が runtime の validateVolumeMountPath で raise する形
  // （空・空セグメント・ワイルドカード・予約文字 $ # @）。runtime と同条件・同文言（v2）。
  MountPathInvalid: "wcs/mount-path-invalid"
};
function sortDiagnostics(diagnostics) {
  const severityRank = { error: 0, warning: 1, info: 2 };
  return [...diagnostics].sort((a, b) => a.start - b.start || severityRank[a.severity] - severityRank[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

// ../state/dist/manifest.esm.js
var _config = {
  bindAttributeName: "data-wcs",
  tagNames: {
    state: "wcs-state"
  },
  locale: "en"
};
var config = _config;
function raiseError(message) {
  throw new Error(`[@wcstack/state] ${message}`);
}
function optionsRequired(fnName) {
  raiseError(`filter ${fnName} requires at least one option`);
}
function optionMustBeNumber(fnName) {
  raiseError(`filter ${fnName} requires a number as option`);
}
function valueMustBeNumber(fnName) {
  raiseError(`filter ${fnName} requires a number value`);
}
function valueMustBeBoolean(fnName) {
  raiseError(`filter ${fnName} requires a boolean value`);
}
function valueMustBeDate(fnName) {
  raiseError(`filter ${fnName} requires a date value`);
}
function valueMustBeArray(fnName) {
  raiseError(`filter ${fnName} requires an array value`);
}
function validateNumberString(value) {
  if (!value || isNaN(Number(value))) {
    return false;
  }
  return true;
}
var eq = (options) => {
  const opt = options?.[0] ?? optionsRequired("eq");
  return (value) => {
    if (typeof value === "number") {
      if (!validateNumberString(opt)) {
        optionMustBeNumber("eq");
      }
      return value === Number(opt);
    }
    if (typeof value === "string") {
      return value === opt;
    }
    return value === opt;
  };
};
var ne = (options) => {
  const opt = options?.[0] ?? optionsRequired("ne");
  return (value) => {
    if (typeof value === "number") {
      if (!validateNumberString(opt)) {
        optionMustBeNumber("ne");
      }
      return value !== Number(opt);
    }
    if (typeof value === "string") {
      return value !== opt;
    }
    return value !== opt;
  };
};
var not = (_options) => {
  return (value) => {
    if (typeof value !== "boolean") {
      valueMustBeBoolean("not");
    }
    return !value;
  };
};
var lt = (options) => {
  const opt = options?.[0] ?? optionsRequired("lt");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("lt");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("lt");
    }
    return value < Number(opt);
  };
};
var le = (options) => {
  const opt = options?.[0] ?? optionsRequired("le");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("le");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("le");
    }
    return value <= Number(opt);
  };
};
var gt = (options) => {
  const opt = options?.[0] ?? optionsRequired("gt");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("gt");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("gt");
    }
    return value > Number(opt);
  };
};
var ge = (options) => {
  const opt = options?.[0] ?? optionsRequired("ge");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("ge");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("ge");
    }
    return value >= Number(opt);
  };
};
var inc = (options) => {
  const opt = options?.[0] ?? optionsRequired("inc");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("inc");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("inc");
    }
    return value + Number(opt);
  };
};
var dec = (options) => {
  const opt = options?.[0] ?? optionsRequired("dec");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("dec");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("dec");
    }
    return value - Number(opt);
  };
};
var mul = (options) => {
  const opt = options?.[0] ?? optionsRequired("mul");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("mul");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("mul");
    }
    return value * Number(opt);
  };
};
var div = (options) => {
  const opt = options?.[0] ?? optionsRequired("div");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("div");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("div");
    }
    return value / Number(opt);
  };
};
var mod = (options) => {
  const opt = options?.[0] ?? optionsRequired("mod");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("mod");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("mod");
    }
    return value % Number(opt);
  };
};
var abs = (_options) => {
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("abs");
    }
    return Math.abs(value);
  };
};
var clamp = (options) => {
  const opt1 = options?.[0] ?? optionsRequired("clamp");
  if (!validateNumberString(opt1)) {
    optionMustBeNumber("clamp");
  }
  const opt2 = options?.[1] ?? optionsRequired("clamp");
  if (!validateNumberString(opt2)) {
    optionMustBeNumber("clamp");
  }
  const min = Number(opt1);
  const max = Number(opt2);
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("clamp");
    }
    return Math.min(Math.max(value, min), max);
  };
};
var fix = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString(opt)) {
    optionMustBeNumber("fix");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("fix");
    }
    return value.toFixed(Number(opt));
  };
};
var locale = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("locale");
    }
    return value.toLocaleString(explicit ?? config.locale);
  };
};
var uc = (_options) => {
  return (value) => {
    return String(value).toUpperCase();
  };
};
var lc = (_options) => {
  return (value) => {
    return String(value).toLowerCase();
  };
};
var cap = (_options) => {
  return (value) => {
    const v = String(value);
    if (v.length === 0) {
      return v;
    }
    if (v.length === 1) {
      return v.toUpperCase();
    }
    return v.charAt(0).toUpperCase() + v.slice(1);
  };
};
var trim = (_options) => {
  return (value) => {
    return String(value).trim();
  };
};
var slice = (options) => {
  const numberedOpts = [];
  const opt1 = options?.[0] ?? optionsRequired("slice");
  if (!validateNumberString(opt1)) {
    optionMustBeNumber("slice");
  }
  numberedOpts.push(Number(opt1));
  const opt2 = options?.[1];
  if (typeof opt2 !== "undefined") {
    if (!validateNumberString(opt2)) {
      optionMustBeNumber("slice");
    }
    numberedOpts.push(Number(opt2));
  }
  return (value) => {
    return String(value).slice(...numberedOpts);
  };
};
var substr = (options) => {
  const opt1 = options?.[0] ?? optionsRequired("substr");
  if (!validateNumberString(opt1)) {
    optionMustBeNumber("substr");
  }
  const opt2 = options?.[1] ?? optionsRequired("substr");
  if (!validateNumberString(opt2)) {
    optionMustBeNumber("substr");
  }
  return (value) => {
    return String(value).substr(Number(opt1), Number(opt2));
  };
};
var pad = (options) => {
  const opt1 = options?.[0] ?? optionsRequired("pad");
  if (!validateNumberString(opt1)) {
    optionMustBeNumber("pad");
  }
  const opt2 = options?.[1] ?? "0";
  return (value) => {
    return String(value).padStart(Number(opt1), opt2);
  };
};
var rep = (options) => {
  const opt = options?.[0] ?? optionsRequired("rep");
  if (!validateNumberString(opt)) {
    optionMustBeNumber("rep");
  }
  return (value) => {
    return String(value).repeat(Number(opt));
  };
};
var rev = (_options) => {
  return (value) => {
    return String(value).split("").reverse().join("");
  };
};
var int = (_options) => {
  return (value) => {
    return parseInt(String(value), 10);
  };
};
var float = (_options) => {
  return (value) => {
    return parseFloat(String(value));
  };
};
var round = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString(opt)) {
    optionMustBeNumber("round");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("round");
    }
    const optValue = Math.pow(10, Number(opt));
    return Math.round(value * optValue) / optValue;
  };
};
var floor = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString(opt)) {
    optionMustBeNumber("floor");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("floor");
    }
    const optValue = Math.pow(10, Number(opt));
    return Math.floor(value * optValue) / optValue;
  };
};
var ceil = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString(opt)) {
    optionMustBeNumber("ceil");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("ceil");
    }
    const optValue = Math.pow(10, Number(opt));
    return Math.ceil(value * optValue) / optValue;
  };
};
var percent = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString(opt)) {
    optionMustBeNumber("percent");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber("percent");
    }
    return `${(value * 100).toFixed(Number(opt))}%`;
  };
};
var unit = (options) => {
  const opt = options?.[0] ?? optionsRequired("unit");
  return (value) => {
    if (value === null || typeof value === "undefined") {
      return value;
    }
    return String(value) + opt;
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
var truncate = (options) => {
  const opt1 = options?.[0] ?? optionsRequired("truncate");
  if (!validateNumberString(opt1)) {
    optionMustBeNumber("truncate");
  }
  const maxLength = Number(opt1);
  const suffix = options?.[1] ?? "\u2026";
  return (value) => {
    const v = String(value);
    if (v.length <= maxLength) {
      return v;
    }
    return v.slice(0, maxLength) + suffix;
  };
};
var date = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("date");
    }
    return value.toLocaleDateString(explicit ?? config.locale);
  };
};
var time = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("time");
    }
    return value.toLocaleTimeString(explicit ?? config.locale);
  };
};
var datetime = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate("datetime");
    }
    return value.toLocaleString(explicit ?? config.locale);
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
var falsy = (_options) => {
  return (value) => value === false || value === null || value === void 0 || value === 0 || value === "" || Number.isNaN(value);
};
var truthy = (_options) => {
  return (value) => value !== false && value !== null && value !== void 0 && value !== 0 && value !== "" && !Number.isNaN(value);
};
var defaults = (options) => {
  const opt = options?.[0] ?? optionsRequired("defaults");
  return (value) => {
    if (value === false || value === null || value === void 0 || value === 0 || value === "" || Number.isNaN(value)) {
      return opt;
    }
    return value;
  };
};
var boolean = (_options) => {
  return (value) => {
    return Boolean(value);
  };
};
var number = (_options) => {
  return (value) => {
    return Number(value);
  };
};
var string = (_options) => {
  return (value) => {
    return String(value);
  };
};
var _null = (_options) => {
  return (value) => {
    return value === "" ? null : value;
  };
};
var builtinFilters = {
  "eq": eq,
  "ne": ne,
  "not": not,
  "lt": lt,
  "le": le,
  "gt": gt,
  "ge": ge,
  "inc": inc,
  "dec": dec,
  "mul": mul,
  "div": div,
  "mod": mod,
  "abs": abs,
  "clamp": clamp,
  "fix": fix,
  "locale": locale,
  "uc": uc,
  "lc": lc,
  "cap": cap,
  "trim": trim,
  "slice": slice,
  "substr": substr,
  "pad": pad,
  "rep": rep,
  "rev": rev,
  "truncate": truncate,
  "join": join,
  "int": int,
  "float": float,
  "round": round,
  "floor": floor,
  "ceil": ceil,
  "percent": percent,
  "unit": unit,
  "date": date,
  "time": time,
  "datetime": datetime,
  "ymd": ymd,
  "hms": hms,
  "falsy": falsy,
  "truthy": truthy,
  "defaults": defaults,
  "boolean": boolean,
  "number": number,
  "string": string,
  "null": _null
};
var outputBuiltinFilters = builtinFilters;
var builtinFilterMeta = {
  // 比較・論理
  eq: { description: "\u7B49\u3057\u3044\u304B\u6BD4\u8F03", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  ne: { description: "\u7570\u306A\u308B\u304B\u6BD4\u8F03", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  not: { description: "\u30D6\u30FC\u30EB\u5024\u3092\u53CD\u8EE2", hasArgs: false, resultType: "boolean", acceptTypes: ["boolean"], minArgs: 0, maxArgs: 0 },
  lt: { description: "\u3088\u308A\u5C0F\u3055\u3044\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  le: { description: "\u4EE5\u4E0B\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  gt: { description: "\u3088\u308A\u5927\u304D\u3044\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  ge: { description: "\u4EE5\u4E0A\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  // 算術
  inc: { description: "\u52A0\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  dec: { description: "\u6E1B\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  mul: { description: "\u4E57\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  div: { description: "\u9664\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  mod: { description: "\u5270\u4F59", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  abs: { description: "\u7D76\u5BFE\u5024", hasArgs: false, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 0 },
  clamp: { description: "\u7BC4\u56F2\u5185\u306B\u4E38\u3081\u308B (min,max)", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 2, maxArgs: 2, argTypes: ["number", "number"] },
  // 数値フォーマット
  fix: { description: "\u56FA\u5B9A\u5C0F\u6570\u70B9\u8868\u8A18", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  locale: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u3067\u6570\u5024\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 文字列
  uc: { description: "\u5927\u6587\u5B57\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  lc: { description: "\u5C0F\u6587\u5B57\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  cap: { description: "\u5148\u982D\u6587\u5B57\u3092\u5927\u6587\u5B57\u306B", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  trim: { description: "\u524D\u5F8C\u306E\u7A7A\u767D\u3092\u524A\u9664", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  slice: { description: "\u90E8\u5206\u6587\u5B57\u5217 (start[,end])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
  substr: { description: "\u90E8\u5206\u6587\u5B57\u5217 (pos,len)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
  pad: { description: "\u30D1\u30C7\u30A3\u30F3\u30B0 (length[,char])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  rep: { description: "\u7E70\u308A\u8FD4\u3057 (count)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  rev: { description: "\u6587\u5B57\u9806\u3092\u53CD\u8EE2", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  truncate: { description: "\u5207\u308A\u8A70\u3081\u3066\u7701\u7565\u8A18\u53F7 (length[,suffix])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  join: { description: "\u914D\u5217\u3092\u9023\u7D50 ([separator])", hasArgs: true, resultType: "string", acceptTypes: ["array"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
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
  date: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u65E5\u4ED8", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  time: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u6642\u523B", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  datetime: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u65E5\u6642", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  ymd: { description: "YYYY-MM-DD \u5F62\u5F0F", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  hms: { description: "HH:MM:SS \u5F62\u5F0F", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 真偽値・変換
  falsy: { description: "\u507D\u5024\u304B\u5224\u5B9A", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  truthy: { description: "\u771F\u5024\u304B\u5224\u5B9A", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  defaults: { description: "\u507D\u5024\u306E\u5834\u5408\u30C7\u30D5\u30A9\u30EB\u30C8\u5024", hasArgs: true, resultType: "passthrough", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  boolean: { description: "\u30D6\u30FC\u30EB\u5024\u306B\u5909\u63DB", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  number: { description: "\u6570\u5024\u306B\u5909\u63DB", hasArgs: false, resultType: "number", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  string: { description: "\u6587\u5B57\u5217\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  null: { description: "\u7A7A\u6587\u5B57\u5217\u3092null\u306B\u5909\u63DB", hasArgs: false, resultType: "passthrough", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 }
};
var STRUCTURAL_BINDING_TYPE_SET = /* @__PURE__ */ new Set([
  "if",
  "elseif",
  "else",
  "for"
]);
var DELIMITER = ".";
var WILDCARD = "*";
var MAX_WILDCARD_DEPTH = 128;
var BINDING_SEPARATOR = ";";
var PROP_VALUE_SEPARATOR = ":";
var MODIFIER_SEPARATOR = "#";
var FILTER_SEPARATOR = "|";
var MODIFIER_PREVENT = "prevent";
var MODIFIER_STOP = "stop";
var MODIFIER_READONLY = "ro";
var MODIFIER_FLAGS = Object.freeze([
  MODIFIER_PREVENT,
  MODIFIER_STOP,
  MODIFIER_READONLY
]);
var MODIFIER_KEY_INIT = "init";
var MODIFIER_KEY_SYNC = "sync";
var MODIFIER_KEYS = Object.freeze([
  MODIFIER_KEY_INIT,
  MODIFIER_KEY_SYNC
]);
var ELSE_KEYWORD = "else";
var SPREAD_PROP = "...";
var EVENT_PROP_PREFIX = "on";
var EVENT_TOKEN_NAMESPACE = "eventToken";
var COMMAND_NAMESPACE = "command";
var CLASS_NAMESPACE = "class";
var ATTR_NAMESPACE = "attr";
var STYLE_NAMESPACE = "style";
var INDEX_PARAM_PREFIX = "$";
var tmpIndexByIndexName = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
  tmpIndexByIndexName[`${INDEX_PARAM_PREFIX}${i + 1}`] = i;
}
Object.freeze(tmpIndexByIndexName);
var STATE_CONNECTED_CALLBACK_NAME = "$connectedCallback";
var STATE_DISCONNECTED_CALLBACK_NAME = "$disconnectedCallback";
var STATE_UPDATED_CALLBACK_NAME = "$updatedCallback";
var STATE_ERROR_CALLBACK_NAME = "$errorCallback";
var WEBCOMPONENT_STATE_READY_CALLBACK_NAME = "$stateReadyCallback";
var STATE_BINDABLES_NAME = "$bindables";
var STATE_COMMANDS_NAME = "$commands";
var STATE_COMMAND_TOKENS_NAME = "$commandTokens";
var STATE_COMMAND_NAMESPACE_NAME = "$command";
var STATE_EVENT_TOKENS_NAME = "$eventTokens";
var STATE_ON_NAME = "$on";
var STATE_STREAMS_NAME = "$streams";
var STATE_WATCH_NAME = "$watch";
var STATE_LIST_KEYS_NAME = "$listKeys";
var STATE_STREAM_STATUS_NAMESPACE_NAME = "$streamStatus";
var STATE_STREAM_ERROR_NAMESPACE_NAME = "$streamError";
var WCS_MANIFEST_VERSION = 1;
function getWcsManifest() {
  return {
    version: WCS_MANIFEST_VERSION,
    syntax: {
      bindAttribute: config.bindAttributeName,
      tagName: config.tagNames.state,
      pathDelimiter: DELIMITER,
      wildcard: WILDCARD,
      delimiters: {
        binding: BINDING_SEPARATOR,
        propValue: PROP_VALUE_SEPARATOR,
        modifier: MODIFIER_SEPARATOR,
        filter: FILTER_SEPARATOR
      },
      // 正本 STRUCTURAL_BINDING_TYPE_SET から導出（手書きの二重定義を排除）。
      structuralDirectives: Array.from(STRUCTURAL_BINDING_TYPE_SET),
      modifiers: {
        flags: MODIFIER_FLAGS,
        keyValue: MODIFIER_KEYS,
        eventNamePrefix: EVENT_PROP_PREFIX
      },
      indexParam: {
        prefix: INDEX_PARAM_PREFIX,
        maxDepth: MAX_WILDCARD_DEPTH
      },
      bindingTypes: {
        elseKeyword: ELSE_KEYWORD,
        spread: SPREAD_PROP,
        eventPropertyPrefix: EVENT_PROP_PREFIX,
        propNamespaces: {
          eventToken: EVENT_TOKEN_NAMESPACE,
          command: COMMAND_NAMESPACE,
          class: CLASS_NAMESPACE,
          attr: ATTR_NAMESPACE,
          style: STYLE_NAMESPACE
        }
      }
    },
    // 実装（Record のキー）から自動導出。手リストを持たない＝ドリフトの構造的排除。
    filters: Object.keys(outputBuiltinFilters),
    filterMeta: builtinFilterMeta,
    reservedLifecycle: [
      STATE_CONNECTED_CALLBACK_NAME,
      STATE_DISCONNECTED_CALLBACK_NAME,
      STATE_UPDATED_CALLBACK_NAME,
      STATE_ERROR_CALLBACK_NAME,
      WEBCOMPONENT_STATE_READY_CALLBACK_NAME
    ],
    reservedStateApi: [
      STATE_BINDABLES_NAME,
      STATE_COMMANDS_NAME,
      STATE_COMMAND_TOKENS_NAME,
      STATE_COMMAND_NAMESPACE_NAME,
      STATE_EVENT_TOKENS_NAME,
      STATE_ON_NAME,
      STATE_STREAMS_NAME,
      STATE_WATCH_NAME,
      STATE_LIST_KEYS_NAME,
      STATE_STREAM_STATUS_NAMESPACE_NAME,
      STATE_STREAM_ERROR_NAMESPACE_NAME
    ]
  };
}

// src/service/completionData.ts
var BUILTIN_FILTERS = Object.entries(builtinFilterMeta).map(
  ([name, meta]) => ({ name, ...meta })
);
var STRUCTURAL_DIRECTIVE_INFO = {
  for: { description: "\u30EA\u30B9\u30C8\u30EC\u30F3\u30C0\u30EA\u30F3\u30B0 (<template>)", insertColon: true },
  if: { description: "\u6761\u4EF6\u4ED8\u304D\u30EC\u30F3\u30C0\u30EA\u30F3\u30B0 (<template>)", insertColon: true },
  elseif: { description: "else-if \u6761\u4EF6 (<template>)", insertColon: true },
  else: { description: "else \u30D6\u30ED\u30C3\u30AF (<template>)", insertColon: false }
};
var STRUCTURAL_DIRECTIVES = [...STRUCTURAL_BINDING_TYPE_SET].map((name) => ({
  name,
  ...STRUCTURAL_DIRECTIVE_INFO[name]
}));

// src/service/recursionPaths.ts
var RECURSION_WILDCARD = "**";
var RECURSION_KEY = "$recursion";
function hasRecursionWildcard(path) {
  return path.indexOf(RECURSION_WILDCARD) !== -1;
}
function checkNodePath(path) {
  if (typeof path !== "string" || path.length === 0) return "empty";
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0)) return "emptySegment";
  if (segments.length < 2 || segments[segments.length - 1] !== "*") return "notElement";
  if (segments[0].startsWith("$")) return "reservedRoot";
  if (path.indexOf("#") !== -1) return "reservedMount";
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === "*") return "midWildcard";
    if (segments[i] === RECURSION_WILDCARD) return "nestedRecursion";
  }
  return null;
}
function makeRecursionSpec(anchor, repeat) {
  return Object.freeze({
    anchor,
    repeat,
    recursiveAnchor: anchor.slice(0, anchor.lastIndexOf(".")) + "." + RECURSION_WILDCARD,
    anchorList: anchor.slice(0, anchor.lastIndexOf(".")),
    repeatList: repeat.slice(0, repeat.lastIndexOf("."))
  });
}
function splitRecursivePath(spec, path) {
  if (path === spec.recursiveAnchor) return "";
  if (!path.startsWith(spec.recursiveAnchor + ".")) return null;
  const suffix = path.slice(spec.recursiveAnchor.length);
  return hasRecursionWildcard(suffix) ? null : suffix;
}
function foldRecursion(spec, path) {
  if (!path.startsWith(spec.anchor)) return null;
  const unit3 = "." + spec.repeat;
  let cursor = spec.anchor.length;
  let depth = 0;
  while (path.startsWith(unit3, cursor)) {
    cursor += unit3.length;
    depth++;
  }
  if (cursor !== path.length && path.charCodeAt(cursor) !== 46) return null;
  return { depth, rest: path.slice(cursor) };
}
function matchesRecursion(specs, path, has) {
  for (const spec of specs) {
    const folded = foldRecursion(spec, path);
    if (folded === null) continue;
    if (has(spec.anchor + folded.rest)) return true;
    if (has(spec.recursiveAnchor + folded.rest)) return true;
  }
  return false;
}
function collectRecursionSpecs(candidates) {
  const out = [];
  for (const candidate of candidates) {
    if (candidate.kind !== "recursionAnchor" || typeof candidate.repeat !== "string") continue;
    if (!candidate.path.endsWith("." + RECURSION_WILDCARD)) continue;
    const anchor = candidate.path.slice(0, candidate.path.length - RECURSION_WILDCARD.length) + "*";
    if (out.some((spec) => spec.anchor === anchor && spec.repeat === candidate.repeat)) continue;
    out.push(makeRecursionSpec(anchor, candidate.repeat));
  }
  return out;
}
function impliedStructurePaths(spec) {
  const out = [
    { path: spec.anchorList, kind: "data", typeHint: "array" },
    { path: spec.anchor, kind: "list" },
    { path: `${spec.anchorList}.length`, kind: "data", typeHint: "number" }
  ];
  const repeatSegments = spec.repeatList.split(".");
  for (let i = 1; i < repeatSegments.length; i++) {
    out.push({ path: `${spec.anchor}.${repeatSegments.slice(0, i).join(".")}`, kind: "data" });
  }
  out.push({ path: `${spec.anchor}.${spec.repeatList}`, kind: "data", typeHint: "array" });
  out.push({ path: `${spec.anchor}.${spec.repeat}`, kind: "list" });
  out.push({ path: `${spec.anchor}.${spec.repeatList}.length`, kind: "data", typeHint: "number" });
  return out;
}
function structuralWriteTarget(spec, suffix) {
  const unit3 = "." + spec.repeat;
  let rest = suffix;
  while (rest.startsWith(unit3)) rest = rest.slice(unit3.length);
  if (rest.length === 0) return "node";
  const segments = spec.repeatList.split(".");
  for (let i = 1; i <= segments.length; i++) {
    if (rest === "." + segments.slice(0, i).join(".")) return i === segments.length ? "list" : "branch";
  }
  return null;
}
function sameFamily(spec, a, b) {
  const unit3 = "." + spec.repeat;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.endsWith(shorter)) return false;
  const gap = longer.slice(0, longer.length - shorter.length);
  if (gap.length === 0) return true;
  if (gap.length % unit3.length !== 0) return false;
  for (let cursor = 0; cursor < gap.length; cursor += unit3.length) {
    if (!gap.startsWith(unit3, cursor)) return false;
  }
  return true;
}
function conflictingGetterSuffix(spec, getterSuffixes, suffix) {
  for (const declared of getterSuffixes) {
    if (sameFamily(spec, declared, suffix)) return declared;
    if (suffix.startsWith(declared + ".")) return declared;
  }
  return null;
}

// src/service/stateAnalyzer.ts
var RESERVED_STREAMS_KEY = "$streams";
var RESERVED_COMMAND_TOKENS_KEY = "$commandTokens";
var RESERVED_EVENT_TOKENS_KEY = "$eventTokens";
var RESERVED_LIST_KEYS_KEY = "$listKeys";
var RESERVED_WATCH_KEY = "$watch";
var RESERVED_RECURSION_KEY = RECURSION_KEY;
function analyzeStatePaths(scriptContent) {
  const objectContent = extractDefaultExportObject(scriptContent);
  if (!objectContent) return [];
  const paths = [];
  const topLevelProps = parseTopLevelProperties(objectContent);
  const pendingStreamValues = [];
  const pendingListKeys = [];
  const recursionSpec = specFromRecursionValue(topLevelProps.find((p) => p.name === RESERVED_RECURSION_KEY));
  for (const prop of topLevelProps) {
    if (prop.name.startsWith("$")) {
      collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys);
      continue;
    }
    if (prop.kind === "method") {
      paths.push({ path: prop.name, kind: "method" });
      continue;
    }
    if (prop.kind === "getter") {
      if (!paths.some((p) => p.path === prop.name)) {
        paths.push({ path: prop.name, kind: hasRecursionWildcard(prop.name) ? "recursive" : "computed" });
      }
      continue;
    }
    pushDataPropertyPaths(prop, paths);
  }
  for (const streamValue of pendingStreamValues) {
    if (paths.some((p) => p.path === streamValue.name)) continue;
    pushDataPropertyPaths(streamValue, paths);
  }
  for (const listKeyEntry of pendingListKeys) {
    pushListKeyPaths(listKeyEntry, paths);
  }
  if (recursionSpec !== null) {
    if (!paths.some((p) => p.path === recursionSpec.recursiveAnchor && p.kind === "recursionAnchor")) {
      paths.push({ path: recursionSpec.recursiveAnchor, kind: "recursionAnchor", repeat: recursionSpec.repeat });
    }
    for (const implied of impliedStructurePaths(recursionSpec)) {
      if (paths.some((p) => p.path === implied.path)) continue;
      paths.push({ path: implied.path, kind: implied.kind, typeHint: implied.typeHint });
    }
  }
  collectRowShapesFromAssignments(scriptContent, paths);
  return paths;
}
function specFromRecursionValue(prop) {
  if (!prop || prop.kind !== "data" || !prop.value || !isObjectLiteral(prop.value)) return null;
  const entries = parseTopLevelProperties(extractObjectContent(prop.value)).filter((e) => e.kind === "data");
  if (entries.length !== 1) return null;
  const anchor = entries[0].name;
  const repeat = extractStringLiteralValue(entries[0].value);
  if (repeat === null) return null;
  if (checkNodePath(anchor) !== null || checkNodePath(repeat) !== null) return null;
  return makeRecursionSpec(anchor, repeat);
}
function analyzeRecursionDeclaration(scriptContent) {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const prop = parseTopLevelProperties(root.content).find((p) => p.name === RESERVED_RECURSION_KEY);
  if (!prop || prop.nameStart === void 0 || prop.nameEnd === void 0) return null;
  const span = { start: root.start + prop.nameStart, end: root.start + prop.nameEnd };
  if (prop.kind === "method") {
    return { ...span, notObject: true, objectLiteral: false, entries: [], spec: null };
  }
  if (prop.kind !== "data" || !prop.value || prop.valueStart === void 0) {
    return { ...span, notObject: false, objectLiteral: false, entries: [], spec: null };
  }
  if (!isObjectLiteral(prop.value)) {
    const scan = maskCommentsAndStrings(prop.value).trim();
    const definite = /^(["'`])[^"'`]*\1$/.test(scan) || /^-?\d[\w.]*$/.test(scan) || /^(?:true|false|null)$/.test(scan) || /^(?:async\s+)?function\b[\s\S]*\}$/.test(scan) || /^(?:async\s+)?\([^()]*\)\s*=>/.test(scan) || /^(?:async\s+)?[$\w]+\s*=>/.test(scan);
    return { ...span, notObject: definite, objectLiteral: false, entries: [], spec: null };
  }
  const leading = prop.value.length - prop.value.trimStart().length;
  const innerStart = root.start + prop.valueStart + leading + 1;
  const entries = [];
  for (const entry of parseTopLevelProperties(extractObjectContent(prop.value))) {
    if (entry.nameStart === void 0 || entry.nameEnd === void 0) continue;
    const valueStart = entry.valueStart === void 0 ? innerStart + entry.nameEnd : innerStart + entry.valueStart + (entry.value ? entry.value.length - entry.value.trimStart().length : 0);
    entries.push({
      anchor: entry.name,
      repeat: entry.kind === "data" ? extractStringLiteralValue(entry.value) : null,
      start: innerStart + entry.nameStart,
      end: innerStart + entry.nameEnd,
      valueStart,
      valueEnd: valueStart + (entry.value?.trim().length ?? 0)
    });
  }
  return { ...span, notObject: false, objectLiteral: true, entries, spec: specFromRecursionValue(prop) };
}
function analyzeWatchEntries(scriptContent) {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];
  const watchProp = parseTopLevelProperties(root.content).find((p) => p.name === RESERVED_WATCH_KEY);
  if (!watchProp || watchProp.kind !== "data" || !watchProp.value || !isObjectLiteral(watchProp.value) || watchProp.valueStart === void 0) {
    return [];
  }
  const leading = watchProp.value.length - watchProp.value.trimStart().length;
  const innerStart = root.start + watchProp.valueStart + leading + 1;
  const entries = [];
  for (const entry of parseTopLevelProperties(extractObjectContent(watchProp.value))) {
    if (entry.nameStart === void 0 || entry.nameEnd === void 0) continue;
    entries.push({
      key: entry.name,
      start: innerStart + entry.nameStart,
      end: innerStart + entry.nameEnd,
      // メソッド短縮記法は関数。data は値リテラルの形で判定し、識別子参照は疑わない。
      definitelyNotFunction: entry.kind === "data" && isNonFunctionLiteral(entry.value)
    });
  }
  return entries;
}
function analyzeDeclarationSpans(scriptContent) {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];
  const out = [];
  for (const prop of parseTopLevelProperties(root.content)) {
    if (prop.nameStart === void 0 || prop.nameEnd === void 0) continue;
    out.push({
      name: prop.name,
      kind: prop.kind,
      start: root.start + prop.nameStart,
      end: root.start + prop.nameEnd
    });
  }
  return out;
}
function analyzeCallableBodies(scriptContent) {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];
  const out = [];
  for (const prop of parseTopLevelProperties(root.content)) {
    if (prop.kind !== "getter" && prop.kind !== "method") continue;
    if (prop.nameStart === void 0 || prop.nameEnd === void 0) continue;
    out.push({
      name: prop.name,
      kind: prop.kind,
      start: root.start + prop.nameStart,
      end: root.start + prop.nameEnd,
      body: prop.value ?? "",
      bodyStart: root.start + (prop.valueStart ?? 0),
      accessor: prop.accessor
    });
  }
  return out;
}
function isNonFunctionLiteral(value) {
  if (value === void 0) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const scan = maskCommentsAndStrings(trimmed);
  if (/^(?:async\s+)?function\b/.test(trimmed) || scan.includes("=>")) return false;
  return /^["'`]/.test(trimmed) || /^-?\d/.test(trimmed) || /^(?:true|false|null|undefined)\b/.test(trimmed) || trimmed.startsWith("[") || trimmed.startsWith("{");
}
function findNonObjectWatch(scriptContent) {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const watchProp = parseTopLevelProperties(root.content).find((p) => p.name === RESERVED_WATCH_KEY);
  if (!watchProp || watchProp.nameStart === void 0 || watchProp.nameEnd === void 0) {
    return null;
  }
  const span = { start: root.start + watchProp.nameStart, end: root.start + watchProp.nameEnd };
  if (watchProp.kind === "method") {
    return span;
  }
  if (watchProp.kind !== "data" || !watchProp.value) return null;
  const trimmed = watchProp.value.trim();
  if (trimmed.startsWith("{")) return null;
  const scan = maskCommentsAndStrings(trimmed).trim();
  const isArrowFunction = /^(?:async\s+)?\([^()]*\)\s*=>/.test(scan) || /^(?:async\s+)?[$\w]+\s*=>/.test(scan);
  const isWholeLiteral = /^(["'`])[^"'`]*\1$/.test(scan) || /^-?\d[\w.]*$/.test(scan) || /^(?:true|false|null)$/.test(scan) || /^(?:async\s+)?function\b[\s\S]*\}$/.test(scan);
  if (!isArrowFunction && !isWholeLiteral) return null;
  return span;
}
function collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys) {
  if (prop.name === RESERVED_STREAMS_KEY && prop.kind === "data" && prop.value && isObjectLiteral(prop.value)) {
    const entries = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const entry of entries) {
      if (entry.kind !== "data" || entry.name.startsWith("$")) continue;
      const initial = entry.value && isObjectLiteral(entry.value) ? findStreamInitialProperty(entry.value) : void 0;
      pendingStreamValues.push({
        name: entry.name,
        kind: "data",
        value: initial?.value,
        typeHint: initial?.typeHint
      });
      paths.push({ path: `$streamStatus.${entry.name}`, kind: "data", typeHint: "string" });
      paths.push({ path: `$streamError.${entry.name}`, kind: "data" });
    }
    return;
  }
  if (prop.name === RESERVED_COMMAND_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: `$command.${name}`, kind: "command" });
    }
    return;
  }
  if (prop.name === RESERVED_EVENT_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: name, kind: "eventToken" });
    }
    return;
  }
  if (prop.name === RESERVED_LIST_KEYS_KEY && prop.kind === "data" && prop.value && isObjectLiteral(prop.value)) {
    for (const entry of parseTopLevelProperties(extractObjectContent(prop.value))) {
      if (entry.kind !== "data") continue;
      pendingListKeys.push(entry);
    }
    return;
  }
}
function pushListKeyPaths(entry, paths) {
  const listPath = entry.name;
  const segments = listPath.split(".");
  if (listPath.length === 0 || segments.some((s) => s.length === 0) || segments[segments.length - 1] === "*") {
    return;
  }
  if (hasRecursionWildcard(listPath)) {
    return;
  }
  const has = (path) => paths.some((p) => p.path === path);
  if (!has(listPath)) paths.push({ path: listPath, kind: "data", typeHint: "array" });
  if (!has(`${listPath}.*`)) paths.push({ path: `${listPath}.*`, kind: "list" });
  if (!has(`${listPath}.length`)) {
    paths.push({ path: `${listPath}.length`, kind: "data", typeHint: "number" });
  }
  const keyField = extractStringLiteralValue(entry.value);
  if (keyField === null || keyField.includes(".") || keyField.includes("*")) return;
  if (!has(`${listPath}.*.${keyField}`)) {
    paths.push({ path: `${listPath}.*.${keyField}`, kind: "data" });
  }
}
function extractStringLiteralValue(value) {
  if (!value) return null;
  const match = value.trim().match(/^["']([^"'\\]*)["']$/);
  return match && match[1].length > 0 ? match[1] : null;
}
var ROW_ASSIGN = new RegExp(
  String.raw`\bthis\s*(?:\.\s*([$\w]+)|\[\s*["']([^"']+)["']\s*\])\s*=(?![=>])\s*(?:(\[)|(?:[^;={}]|=>)*?\.\s*(?:concat|toSpliced|with)\s*(\())`,
  "gd"
);
function collectRowShapesFromAssignments(script, paths) {
  const scan = maskCommentsAndStrings(script);
  ROW_ASSIGN.lastIndex = 0;
  let match;
  while ((match = ROW_ASSIGN.exec(scan)) !== null) {
    const span = match.indices[1] ?? match.indices[2];
    const listPath = script.slice(span[0], span[1]);
    if (listPath.startsWith("$") || listPath.includes("*") || !hasPath(paths, `${listPath}.*`)) continue;
    const openIndex = match.index + match[0].length - 1;
    const isArrayLiteral2 = scan[openIndex] === "[";
    const inner = extractDelimitedContent(script, scan, openIndex, scan[openIndex], isArrayLiteral2 ? "]" : ")");
    for (const literal2 of collectRowLiterals(inner, isArrayLiteral2 ? 0 : 1)) {
      for (const field of extractRowLiteralFields(literal2)) {
        pushRowFieldPaths(`${listPath}.*.${field.name}`, field, paths, 1);
      }
    }
  }
}
function collectRowLiterals(elementList, arrayDepth) {
  const out = [];
  for (const element of splitTopLevelElements(elementList)) {
    if (element.startsWith("{")) {
      out.push(element);
    } else if (element.startsWith("[") && arrayDepth > 0) {
      const scan = maskCommentsAndStrings(element);
      out.push(...collectRowLiterals(extractDelimitedContent(element, scan, 0, "[", "]"), arrayDepth - 1));
    }
  }
  return out;
}
function extractRowLiteralFields(literal2) {
  const content = extractObjectContent(literal2);
  const fields = parseTopLevelProperties(content).filter((p) => p.kind === "data");
  for (const element of splitTopLevelElements(content)) {
    const shorthand = /^([$\w]+)$/.exec(element);
    if (shorthand && !fields.some((f) => f.name === shorthand[1])) {
      fields.push({ name: shorthand[1], kind: "data" });
    }
  }
  return fields;
}
function pushRowFieldPaths(path, prop, paths, depth) {
  if (!hasPath(paths, path)) paths.push(withHint({ path, kind: "data" }, prop.typeHint));
  if (!prop.value) return;
  if (isArrayLiteral(prop.value)) {
    if (!hasPath(paths, `${path}.*`)) paths.push({ path: `${path}.*`, kind: "list" });
    if (!hasPath(paths, `${path}.length`)) {
      paths.push({ path: `${path}.length`, kind: "data", typeHint: "number" });
    }
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    for (const child of extractArrayElementDataProperties(prop.value)) {
      pushRowFieldPaths(`${path}.*.${child.name}`, child, paths, depth + 1);
    }
    return;
  }
  if (isObjectLiteral(prop.value)) {
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    for (const child of parseTopLevelProperties(extractObjectContent(prop.value))) {
      if (child.kind !== "data") continue;
      pushRowFieldPaths(`${path}.${child.name}`, child, paths, depth + 1);
    }
  }
}
function hasPath(paths, path) {
  return paths.some((p) => p.path === path);
}
function splitTopLevelElements(text) {
  const scan = maskCommentsAndStrings(text);
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((e) => e.trim()).filter((e) => e.length > 0);
}
function findStreamInitialProperty(entryValue) {
  const defProps = parseTopLevelProperties(extractObjectContent(entryValue));
  return defProps.find((p) => p.kind === "data" && p.name === "initial");
}
function extractStringArrayItems(value) {
  if (!isArrayLiteral(value)) return [];
  const items = [];
  const regex = /["']([^"'\\]+)["']/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    items.push(match[1]);
  }
  return items;
}
var MAX_OBJECT_NEST_DEPTH = 5;
function pushDataPropertyPaths(prop, paths) {
  pushDataPropertyPathsAt(prop.name, prop, paths, 0);
}
function pushDataPropertyPathsAt(path, prop, paths, depth) {
  paths.push({ path, kind: "data", typeHint: prop.typeHint, rawInitial: prop.value?.trim() });
  if (prop.value && isArrayLiteral(prop.value)) {
    paths.push({ path: `${path}.*`, kind: "list" });
    paths.push({ path: `${path}.length`, kind: "data", typeHint: "number" });
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    for (const childProp of extractArrayElementDataProperties(prop.value)) {
      pushDataPropertyPathsAt(`${path}.*.${childProp.name}`, childProp, paths, depth + 1);
    }
    return;
  }
  if (prop.value && isObjectLiteral(prop.value)) {
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const childProps = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const childProp of childProps) {
      if (childProp.kind !== "data") continue;
      pushDataPropertyPathsAt(`${path}.${childProp.name}`, childProp, paths, depth + 1);
    }
  }
}
function analyzeJsonPaths(jsonString) {
  let data2;
  try {
    data2 = JSON.parse(jsonString);
  } catch {
    return [];
  }
  if (typeof data2 !== "object" || data2 === null || Array.isArray(data2)) return [];
  const paths = [];
  collectJsonPaths(data2, "", paths, 0);
  return paths;
}
function collectJsonPaths(obj, prefix, paths, depth) {
  if (depth >= MAX_OBJECT_NEST_DEPTH) return;
  for (const [key, value] of Object.entries(obj)) {
    if (prefix === "" && key.startsWith("$")) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    pushJsonValuePaths(path, value, paths, depth);
  }
}
function pushJsonValuePaths(path, value, paths, depth) {
  paths.push({ path, kind: "data", typeHint: inferJsonTypeHint(value) });
  if (Array.isArray(value)) {
    paths.push({ path: `${path}.*`, kind: "list" });
    paths.push({ path: `${path}.length`, kind: "data", typeHint: "number" });
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null && !Array.isArray(value[0])) {
      const firstElement = value[0];
      for (const [childKey, childValue] of Object.entries(firstElement)) {
        pushJsonValuePaths(`${path}.*.${childKey}`, childValue, paths, depth + 1);
      }
    }
  } else if (typeof value === "object" && value !== null) {
    collectJsonPaths(value, path, paths, depth + 1);
  }
}
function inferJsonTypeHint(value) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return void 0;
}
function locateDefaultExportObject(script) {
  const scan = maskCommentsAndStrings(script);
  const match = scan.match(/export\s+default\s+(?:defineState\s*\(\s*)?(\{)/);
  if (!match) return null;
  const braceIndex = scan.indexOf(match[1], match.index);
  return { content: extractBracedContent(script, scan, braceIndex), start: braceIndex + 1 };
}
function extractDefaultExportObject(script) {
  return locateDefaultExportObject(script)?.content ?? null;
}
function parseTopLevelProperties(objectContent) {
  const props = [];
  const scan = maskCommentsAndStrings(objectContent);
  const regex = /(?:(?:get|set)\s+(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*\([^)]*\)\s*\{)|(?:(?:async\s+)?(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*\([^)]*\)\s*\{)|(?:(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*:\s*)/gd;
  let match;
  while ((match = regex.exec(scan)) !== null) {
    const indices = match.indices;
    let nameSpan;
    const nameAt = (group) => {
      const span = indices[group];
      if (!span) return void 0;
      nameSpan = [span[0], span[1]];
      return objectContent.slice(span[0], span[1]);
    };
    const skipBody = () => {
      const braceStart = match.index + match[0].length - 1;
      const body = extractBracedContent(objectContent, scan, braceStart);
      regex.lastIndex = braceStart + body.length + 2;
      return { body, bodyStart: braceStart + 1 };
    };
    const accessorName = nameAt(1) ?? nameAt(2) ?? nameAt(3);
    if (accessorName) {
      const { body, bodyStart } = skipBody();
      const accessor = match[0].startsWith("set") ? "set" : "get";
      props.push({
        name: accessorName,
        kind: "getter",
        accessor,
        value: body,
        valueStart: bodyStart,
        nameStart: nameSpan[0],
        nameEnd: nameSpan[1]
      });
      continue;
    }
    const methodName = nameAt(4) ?? nameAt(5) ?? nameAt(6);
    if (methodName) {
      const { body, bodyStart } = skipBody();
      props.push({
        name: methodName,
        kind: "method",
        value: body,
        valueStart: bodyStart,
        nameStart: nameSpan[0],
        nameEnd: nameSpan[1]
      });
      continue;
    }
    const propName = nameAt(7) ?? nameAt(8) ?? nameAt(9);
    if (propName) {
      const valueStartIndex = match.index + match[0].length;
      const value = extractFullValue(objectContent, scan, valueStartIndex);
      const jsdocType = extractJsDocType(objectContent, match.index);
      const typeHint = jsdocType ?? inferTypeHint(value);
      props.push({
        name: propName,
        kind: "data",
        value,
        typeHint,
        nameStart: nameSpan[0],
        nameEnd: nameSpan[1],
        valueStart: valueStartIndex
      });
      regex.lastIndex = valueStartIndex + value.length;
    }
  }
  return props;
}
function maskCommentsAndStrings(source) {
  const out = source.split("");
  const len = source.length;
  const blank = (i2) => {
    if (source[i2] !== "\n" && source[i2] !== "\r") out[i2] = " ";
  };
  let i = 0;
  while (i < len) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") blank(i++);
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) blank(i++);
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < len && source[i] !== ch) {
        if (source[i] === "\\") blank(i++);
        if (i < len) blank(i++);
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}
function extractFullValue(content, scan, startIndex) {
  let depth = 0;
  let i = startIndex;
  const len = scan.length;
  let inString = null;
  while (i < len) {
    const ch = scan[i];
    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) {
      break;
    }
    i++;
  }
  return content.slice(startIndex, i).trim();
}
function extractBracedContent(text, scan, openBraceIndex) {
  return extractDelimitedContent(text, scan, openBraceIndex, "{", "}");
}
function extractDelimitedContent(text, scan, openIndex, open, close) {
  let depth = 0;
  let inString = null;
  for (let i = openIndex; i < scan.length; i++) {
    const ch = scan[i];
    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  return text.slice(openIndex + 1);
}
function isArrayLiteral(value) {
  return value.trimStart().startsWith("[");
}
function isObjectLiteral(value) {
  return value.trimStart().startsWith("{");
}
function extractObjectContent(value) {
  const trimmed = value.trim();
  const scan = maskCommentsAndStrings(trimmed);
  const start = scan.indexOf("{");
  if (start === -1) return "";
  return extractBracedContent(trimmed, scan, start);
}
function extractArrayElementDataProperties(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return [];
  const scan = maskCommentsAndStrings(trimmed);
  let first = 1;
  while (first < scan.length && /\s/.test(scan[first])) first++;
  if (scan[first] !== "{") return [];
  const objectContent = extractBracedContent(trimmed, scan, first);
  return parseTopLevelProperties(objectContent).filter((prop) => prop.kind === "data");
}
function extractJsDocType(content, propIndex) {
  const before = content.slice(Math.max(0, propIndex - 200), propIndex);
  const jsdocMatch = before.match(/\/\*\*\s*@type\s*\{([^}]+)\}\s*\*\/\s*$/);
  if (!jsdocMatch) return void 0;
  const typeExpr = jsdocMatch[1].trim();
  return normalizeJsDocType(typeExpr);
}
function normalizeJsDocType(typeExpr) {
  const parts = typeExpr.split("|").map((p) => p.trim());
  const normalized = parts.map((p) => {
    const lower = p.toLowerCase();
    if (lower === "string") return "string";
    if (lower === "number") return "number";
    if (lower === "boolean") return "boolean";
    if (lower === "null") return "null";
    if (lower === "undefined") return "null";
    if (lower.endsWith("[]") || lower.startsWith("array")) return "array";
    if (lower === "object") return "object";
    return null;
  }).filter((p) => p !== null);
  if (normalized.length === 0) return void 0;
  const unique = [...new Set(normalized)].sort();
  return unique.join("|");
}
function isEscaped(text, i) {
  let backslashCount = 0;
  let j = i - 1;
  while (j >= 0 && text[j] === "\\") {
    backslashCount++;
    j--;
  }
  return backslashCount % 2 === 1;
}
function inferTypeHint(valueStart) {
  const v = valueStart.trim().replace(/,\s*$/, "");
  if (/^-?\d+\.\d/.test(v)) return "number";
  if (/^-?\d/.test(v)) return "number";
  if (/^["'`]/.test(v)) return "string";
  if (v === "true" || v === "false") return "boolean";
  if (v === "null") return "null";
  if (v.startsWith("[")) return "array";
  if (v.startsWith("{")) return "object";
  return void 0;
}
function analyzeSchemaPaths(schema) {
  const paths = [];
  const defs = schema.$defs ?? {};
  collectSchemaObjectPaths(schema, "", paths, defs, 0);
  return paths;
}
function mergeSchemaCandidates(candidates, applicationSchema) {
  if (applicationSchema === void 0) return candidates;
  const schemaCandidates = [];
  const schemaKeys = /* @__PURE__ */ new Set();
  for (const p of analyzeSchemaPaths(applicationSchema)) {
    schemaCandidates.push(p);
    schemaKeys.add(p.path);
  }
  const kept = candidates.filter((p) => !schemaKeys.has(p.path));
  return [...kept, ...schemaCandidates];
}
function derefSchemaNodes(node, defs) {
  const out = [];
  const stack = [{ node, chain: /* @__PURE__ */ new Set() }];
  while (stack.length > 0) {
    const { node: n, chain } = stack.pop();
    if (n === null || typeof n !== "object") continue;
    if (typeof n.$ref === "string") {
      const match = /^#\/\$defs\/(.+)$/.exec(n.$ref);
      if (match === null || chain.has(n.$ref)) continue;
      const target = defs[match[1].replace(/~1/g, "/").replace(/~0/g, "~")];
      if (target === void 0) continue;
      stack.push({ node: target, chain: /* @__PURE__ */ new Set([...chain, n.$ref]) });
      continue;
    }
    if (Array.isArray(n.anyOf)) {
      for (let i = n.anyOf.length - 1; i >= 0; i--) stack.push({ node: n.anyOf[i], chain });
      continue;
    }
    out.push(n);
  }
  return out;
}
function schemaTypeHint(nodes) {
  const hints = /* @__PURE__ */ new Set();
  for (const n of nodes) {
    const types2 = typeof n.type === "string" ? [n.type] : Array.isArray(n.type) ? n.type : [];
    if (types2.length > 0) {
      for (const t of types2) {
        if (t === "null") continue;
        hints.add(t === "integer" ? "number" : t);
      }
      continue;
    }
    if (Array.isArray(n.enum)) {
      for (const v of n.enum) {
        const h = inferJsonTypeHint(v);
        if (h !== void 0 && h !== "null") hints.add(h);
      }
    } else if (n.const !== void 0) {
      const h = inferJsonTypeHint(n.const);
      if (h !== void 0 && h !== "null") hints.add(h);
    } else if (n.properties !== void 0) {
      hints.add("object");
    } else if (n.items !== void 0) {
      hints.add("array");
    }
  }
  return hints.size === 0 ? void 0 : [...hints].join("|");
}
function collectSchemaObjectPaths(node, prefix, paths, defs, depth) {
  if (depth >= MAX_OBJECT_NEST_DEPTH) return;
  const seen = /* @__PURE__ */ new Set();
  for (const n of derefSchemaNodes(node, defs)) {
    for (const [key, child] of Object.entries(n.properties ?? {})) {
      if (prefix === "" && key.startsWith("$")) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const path = prefix ? `${prefix}.${key}` : key;
      pushSchemaValuePaths(path, child, paths, defs, depth);
    }
  }
}
function pushSchemaValuePaths(path, node, paths, defs, depth) {
  const nodes = derefSchemaNodes(node, defs);
  const typeHint = schemaTypeHint(nodes);
  paths.push(withHint({ path, kind: "data", fromSchema: true }, typeHint));
  const items = nodes.map((n) => n.items).find((i) => i !== void 0 && i !== null && typeof i === "object");
  const isArray2 = items !== void 0 || (typeHint?.split("|").includes("array") ?? false);
  if (isArray2) {
    const itemNodes = items !== void 0 ? derefSchemaNodes(items, defs) : [];
    paths.push(withHint({ path: `${path}.*`, kind: "list", fromSchema: true }, schemaTypeHint(itemNodes)));
    paths.push({ path: `${path}.length`, kind: "data", typeHint: "number", fromSchema: true });
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const seen = /* @__PURE__ */ new Set();
    for (const n of itemNodes) {
      for (const [childKey, childNode] of Object.entries(n.properties ?? {})) {
        if (seen.has(childKey)) continue;
        seen.add(childKey);
        pushSchemaValuePaths(`${path}.*.${childKey}`, childNode, paths, defs, depth + 1);
      }
    }
    return;
  }
  if (nodes.some((n) => n.properties !== void 0)) {
    collectSchemaObjectPaths(node, path, paths, defs, depth + 1);
  }
}
function withHint(candidate, typeHint) {
  return typeHint === void 0 ? candidate : { ...candidate, typeHint };
}

// src/language/htmlParse.ts
function parseWcsScriptBlocks(html, stateTagName = "wcs-state") {
  const blocks = [];
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const wcsMatch = matchOpenTag(html, pos, stateTagName);
    if (wcsMatch === null) {
      pos++;
      continue;
    }
    const mountPath = extractAttribute(wcsMatch.tagContent, "mount");
    pos = wcsMatch.end;
    const wcsCloseIdx = findCloseTag(html, pos, stateTagName);
    const wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
    while (pos < wcsEnd) {
      if (html.startsWith("<!--", pos)) {
        const commentEnd = html.indexOf("-->", pos + 4);
        if (commentEnd === -1) break;
        pos = commentEnd + 3;
        continue;
      }
      const scriptMatch = matchOpenTag(html, pos, "script");
      if (scriptMatch === null) {
        pos++;
        continue;
      }
      const typeAttr = extractAttribute(scriptMatch.tagContent, "type");
      if (typeAttr?.toLowerCase() !== "module") {
        pos = scriptMatch.end;
        continue;
      }
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, "script");
      if (scriptCloseIdx === -1) {
        pos = contentStart;
        break;
      }
      const contentEnd = scriptCloseIdx;
      blocks.push({
        contentStart,
        contentEnd,
        content: html.slice(contentStart, contentEnd),
        mountPath
      });
      pos = html.indexOf(">", scriptCloseIdx) + 1;
      if (pos === 0) break;
    }
    pos = wcsEnd;
    if (wcsCloseIdx !== -1) {
      const closeEnd = html.indexOf(">", wcsCloseIdx);
      if (closeEnd !== -1) pos = closeEnd + 1;
    }
  }
  return blocks;
}
function parseWcsStateElements(html, stateTagName = "wcs-state") {
  const elements = [];
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const wcsMatch = matchOpenTag(html, pos, stateTagName);
    if (wcsMatch === null) {
      pos++;
      continue;
    }
    const mountPath = extractAttribute(wcsMatch.tagContent, "mount");
    const jsonAttr = extractAttribute(wcsMatch.tagContent, "json") ?? void 0;
    const stateAttr = extractAttribute(wcsMatch.tagContent, "state") ?? void 0;
    const srcAttr = extractAttribute(wcsMatch.tagContent, "src") ?? void 0;
    const tagStart = pos;
    const tagEnd = wcsMatch.end;
    pos = wcsMatch.end;
    const scriptBlocks = [];
    const wcsCloseIdx = findCloseTag(html, pos, stateTagName);
    const wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
    while (pos < wcsEnd) {
      if (html.startsWith("<!--", pos)) {
        const commentEnd = html.indexOf("-->", pos + 4);
        if (commentEnd === -1) break;
        pos = commentEnd + 3;
        continue;
      }
      const scriptMatch = matchOpenTag(html, pos, "script");
      if (scriptMatch === null) {
        pos++;
        continue;
      }
      const typeAttr = extractAttribute(scriptMatch.tagContent, "type");
      if (typeAttr?.toLowerCase() !== "module") {
        pos = scriptMatch.end;
        continue;
      }
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, "script");
      if (scriptCloseIdx === -1) {
        pos = contentStart;
        break;
      }
      scriptBlocks.push({
        contentStart,
        contentEnd: scriptCloseIdx,
        content: html.slice(contentStart, scriptCloseIdx),
        mountPath
      });
      pos = html.indexOf(">", scriptCloseIdx) + 1;
      if (pos === 0) break;
    }
    elements.push({ mountPath, jsonAttr, stateAttr, srcAttr, scriptBlocks, tagStart, tagEnd });
    pos = wcsEnd;
    if (wcsCloseIdx !== -1) {
      const closeEnd = html.indexOf(">", wcsCloseIdx);
      if (closeEnd !== -1) pos = closeEnd + 1;
    }
  }
  return elements;
}
function findScriptJsonById(html, id2) {
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const scriptMatch = matchOpenTag(html, pos, "script");
    if (scriptMatch === null) {
      pos++;
      continue;
    }
    const typeAttr = extractAttribute(scriptMatch.tagContent, "type");
    const idAttr = extractAttribute(scriptMatch.tagContent, "id");
    if (typeAttr?.toLowerCase() === "application/json" && idAttr === id2) {
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, "script");
      if (scriptCloseIdx === -1) return null;
      return html.slice(contentStart, scriptCloseIdx);
    }
    pos = scriptMatch.end;
  }
  return null;
}
function matchOpenTag(html, pos, tagName) {
  if (html[pos] !== "<") return null;
  const nameStart = pos + 1;
  const nameEnd = nameStart + tagName.length;
  if (nameEnd > html.length) return null;
  const slice3 = html.slice(nameStart, nameEnd);
  if (slice3.toLowerCase() !== tagName.toLowerCase()) return null;
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
function findCloseTag(html, startPos, tagName) {
  const pattern = "</" + tagName;
  const patternLower = pattern.toLowerCase();
  const htmlLower = html.toLowerCase();
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
function extractAttribute(tagContent, attrName) {
  const regex = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`,
    "i"
  );
  const match = tagContent.match(regex);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

// src/service/statePathResolver.ts
function getStatePathsFromHtml(html, stateTagName = "wcs-state", fileReader) {
  const elements = parseWcsStateElements(html, stateTagName);
  const allPaths = [];
  for (const element of elements) {
    const paths = resolveElementPaths(element, html, fileReader);
    allPaths.push(...paths);
  }
  return allPaths;
}
function resolveElementPaths(element, html, fileReader) {
  const raw = resolveElementPathsRaw(element, html, fileReader);
  if (element.mountPath === null) return raw;
  const prefix = element.mountPath + ".";
  const out = [];
  for (const p of raw) {
    if (p.path.startsWith("$")) continue;
    if (p.kind === "method" || p.kind === "eventToken") continue;
    out.push({ ...p, path: prefix + p.path });
  }
  return out;
}
function resolveElementPathsRaw(element, html, fileReader) {
  if (element.stateAttr) {
    const jsonContent = findScriptJsonById(html, element.stateAttr);
    if (jsonContent) {
      const paths = analyzeJsonPaths(jsonContent);
      if (paths.length > 0) return paths;
    }
  }
  if (element.srcAttr && fileReader) {
    const paths = resolveSrcAttribute(element.srcAttr, fileReader);
    if (paths.length > 0) return paths;
  }
  if (element.jsonAttr) {
    const paths = analyzeJsonPaths(element.jsonAttr);
    if (paths.length > 0) return paths;
  }
  if (element.scriptBlocks.length > 0) {
    return element.scriptBlocks.flatMap(
      (block) => analyzeStatePaths(block.content)
    );
  }
  return [];
}
function resolveSrcAttribute(srcPath, fileReader) {
  if (srcPath.endsWith(".json")) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeJsonPaths(content);
    }
    return [];
  }
  if (srcPath.endsWith(".js")) {
    const tsPath = srcPath.replace(/\.js$/, ".ts");
    const tsContent = fileReader(tsPath);
    if (tsContent) {
      return analyzeStatePaths(tsContent);
    }
    const jsContent = fileReader(srcPath);
    if (jsContent) {
      return analyzeStatePaths(jsContent);
    }
    return [];
  }
  if (srcPath.endsWith(".ts")) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeStatePaths(content);
    }
    return [];
  }
  return [];
}

// src/service/forContext.ts
function isInsideForTemplate(html, offset2, bindAttrName = "data-wcs") {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:`,
    "gi"
  );
  const closeRegex = /<\/template\s*>/gi;
  const opens = [];
  let match;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset2) break;
    opens.push(match.index);
  }
  if (opens.length === 0) return false;
  for (const openPos of opens) {
    const depth = getForTemplateDepthAt(html, openPos, offset2, bindAttrName);
    if (depth > 0) return true;
  }
  return false;
}
function getInnermostForPath(html, offset2, bindAttrName = "data-wcs") {
  const chain = getEnclosingForPaths(html, offset2, bindAttrName);
  return chain.length === 0 ? null : chain[chain.length - 1];
}
function getEnclosingForPaths(html, offset2, bindAttrName = "data-wcs") {
  return getEnclosingFors(html, offset2, bindAttrName).map((entry) => entry.path);
}
function getEnclosingFors(html, offset2, bindAttrName = "data-wcs") {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:\\s*([^"']+?)\\s*["']`,
    "gi"
  );
  const enclosing = [];
  let match;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset2) break;
    const tagEnd = html.indexOf(">", match.index);
    if (tagEnd === -1 || tagEnd >= offset2) continue;
    const depth = getForTemplateDepthAt(html, match.index, offset2, bindAttrName);
    if (depth > 0) {
      enclosing.push({ path: match[1].trim(), anchor: match.index });
    }
  }
  return enclosing;
}
function countWildcardSegments(path) {
  let count = 0;
  for (const segment of path.split(".")) {
    if (segment === "*") count++;
  }
  return count;
}
function forPathOf(raw) {
  let path = raw.trim();
  const pipe = path.indexOf("|");
  if (pipe !== -1) path = path.slice(0, pipe).trim();
  const at2 = path.indexOf("@");
  if (at2 !== -1) path = path.slice(0, at2).trim();
  return path;
}
function getAvailableWildcardRank(html, offset2, bindAttrName = "data-wcs") {
  const chain = getEnclosingForPaths(html, offset2, bindAttrName);
  if (chain.length === 0) return 0;
  let resolved = "";
  for (const raw of chain) {
    const path = forPathOf(raw);
    if (path === ".") {
      resolved = `${resolved}.*`;
    } else if (path.startsWith(".")) {
      resolved = `${resolved}.*.${path.slice(1)}`;
    } else {
      resolved = path;
    }
  }
  return countWildcardSegments(resolved) + 1;
}
function getForTemplateDepthAt(html, openPos, offset2, bindAttrName) {
  const tagEnd = html.indexOf(">", openPos);
  if (tagEnd === -1 || tagEnd >= offset2) return 0;
  let depth = 1;
  let pos = tagEnd + 1;
  const templateOpenRegex = /<template[\s>]/gi;
  const templateCloseRegex = /<\/template\s*>/gi;
  while (pos < offset2 && depth > 0) {
    templateOpenRegex.lastIndex = pos;
    templateCloseRegex.lastIndex = pos;
    const nextOpen = templateOpenRegex.exec(html);
    const nextClose = templateCloseRegex.exec(html);
    const openIdx = nextOpen && nextOpen.index < offset2 ? nextOpen.index : Infinity;
    const closeIdx = nextClose && nextClose.index < offset2 ? nextClose.index : Infinity;
    if (openIdx === Infinity && closeIdx === Infinity) break;
    if (openIdx < closeIdx) {
      depth++;
      pos = openIdx + 1;
    } else {
      depth--;
      if (depth === 0 && closeIdx < offset2) {
        return 0;
      }
      pos = closeIdx + (nextClose ? nextClose[0].length : 1);
    }
  }
  return depth;
}

// src/core/messages.ts
function resolveLocale(locale3) {
  if (locale3 === void 0 || locale3 === "" || /^ja\b|^ja[-_]/i.test(locale3) || locale3.toLowerCase() === "ja") return "ja";
  return "en";
}
var JA_EXPECTED_LABEL = {
  array: "\u914D\u5217\u578B\u306E\u30D1\u30B9",
  boolean: "\u30D6\u30FC\u30EA\u30A2\u30F3\u578B",
  string: "\u6587\u5B57\u5217\u578B"
};
var ja = {
  spreadFilterNotAllowed: () => `\u30B9\u30D7\u30EC\u30C3\u30C9\u306E\u30BF\u30FC\u30B2\u30C3\u30C8\u306B\u30D5\u30A3\u30EB\u30BF\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  spreadTargetRequired: () => `\u30B9\u30D7\u30EC\u30C3\u30C9\u306B\u306F\u30BF\u30FC\u30B2\u30C3\u30C8\u30D1\u30B9\u304C\u5FC5\u8981\u3067\u3059`,
  structuralMustBeSingle: (d) => `'${d}' \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u306F\u5358\u72EC\u3067\u6307\u5B9A\u3059\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08';' \u3067\u4ED6\u306E\u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u3068\u4F75\u8A18\u3067\u304D\u307E\u305B\u3093\u3002\u30E9\u30F3\u30BF\u30A4\u30E0\u306F\u8AAD\u307F\u8FBC\u307F\u6642\u306B throw \u3057\u307E\u3059\uFF09`,
  eventTokenUndeclared: (t) => `\u30A4\u30D9\u30F3\u30C8\u30C8\u30FC\u30AF\u30F3 "${t}" \u306F $eventTokens \u306B\u5BA3\u8A00\u3055\u308C\u3066\u3044\u307E\u305B\u3093`,
  commandRhsFormat: () => `command \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u306E\u53F3\u8FBA\u306B\u306F $command.<name>\uFF08$commandTokens \u3067\u5BA3\u8A00\uFF09\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  commandTokenUndeclared: (t) => `\u30B3\u30DE\u30F3\u30C9\u30C8\u30FC\u30AF\u30F3 "${t}" \u306F $commandTokens \u306B\u5BA3\u8A00\u3055\u308C\u3066\u3044\u307E\u305B\u3093`,
  streamPathMissing: (p) => `\u30D1\u30B9 "${p}" \u306F $streams \u5BA3\u8A00\u306B\u5B58\u5728\u3057\u307E\u305B\u3093`,
  pathMissing: (p) => `\u30D1\u30B9 "${p}" \u306F\u72B6\u614B\u5B9A\u7FA9\u306B\u5B58\u5728\u3057\u307E\u305B\u3093`,
  pathNonexistent: (p) => `\u30D1\u30B9 "${p}" \u306F\u5BA3\u8A00\u3055\u308C\u305F stateSchema \u306B\u5B58\u5728\u3057\u307E\u305B\u3093`,
  pathTypeMismatch: (p, label, expected, actual) => `\u30D1\u30B9 "${p}" \u306F stateSchema \u4E0A\u3067 ${actual} \u578B\u3067\u3059\u304C\u3001${label} \u306B\u306F${JA_EXPECTED_LABEL[expected]}\u304C\u5FC5\u8981\u3067\u3059`,
  expansionSuffix: (x) => `\uFF08\u5C55\u958B: ${x}\uFF09`,
  patternPathOutsideFor: (p) => `\u30D1\u30BF\u30FC\u30F3\u30D1\u30B9 "${p}" \u306F <template for> \u306E\u5916\u5074\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  omittedPathOutsideFor: (p) => `\u7701\u7565\u30D1\u30B9 "${p}" \u306F <template for> \u306E\u5916\u5074\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  loopIndexOutsideFor: (p) => `\u30EB\u30FC\u30D7\u30A4\u30F3\u30C7\u30C3\u30AF\u30B9 "${p}" \u306F <template for> \u306E\u5916\u5074\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  resolvedPathInUi: (p) => `\u89E3\u6C7A\u6E08\u307F\u30D1\u30B9 "${p}" \u306F UI \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u30D1\u30BF\u30FC\u30F3\u30D1\u30B9\u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044`,
  indexArity: (api, p, req, wc, actual) => `${api}("${p}") \u306E\u6DFB\u5B57\u306F${req === "exact" ? `\u3061\u3087\u3046\u3069 ${wc} \u500B` : `${wc} \u500B\u4EE5\u4E0B`}\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08\u30D1\u30B9\u4E2D\u306E "*" \u306F ${wc} \u500B\uFF09\u3002${actual} \u500B\u6307\u5B9A\u3055\u308C\u3066\u3044\u307E\u3059`,
  wildcardRank: (subject, needed, available) => `${subject} \u306F ${needed} \u6BB5\u306E\u30EB\u30FC\u30D7\u304C\u5FC5\u8981\u3067\u3059\u304C\u3001\u73FE\u5728\u306E\u30B9\u30B3\u30FC\u30D7\u306F ${available} \u6BB5\u3067\u3059`,
  getterCycle: (cycle) => `\u30D1\u30B9 getter \u304C\u5FAA\u74B0\u53C2\u7167\u3057\u3066\u3044\u307E\u3059: ${cycle}`,
  updatedCallbackUnbound: (p) => `$updatedCallback \u306F binding \u99C6\u52D5\u3067\u3059\u3002"${p}" \u306F\u3053\u306E\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\u306E\u3069\u306E\u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u306B\u3082\u73FE\u308C\u306A\u3044\u305F\u3081\u3001\u3053\u306E\u5206\u5C90\u306F\u4E00\u5EA6\u3082\u5B9F\u884C\u3055\u308C\u307E\u305B\u3093\u3002\u63CF\u753B\u306B\u4F9D\u5B58\u305B\u305A\u53CD\u5FDC\u3059\u308B\u306A\u3089 $watch \u3092\u4F7F\u3063\u3066\u304F\u3060\u3055\u3044`,
  getterUntrackedRead: (root, sp) => `\u3053\u3053\u3067\u8FFD\u8DE1\u3055\u308C\u308B\u306E\u306F "${root}" \u3060\u3051\u3067\u3059\u3002"${sp}" \u304C\u5909\u308F\u3063\u3066\u3082\u3053\u306E getter \u306F\u518D\u8A55\u4FA1\u3055\u308C\u307E\u305B\u3093\uFF08\u30D1\u30B9\u8AAD\u307F\u53D6\u308A\u306E\u5148\u306E\u7D20\u306E\u30D7\u30ED\u30D1\u30C6\u30A3\u30A2\u30AF\u30BB\u30B9\u306F\u8FFD\u8DE1\u3055\u308C\u306A\u3044\uFF09\u3002this["${sp}"] \u3067\u8AAD\u3093\u3067\u304F\u3060\u3055\u3044`,
  handlerFilterNotAllowed: (prop) => `\u30A4\u30D9\u30F3\u30C8\u30CF\u30F3\u30C9\u30E9 "${prop}" \u306B\u30D5\u30A3\u30EB\u30BF\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  typeExpectation: (label, expected, resultType) => `"${label}" \u306B\u306F${JA_EXPECTED_LABEL[expected]}\u304C\u5FC5\u8981\u3067\u3059\uFF08\u73FE\u5728\u306E\u578B: ${resultType}\uFF09`,
  filterUnknown: (n) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306F\u7D44\u307F\u8FBC\u307F\u30D5\u30A3\u30EB\u30BF\u306B\u5B58\u5728\u3057\u307E\u305B\u3093`,
  filterMinArgs: (n, min, c) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306B\u306F\u6700\u4F4E ${min} \u500B\u306E\u5F15\u6570\u304C\u5FC5\u8981\u3067\u3059\uFF08${c} \u500B\u6307\u5B9A\uFF09`,
  filterMaxArgs: (n, max, c) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306E\u5F15\u6570\u306F\u6700\u5927 ${max} \u500B\u3067\u3059\uFF08${c} \u500B\u6307\u5B9A\uFF09`,
  filterArgType: (n, i, exp, arg, act) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306E\u7B2C${i}\u5F15\u6570\u306F ${exp} \u578B\u304C\u5FC5\u8981\u3067\u3059\uFF08"${arg}" \u306F ${act} \u578B\uFF09`,
  filterInputType: (n, accepts, cur) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306F ${accepts} \u578B\u306E\u5165\u529B\u304C\u5FC5\u8981\u3067\u3059\uFF08\u73FE\u5728\u306E\u578B: ${cur}\uFF09`,
  wcsTextInfo: (e) => `wcs-text \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0: ${e}`,
  moustacheFouc: (e) => `<template> \u5916\u306E {{ }} \u69CB\u6587\u306F FOUC\uFF08\u521D\u671F\u8868\u793A\u6642\u306B\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u6587\u5B57\u5217\u304C\u898B\u3048\u308B\uFF09\u306E\u539F\u56E0\u306B\u306A\u308A\u307E\u3059\u3002<!--@@:${e}--> \u307E\u305F\u306F\u30B3\u30E1\u30F3\u30C8\u69CB\u6587\u306E\u4F7F\u7528\u3092\u691C\u8A0E\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,
  nestedAssign: (sp) => `\u30CD\u30B9\u30C8\u3055\u308C\u305F\u30D7\u30ED\u30D1\u30C6\u30A3\u3078\u306E\u4EE3\u5165\u306F\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u66F4\u65B0\u3092\u30C8\u30EA\u30AC\u30FC\u3057\u307E\u305B\u3093\u3002this["${sp}"] \u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,
  watchNotObject: () => `$watch \u306F\u300C\u30D1\u30B9 \u2192 \u30CF\u30F3\u30C9\u30E9\u95A2\u6570\u300D\u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08\u3053\u306E\u5F62\u306F\u30E9\u30F3\u30BF\u30A4\u30E0\u304C\u8AAD\u307F\u8FBC\u307F\u6642\u306B throw \u3057\u307E\u3059\uFF09`,
  watchKeyCrossState: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306F\u4ED6\u306E state \u3092\u6307\u3057\u3066\u3044\u307E\u3059\u3002@ \u4ED8\u304D\u306E\u8D8A\u5883 watch \u306F\u4F7F\u3048\u307E\u305B\u3093\uFF08\u81EA state \u306E\u30D1\u30B9\u306E\u307F\uFF09`,
  watchKeyReserved: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306F "$" \u3067\u59CB\u3081\u3089\u308C\u307E\u305B\u3093\uFF08\u4E88\u7D04\u540D\u524D\u7A7A\u9593\uFF09`,
  watchKeyEmptySegment: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306B\u7A7A\u306E\u30D1\u30B9\u30BB\u30B0\u30E1\u30F3\u30C8\u304C\u3042\u308A\u307E\u3059`,
  watchHandlerNotFunction: (k) => `$watch \u306E\u30A8\u30F3\u30C8\u30EA "${k}" \u306E\u5024\u306F\u95A2\u6570\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`,
  watchPathMissing: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306F\u72B6\u614B\u5B9A\u7FA9\u306B\u5B58\u5728\u3057\u307E\u305B\u3093\uFF08\u4E00\u5EA6\u3082\u767A\u706B\u3057\u307E\u305B\u3093\uFF09`,
  typeAnnotationIncompatible: (vt, rt) => `\u578B "${vt}" \u306F @type {${rt}} \u3068\u4E92\u63DB\u6027\u304C\u3042\u308A\u307E\u305B\u3093`,
  arrayMutation: (m, alt) => `\u914D\u5217\u306E\u7834\u58CA\u7684\u30E1\u30BD\u30C3\u30C9 "${m}" \u306F\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u66F4\u65B0\u3092\u30C8\u30EA\u30AC\u30FC\u3057\u307E\u305B\u3093\uFF08\u540C\u4E00\u53C2\u7167\u306E\u81EA\u5DF1\u518D\u4EE3\u5165\u3067\u3082\u8981\u7D20\u306E\u8FFD\u52A0\u30FB\u524A\u9664\u306F\u53CD\u6620\u3055\u308C\u307E\u305B\u3093\uFF09\u3002\u975E\u7834\u58CA\u30E1\u30BD\u30C3\u30C9\u3068\u518D\u4EE3\u5165\u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u4F8B: ${alt}\uFF09\u3002`,
  arrayIndexAssign: (sp) => `\u914D\u5217\u30A4\u30F3\u30C7\u30C3\u30AF\u30B9\u3078\u306E\u76F4\u63A5\u4EE3\u5165\u306F\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u66F4\u65B0\u3092\u30C8\u30EA\u30AC\u30FC\u3057\u307E\u305B\u3093\u3002this["${sp}"] \u306E\u3088\u3046\u306A\u30C9\u30C3\u30C8\u30D1\u30B9\u4EE3\u5165\u3001\u307E\u305F\u306F with() \u3068\u518D\u4EE3\u5165\u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,
  tagMemberUnknown: (prop, tag) => `"${prop}" \u306F <${tag}> \u306E wcBindable \u30E1\u30F3\u30D0\u30FC\u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u672A\u77E5\u30E1\u30F3\u30D0\u30FC\u3078\u306E\u30D0\u30A4\u30F3\u30C9\u306F\u9ED9\u3063\u3066\u7121\u8996\u3055\u308C\u307E\u3059\uFF09`,
  tagCommandUnknown: (name, tag, declared) => `"${name}" \u306F <${tag}> \u306E command \u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u5BA3\u8A00\u6E08\u307F: ${declared}\uFF09`,
  spreadNoBindable: (tag) => `'...'\uFF08spread\uFF09\u306F <${tag}> \u306B\u6709\u52B9\u306A wcBindable \u5BA3\u8A00\u304C\u5FC5\u8981\u3067\u3059 \u2014 \u3053\u306E\u30BF\u30B0\u306F\u5BA3\u8A00\u3092\u6301\u305F\u306A\u3044\u305F\u3081\u3001\u30E9\u30F3\u30BF\u30A4\u30E0\u306F\u30A8\u30E9\u30FC\u3092\u9001\u51FA\u3057\u307E\u3059`,
  tagEventTokenKeyUnknown: (name, tag, declared) => `eventToken \u306E\u30AD\u30FC "${name}" \u306F <${tag}> \u306E wcBindable \u30D7\u30ED\u30D1\u30C6\u30A3\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u751F DOM \u30A4\u30D9\u30F3\u30C8\u540D\u306F\u767A\u706B\u3057\u307E\u305B\u3093 \u2014 \u30D7\u30ED\u30D1\u30C6\u30A3\u540D\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5BA3\u8A00\u6E08\u307F: ${declared}\uFF09`,
  ariaAttrUnknown: (name) => `"${name}" \u306F WAI-ARIA \u306E\u5C5E\u6027\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002setAttribute \u306F\u305D\u306E\u307E\u307E\u66F8\u304D\u8FBC\u307F\u307E\u3059\u304C\u3001\u652F\u63F4\u6280\u8853\u306B\u306F\u9ED9\u3063\u3066\u7121\u8996\u3055\u308C\u307E\u3059`,
  didYouMean: (c) => `\u3002\u3082\u3057\u304B\u3057\u3066: "${c}"`,
  none: () => `\u306A\u3057`,
  triggerSeededTruthy: (path) => `trigger \u30D0\u30A4\u30F3\u30C9\u5148 "${path}" \u304C true \u3067\u30B7\u30FC\u30C9\u3055\u308C\u3066\u3044\u307E\u3059\u3002trigger \u306F\u30A8\u30C3\u30B8\u691C\u51FA\u306A\u3057\uFF08truthy \u66F8\u304D\u8FBC\u307F\u3067\u5373\u767A\u706B\u30FBmanual \u3082\u30D0\u30A4\u30D1\u30B9\uFF09\u306E\u305F\u3081\u3001\u30D0\u30A4\u30F3\u30C9\u6642\u306B\u5373\u767A\u706B\u3057\u307E\u3059\u3002false \u3067\u30B7\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044`,
  storageSeedClobber: (path, raw) => `<wcs-storage> \u306E value \u30D0\u30A4\u30F3\u30C9\u5148 "${path}" \u304C ${raw} \u3067\u30B7\u30FC\u30C9\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u521D\u671F\u66F8\u304D\u623B\u3057\u304C\u4FDD\u5B58\u5024\u3092\u4E0A\u66F8\u304D\u3057\u307E\u3059 \u2014 undefined \u3067\u30B7\u30FC\u30C9\uFF08\`${path}: undefined\`\uFF09\u3059\u308B\u304B manual \u3092\u4ED8\u3051\u3066\u304F\u3060\u3055\u3044`,
  devtoolsAfterState: () => `@wcstack/devtools/auto \u306F @wcstack/state/auto \u3088\u308A\u5148\u306B\u8AAD\u307F\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044\uFF08\u5F8C\u3060\u3068\u914D\u7DDA\u53F0\u5E33\u304C\u30E9\u30A4\u30D6\u3067 captured \u3055\u308C\u307E\u305B\u3093\uFF09`,
  baseHrefMissing: () => `@wcstack/router \u3092\u4F7F\u3046 SPA \u306B\u306F <head> \u5185\u306E <base href="/"> \u304C\u5FC5\u8981\u3067\u3059\uFF08\u7121\u3044\u3068\u30C7\u30A3\u30FC\u30D7\u30EA\u30F3\u30AF\u3067 basename \u304C\u8AA4\u5C0E\u51FA\u3055\u308C\u307E\u3059\uFF09`,
  signalsDualEntry: () => `@wcstack/signals \u3068 @wcstack/signals/dom \u304C\u540C\u4E00\u30DA\u30FC\u30B8\u304B\u3089 import \u3055\u308C\u3066\u3044\u307E\u3059\u3002CDN \u3067\u306F\u5404\u30A8\u30F3\u30C8\u30EA\u304C\u81EA\u5DF1\u5B8C\u7D50\u30D0\u30F3\u30C9\u30EB\u306E\u305F\u3081\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u30B3\u30A2\u304C\u4E8C\u91CD\u5316\u3057\u3001\u5883\u754C\u3067\u53CD\u5FDC\u304C\u58CA\u308C\u307E\u3059 \u2014 \u3059\u3079\u3066 /dom \u30A8\u30F3\u30C8\u30EA\u304B\u3089 import \u3057\u3066\u304F\u3060\u3055\u3044`,
  namedStateAttrDeprecated: (name) => `name \u5C5E\u6027\u306F v2 \u3067\u64A4\u53BB\u3055\u308C\u307E\u3057\u305F\uFF081 root 1 \u30C4\u30EA\u30FC\uFF09\u3002\u30EB\u30FC\u30C8\u30C4\u30EA\u30FC\u3078\u306E\u30DE\u30A6\u30F3\u30C8 <wcs-state mount="${name}"> \u306B\u7F6E\u304D\u63DB\u3048\u3001\u30D1\u30B9\u306F "${name}.<path>" \u3067\u53C2\u7167\u3057\u3066\u304F\u3060\u3055\u3044\uFF08docs/state-mount-design.md \xA79\uFF09`,
  namedStatePathDeprecated: (name) => name === "default" ? `"@default" \u30BB\u30EC\u30AF\u30BF\u306F v2 \u3067\u64A4\u53BB\u3055\u308C\u307E\u3057\u305F\u3002"@default" \u3092\u5916\u3057\u3066\u304F\u3060\u3055\u3044\uFF08docs/state-mount-design.md \xA79\uFF09` : `"@name" \u30BB\u30EC\u30AF\u30BF\u306F v2 \u3067\u64A4\u53BB\u3055\u308C\u307E\u3057\u305F\uFF081 root 1 \u30C4\u30EA\u30FC\uFF09\u3002\u30DE\u30A6\u30F3\u30C8\u3057\u305F\u30C4\u30EA\u30FC\u3092 "${name}.<path>" \u3067\u53C2\u7167\u3057\u3066\u304F\u3060\u3055\u3044\uFF08docs/state-mount-design.md \xA79\uFF09`,
  mountPathInvalid: (problem, mountPath) => {
    switch (problem) {
      case "empty":
        return `"mount" \u306B\u306F\u7A7A\u3067\u306A\u3044\u30C4\u30EA\u30FC\u30D1\u30B9\u304C\u5FC5\u8981\u3067\u3059\uFF08runtime: "mount" requires a non-empty tree path.\uFF09`;
      case "emptySegment":
        return `"mount" \u30D1\u30B9 "${mountPath}" \u306B\u7A7A\u306E\u30BB\u30B0\u30E1\u30F3\u30C8\u304C\u3042\u308A\u307E\u3059\uFF08runtime: has an empty segment.\uFF09`;
      case "wildcard":
        return `"mount" \u30D1\u30B9 "${mountPath}" \u306F\u9759\u7684\u3067\u306A\u3051\u308C\u3070\u306A\u308A\u307E\u305B\u3093 \u2014 \u30EF\u30A4\u30EB\u30C9\u30AB\u30FC\u30C9\u306F\u4F7F\u3048\u307E\u305B\u3093\uFF08runtime: must be static.\uFF09`;
      default:
        return `"mount" \u30D1\u30B9 "${mountPath}" \u306B\u4E88\u7D04\u6587\u5B57\uFF08$, #, @\uFF09\u306F\u4F7F\u3048\u307E\u305B\u3093\uFF08runtime: must not use reserved characters.\uFF09`;
    }
  },
  recursionUnsupported: (p, where) => {
    switch (where) {
      case "binding":
        return `"${p}" \u306E "**" \u306F data-wcs \u3067\u306F\u4F7F\u3048\u307E\u305B\u3093\u3002"**" \u306F $recursion \u5BA3\u8A00\u30FB\u518D\u5E30 getter \u306E\u30AD\u30FC\u30FB$getAll / $setAll \u306E\u30D1\u30B9\u5F15\u6570\u3060\u3051\u306E\u8A18\u53F7\u3067\u3059\uFF08\u30E9\u30F3\u30BF\u30A4\u30E0\u306F\u30D0\u30A4\u30F3\u30C9\u78BA\u7ACB\u6642\u306B throw \u3057\u307E\u3059\uFF09\u3002HTML \u3067\u306F\u5C55\u958B\u5F8C\u306E\u5177\u4F53\u30D1\u30B9\u3092\u66F8\u3044\u3066\u304F\u3060\u3055\u3044`;
      case "watch":
        return `$watch \u306E\u30AD\u30FC "${p}" \u306B "**" \u306F\u4F7F\u3048\u307E\u305B\u3093\u3002\u76E3\u8996\u306F\u5177\u4F53\u30D1\u30B9\uFF08\u56FA\u5B9A\u672C\u6570\u306E "*"\uFF09\u306B\u5BFE\u3057\u3066\u306E\u307F\u6210\u7ACB\u3057\u307E\u3059`;
      case "resolve":
        return `$resolve("${p}") \u306B "**" \u306F\u6E21\u305B\u307E\u305B\u3093\u3002$resolve \u306F\u5C55\u958B\u5F8C\u306E\u5177\u4F53\u30D1\u30B9\u3068\u6DFB\u5B57\u30BF\u30D7\u30EB\u306E\u53B3\u5BC6\u4E00\u81F4\u3060\u3051\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3059`;
      default:
        return `"${p}" \u306F "**" \u3092\u542B\u307F\u307E\u3059\u304C\u3001\u3053\u306E state \u306B\u306F $recursion \u5BA3\u8A00\u304C\u3042\u308A\u307E\u305B\u3093\u3002$recursion = { "<anchor>": "<repeat>" }\uFF08\u4F8B: { "nodes.*": "children.*" }\uFF09\u3092\u5BA3\u8A00\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5BA3\u8A00\u304C\u7121\u3044\u3068 "**" \u306E\u30AD\u30FC\u306F\u9ED9\u3063\u3066\u7121\u8996\u3055\u308C\u307E\u3059\uFF09`;
    }
  },
  recursionAnchorMismatch: (p, anchor) => `"${p}" \u306F\u5BA3\u8A00\u6E08\u307F\u306E\u518D\u5E30\u30A2\u30F3\u30AB\u30FC "${anchor}" \u3068\u5408\u81F4\u3057\u307E\u305B\u3093\uFF08\u521D\u7248\u306F state \u3054\u3068\u306B 1 \u3064\u306E\u81EA\u5DF1\u518D\u5E30\u306E\u307F\u30FB\u540C\u3058\u30D1\u30B9\u306B 2 \u3064\u76EE\u306E "**" \u306F\u7F6E\u3051\u307E\u305B\u3093\uFF09`,
  recursionGetAllForm: (p) => `$getAll("${p}", indexes) \u306E "**" \u306B\u975E\u7A7A\u306E\u63A5\u982D\u8F9E\u306F\u6E21\u305B\u307E\u305B\u3093\uFF08\u63A5\u982D\u8F9E\u306F\u3069\u306E\u6DF1\u3055\u306B\u9069\u7528\u3055\u308C\u308B\u304B\u3092\u8A00\u3048\u307E\u305B\u3093\uFF09\u3002\u6DFB\u5B57\u3092\u7701\u7565\u3059\u308B\u3068\u8A55\u4FA1\u4E2D\u306E\u518D\u5E30 getter \u306E\u6DF1\u3055\u3001[] \u3092\u6E21\u3059\u3068\u5168\u6DF1\u3055\u306B\u306A\u308A\u307E\u3059`,
  recursionSetAllForm: (p, problem) => {
    switch (problem) {
      case "prefix":
        return `$setAll("${p}", indexes, \u2026) \u306E "**" \u306B\u975E\u7A7A\u306E\u63A5\u982D\u8F9E\u306F\u6E21\u305B\u307E\u305B\u3093\uFF08\u63A5\u982D\u8F9E\u306F\u3069\u306E\u6DF1\u3055\u306B\u9069\u7528\u3055\u308C\u308B\u304B\u3092\u8A00\u3048\u307E\u305B\u3093\uFF09\u3002[] \u3092\u6E21\u3057\u3066\u5168\u6DF1\u3055\u3078\u30D6\u30ED\u30FC\u30C9\u30AD\u30E3\u30B9\u30C8\u3057\u3066\u304F\u3060\u3055\u3044`;
      case "noIndexes":
        return `$setAll("${p}", \u2026) \u306E "**" \u306B\u306F\u660E\u793A\u7684\u306A\u7A7A\u306E\u6DFB\u5B57\u914D\u5217 [] \u304C\u5FC5\u8981\u3067\u3059\uFF08\u66F8\u304D\u8FBC\u307F API \u306F\u6587\u8108\u3092\u53D6\u308A\u307E\u305B\u3093\uFF09`;
      case "mapper":
        return `$setAll("${p}", \u2026) \u306E "**" \u306F mapper \u3092\u53D6\u308C\u307E\u305B\u3093\uFF08\u6DFB\u5B57\u30BF\u30D7\u30EB\u306E\u672C\u6570\u304C\u6DF1\u3055\u3054\u3068\u306B\u5909\u308F\u308B\u305F\u3081\uFF09\u3002\u5B9A\u6570\u5024\u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044`;
      default:
        return `$setAll("${p}", \u2026) \u306E "**" \u306F { spread: true } \u3092\u53D6\u308C\u307E\u305B\u3093\uFF08\u5E73\u5766\u306A\u914D\u5217\u3092\u6728\u306B\u914D\u308B\u306B\u306F\u4F5C\u8005\u304C\u8D70\u67FB\u9806\u3092\u77E5\u308B\u5FC5\u8981\u304C\u3042\u308A\u3001\u5951\u7D04\u306B\u306A\u308A\u307E\u305B\u3093\uFF09`;
    }
  },
  recursionStructuralWrite: (p, target, repeatList) => target === "node" ? `$setAll("${p}") \u306F\u518D\u5E30\u306E\u69CB\u9020\u305D\u306E\u3082\u306E\uFF08\u30CE\u30FC\u30C9\uFF09\u3092\u66F8\u304D\u63DB\u3048\u307E\u3059\u3002\u521D\u7248\u306F\u8449\u306E\u30D7\u30ED\u30D1\u30C6\u30A3\u3078\u306E\u30D6\u30ED\u30FC\u30C9\u30AD\u30E3\u30B9\u30C8\u306E\u307F\u3067\u3059 \u2014 \u30CE\u30FC\u30C9\u3092\u7F6E\u304D\u63DB\u3048\u308B\u3068\u3053\u306E\u66F8\u304D\u8FBC\u307F\u306E\u305F\u3081\u306B\u78BA\u5B9A\u6E08\u307F\u306E\u5B50\u30A2\u30C9\u30EC\u30B9\u304C\u7121\u52B9\u306B\u306A\u308A\u307E\u3059` : target === "branch" ? `$setAll("${p}") \u306F\u518D\u5E30\u306E\u69CB\u9020\u305D\u306E\u3082\u306E\uFF08"${repeatList}" \u30EA\u30B9\u30C8\u3078\u81F3\u308B\u9014\u4E2D\u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\uFF09\u3092\u66F8\u304D\u63DB\u3048\u307E\u3059\u3002\u521D\u7248\u306F\u8449\u306E\u30D7\u30ED\u30D1\u30C6\u30A3\u3078\u306E\u30D6\u30ED\u30FC\u30C9\u30AD\u30E3\u30B9\u30C8\u306E\u307F\u3067\u3059 \u2014 \u7F6E\u304D\u63DB\u3048\u308B\u3068\u305D\u306E\u4E0B\u306E\u78BA\u5B9A\u6E08\u307F\u306E\u5B50\u30A2\u30C9\u30EC\u30B9\u304C\u7121\u52B9\u306B\u306A\u308A\u307E\u3059` : `$setAll("${p}") \u306F\u518D\u5E30\u306E\u69CB\u9020\u305D\u306E\u3082\u306E\uFF08"${repeatList}" \u30EA\u30B9\u30C8\uFF09\u3092\u66F8\u304D\u63DB\u3048\u307E\u3059\u3002\u521D\u7248\u306F\u8449\u306E\u30D7\u30ED\u30D1\u30C6\u30A3\u3078\u306E\u30D6\u30ED\u30FC\u30C9\u30AD\u30E3\u30B9\u30C8\u306E\u307F\u3067\u3059`,
  recursionReadonly: (p, getterPath) => `$setAll("${p}") \u306F\u518D\u5E30 getter "${getterPath}" \u306B\u66F8\u304D\u8FBC\u307F\u307E\u3059\uFF08setter \u306F\u521D\u7248\u3067\u306F\u6301\u3066\u307E\u305B\u3093\uFF09\u3002\u3053\u306E getter \u304C\u5C0E\u51FA\u5143\u306B\u3057\u3066\u3044\u308B\u5024\u306E\u5074\u3092\u66F8\u3044\u3066\u304F\u3060\u3055\u3044`,
  recursionNotObject: () => `$recursion \u306F\u300C\u30A2\u30F3\u30AB\u30FC \u2192 \u53CD\u5FA9\u30B5\u30D6\u30D1\u30B9\u300D\u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08\u4F8B: { "nodes.*": "children.*" }\u3002\u3053\u306E\u5F62\u306F\u30E9\u30F3\u30BF\u30A4\u30E0\u304C\u8AAD\u307F\u8FBC\u307F\u6642\u306B throw \u3057\u307E\u3059\uFF09`,
  recursionAnchorCount: (count) => count === 0 ? `$recursion \u306B\u306F\u30A2\u30F3\u30AB\u30FC\u304C\u3061\u3087\u3046\u3069 1 \u3064\u5FC5\u8981\u3067\u3059\uFF08\u7A7A\u306E\u5BA3\u8A00\u3067\u3059\uFF09` : `$recursion \u304C ${count} \u500B\u306E\u30A2\u30F3\u30AB\u30FC\u3092\u5BA3\u8A00\u3057\u3066\u3044\u307E\u3059\u3002\u521D\u7248\u306F state \u3054\u3068\u306B\u3061\u3087\u3046\u3069 1 \u3064\u306E\u81EA\u5DF1\u518D\u5E30\u306E\u307F\u5BFE\u5FDC\u3057\u307E\u3059`,
  recursionNodePathInvalid: (kind, path, problem) => {
    const subject = kind === "anchor" ? "$recursion \u306E\u30A2\u30F3\u30AB\u30FC" : "$recursion \u306E\u53CD\u5FA9\u30B5\u30D6\u30D1\u30B9";
    switch (problem) {
      case "empty":
        return `${subject}\u306F\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
      case "emptySegment":
        return `${subject} "${path}" \u306B\u7A7A\u306E\u30D1\u30B9\u30BB\u30B0\u30E1\u30F3\u30C8\u304C\u3042\u308A\u307E\u3059`;
      case "notElement":
        return `${subject} "${path}" \u306F\u30EA\u30B9\u30C8\u306E\u8981\u7D20\u3092\u6307\u3059\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059 \u2014 \u672B\u5C3E\u304C ".*" \u306E\u30D7\u30ED\u30D1\u30C6\u30A3\u30D1\u30B9\uFF08\u4F8B: "nodes.*"\uFF09\u306B\u3057\u3066\u304F\u3060\u3055\u3044`;
      case "reservedRoot":
        return `${subject} "${path}" \u306F "$" \u3067\u59CB\u3081\u3089\u308C\u307E\u305B\u3093\uFF08\u4E88\u7D04\u540D\u524D\u7A7A\u9593\uFF09`;
      case "reservedMount":
        return `${subject} "${path}" \u306B "#" \u306F\u4F7F\u3048\u307E\u305B\u3093\uFF08\u30DE\u30A6\u30F3\u30C8\u7528\u306E\u4E88\u7D04\u30BB\u30B0\u30E1\u30F3\u30C8\uFF09`;
      case "midWildcard":
        return `${subject} "${path}" \u306E "*" \u306F\u672B\u5C3E\u306B\u3061\u3087\u3046\u3069 1 \u3064\u3060\u3051\u7F6E\u3051\u307E\u3059\uFF08\u9014\u4E2D\u306E\u30EF\u30A4\u30EB\u30C9\u30AB\u30FC\u30C9\u306F\u521D\u7248\u3067\u306F\u672A\u5BFE\u5FDC\uFF09`;
      default:
        return `${subject} "${path}" \u306B "**" \u306F\u542B\u3081\u3089\u308C\u307E\u305B\u3093\uFF08"**" \u306B\u610F\u5473\u3092\u4E0E\u3048\u308B\u306E\u304C\u3053\u306E\u5BA3\u8A00\u305D\u306E\u3082\u306E\u3067\u3059\uFF09`;
    }
  },
  recursionRepeatNotString: (anchor) => `$recursion \u306E\u30A8\u30F3\u30C8\u30EA "${anchor}" \u306E\u5024\u306F\u53CD\u5FA9\u30B5\u30D6\u30D1\u30B9\u306E\u6587\u5B57\u5217\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08\u4F8B: "children.*"\uFF09`,
  recursionGetterInvalid: (key, problem, anchor) => {
    switch (problem) {
      case "setter":
        return `\u518D\u5E30 setter \u306F\u521D\u7248\u3067\u306F\u672A\u5BFE\u5FDC\u3067\u3059: "${key}"\u3002\u901A\u5E38\u306E\u30D1\u30B9 setter \u3092\u5BA3\u8A00\u3059\u308B\u304B\u3001\u5177\u4F53\u30D1\u30B9\u7D4C\u7531\u3067\u66F8\u304D\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044`;
      case "notGetter":
        return `"${key}" \u306F "**" \u3092\u542B\u307F\u307E\u3059\u304C getter \u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002"**" \u306F\u8A08\u7B97\u30D1\u30B9\u306E\u65CF\u3092\u540D\u6307\u3059\u8A18\u53F7\u3067\u3059`;
      default:
        return `"${key}" \u306F\u518D\u5E30\u30CE\u30FC\u30C9\u81EA\u8EAB\u3092\u540D\u6307\u3057\u3066\u3044\u307E\u3059\u3002"**" \u306F\u30CE\u30FC\u30C9\u306E\u4E0B\u306E\u8A08\u7B97\u30D1\u30B9\uFF08\u4F8B: "${anchor}.total"\uFF09\u3092\u540D\u6307\u3059\u8A18\u53F7\u3067\u3001\u30CE\u30FC\u30C9\u305D\u306E\u3082\u306E\u3067\u306F\u3042\u308A\u307E\u305B\u3093`;
    }
  },
  recursionGetterCollision: (a, b, repeat) => `"${a}" \u3068 "${b}" \u306F\u7570\u306A\u308B\u6DF1\u3055\u3067\u540C\u3058\u5177\u4F53\u30D1\u30B9\u3078\u5C55\u958B\u3057\u307E\u3059\uFF08\u5DEE\u304C "${repeat}" \u306E\u6574\u6570\u56DE\u3076\u3093\u3067\u3059\uFF09\u3002\u3069\u3061\u3089\u304B\u306E\u540D\u524D\u3092\u5909\u3048\u3066\u304F\u3060\u3055\u3044`
};
var EN_EXPECTED_LABEL = {
  array: "an array-typed path",
  boolean: "a boolean",
  string: "a string"
};
var en = {
  spreadFilterNotAllowed: () => `Filters cannot be applied to a spread target`,
  spreadTargetRequired: () => `Spread requires a target path`,
  structuralMustBeSingle: (d) => `'${d}' must be the only binding in this attribute (it cannot be combined with ';'; the runtime throws at load time)`,
  eventTokenUndeclared: (t) => `Event token "${t}" is not declared in $eventTokens`,
  commandRhsFormat: () => `The right side of a command binding must be $command.<name> (declared in $commandTokens)`,
  commandTokenUndeclared: (t) => `Command token "${t}" is not declared in $commandTokens`,
  streamPathMissing: (p) => `Path "${p}" does not exist in the $streams declaration`,
  pathMissing: (p) => `Path "${p}" does not exist in the state definition`,
  pathNonexistent: (p) => `Path "${p}" does not exist in the declared stateSchema`,
  pathTypeMismatch: (p, label, expected, actual) => `Path "${p}" is ${actual} in the stateSchema, but ${label} requires ${expected === "array" ? "an array" : expected === "boolean" ? "a boolean" : "a string"}`,
  expansionSuffix: (x) => ` (expanded: ${x})`,
  patternPathOutsideFor: (p) => `Pattern path "${p}" cannot be used outside a <template for>`,
  omittedPathOutsideFor: (p) => `Shorthand path "${p}" cannot be used outside a <template for>`,
  loopIndexOutsideFor: (p) => `Loop index "${p}" cannot be used outside a <template for>`,
  resolvedPathInUi: (p) => `Resolved path "${p}" cannot be used in a UI binding. Use a pattern path instead`,
  indexArity: (api, p, req, wc, actual) => `${api}("${p}") requires ${req === "exact" ? "exactly" : "at most"} ${wc} index(es) ("*" appears ${wc} time(s) in the path) but got ${actual}`,
  wildcardRank: (subject, needed, available) => `${subject} needs ${needed} enclosing loop level(s) but the current scope provides ${available}`,
  getterCycle: (cycle) => `Path getters form a dependency cycle: ${cycle}`,
  updatedCallbackUnbound: (p) => `$updatedCallback is binding-driven. "${p}" is not bound anywhere in this document, so this branch never runs. Use $watch to react without depending on what is rendered`,
  getterUntrackedRead: (root, sp) => `Only "${root}" is tracked here: the getter is not re-evaluated when "${sp}" changes (plain property access after a path read is not tracked). Read this["${sp}"] instead`,
  handlerFilterNotAllowed: (prop) => `Filters cannot be applied to event handler "${prop}"`,
  typeExpectation: (label, expected, resultType) => `"${label}" requires ${EN_EXPECTED_LABEL[expected]} (current type: ${resultType})`,
  filterUnknown: (n) => `Filter "${n}" is not a built-in filter`,
  filterMinArgs: (n, min, c) => `Filter "${n}" requires at least ${min} argument(s) (${c} given)`,
  filterMaxArgs: (n, max, c) => `Filter "${n}" accepts at most ${max} argument(s) (${c} given)`,
  filterArgType: (n, i, exp, arg, act) => `Argument ${i} of filter "${n}" must be of type ${exp} ("${arg}" is ${act})`,
  filterInputType: (n, accepts, cur) => `Filter "${n}" requires input of type ${accepts} (current type: ${cur})`,
  wcsTextInfo: (e) => `wcs-text binding: ${e}`,
  moustacheFouc: (e) => `{{ }} outside a <template> causes FOUC (the raw template string is visible before binding). Consider the comment syntax <!--@@:${e}--> instead.`,
  nestedAssign: (sp) => `Assigning to a nested property does not trigger a reactive update. Use this["${sp}"] instead.`,
  watchNotObject: () => `$watch must be an object mapping state paths to handler functions (the runtime throws on this shape at load time)`,
  watchKeyCrossState: (k) => `$watch key "${k}" targets another state. Cross-state watching with @ is not supported (own paths only)`,
  watchKeyReserved: (k) => `$watch key "${k}" must not start with "$" (reserved namespace)`,
  watchKeyEmptySegment: (k) => `$watch key "${k}" has an empty path segment`,
  watchHandlerNotFunction: (k) => `The value of $watch entry "${k}" must be a function`,
  watchPathMissing: (k) => `$watch key "${k}" does not exist in the state definition (it will never fire)`,
  typeAnnotationIncompatible: (vt, rt) => `Type "${vt}" is not compatible with @type {${rt}}`,
  arrayMutation: (m, alt) => `Destructive array method "${m}" does not trigger a reactive update (re-assigning the same reference does not reflect added/removed elements either). Use a non-destructive method with reassignment (e.g. ${alt}).`,
  arrayIndexAssign: (sp) => `Assigning directly to an array index does not trigger a reactive update. Use a dot-path assignment like this["${sp}"], or with() plus reassignment.`,
  tagMemberUnknown: (prop, tag) => `"${prop}" is not a wcBindable member of <${tag}> (bindings to unknown members are silently ignored)`,
  tagCommandUnknown: (name, tag, declared) => `"${name}" is not a command of <${tag}> (declared: ${declared})`,
  spreadNoBindable: (tag) => `'...' (spread) requires <${tag}> to expose a valid wcBindable declaration \u2014 this tag declares none, so the runtime raises an error`,
  tagEventTokenKeyUnknown: (name, tag, declared) => `eventToken key "${name}" is not a wcBindable property of <${tag}>. Raw DOM event names never fire \u2014 use the property name (declared: ${declared})`,
  ariaAttrUnknown: (name) => `"${name}" is not a WAI-ARIA attribute. setAttribute writes it anyway, and assistive technology silently ignores it`,
  didYouMean: (c) => `. Did you mean "${c}"?`,
  none: () => `none`,
  triggerSeededTruthy: (path) => `The trigger-bound slot "${path}" is seeded with true. trigger has no edge detection (any truthy write fires, and it bypasses manual), so it fires immediately at bind. Seed it with false`,
  storageSeedClobber: (path, raw) => `The <wcs-storage> value-bound slot "${path}" is seeded with ${raw}. The initial write-back overwrites the persisted value \u2014 seed it with undefined (\`${path}: undefined\`) or add manual`,
  devtoolsAfterState: () => `Load @wcstack/devtools/auto BEFORE @wcstack/state/auto (otherwise the wiring ledger is not captured live)`,
  baseHrefMissing: () => `An SPA using @wcstack/router needs <base href="/"> in <head> (without it, deep links misderive the basename)`,
  signalsDualEntry: () => `Both @wcstack/signals and @wcstack/signals/dom are imported on this page. On a CDN each entry is a self-contained bundle, so the reactive core is duplicated and reactivity breaks at the seam \u2014 import everything from the single /dom entry`,
  namedStateAttrDeprecated: (name) => `The "name" attribute was removed in v2 \u2014 there is a single state tree per root. Mount this state onto the tree instead: <wcs-state mount="${name}"> and read it as "${name}.<path>" (docs/state-mount-design.md \xA79)`,
  namedStatePathDeprecated: (name) => name === "default" ? `The "@default" selector was removed in v2 \u2014 drop it (docs/state-mount-design.md \xA79)` : `The "@name" selector was removed in v2 \u2014 there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it as "${name}.<path>" (docs/state-mount-design.md \xA79)`,
  mountPathInvalid: (problem, mountPath) => {
    switch (problem) {
      case "empty":
        return `"mount" requires a non-empty tree path.`;
      case "emptySegment":
        return `"mount" path "${mountPath}" has an empty segment.`;
      case "wildcard":
        return `"mount" path "${mountPath}" must be static (wildcards are not allowed).`;
      default:
        return `"mount" path "${mountPath}" must not use reserved characters ($, #, @).`;
    }
  },
  recursionUnsupported: (p, where) => {
    switch (where) {
      case "binding":
        return `"**" in "${p}" cannot be used in data-wcs. "**" is only meaningful in a $recursion declaration, in a recursive getter key, and in the path argument of $getAll / $setAll (the runtime throws when the binding is established). Write the expanded concrete path in HTML instead`;
      case "watch":
        return `$watch key "${p}" cannot contain "**" \u2014 watching is defined against a concrete path (a fixed number of "*")`;
      case "resolve":
        return `$resolve("${p}") cannot take "**" \u2014 it accepts only an expanded concrete path with an exactly matching index tuple`;
      default:
        return `"${p}" contains "**" but this state declares no $recursion anchor. Declare $recursion = { "<anchor>": "<repeat>" } (for example { "nodes.*": "children.*" }) \u2014 without it a "**" key is silently ignored`;
    }
  },
  recursionAnchorMismatch: (p, anchor) => `"${p}" does not match the declared recursion anchor "${anchor}" (this version supports exactly one self-recursive anchor per state, and no second "**" in the same path)`,
  recursionGetAllForm: (p) => `$getAll("${p}", indexes) with "**" takes no partial prefix: a prefix cannot say which depth it applies to. Omit the indexes to read the depth of the recursive getter being evaluated, or pass [] to walk every depth`,
  recursionSetAllForm: (p, problem) => {
    switch (problem) {
      case "prefix":
        return `$setAll("${p}", indexes, \u2026) with "**" takes no partial prefix: a prefix cannot say which depth it applies to. Pass [] to broadcast to every depth`;
      case "noIndexes":
        return `$setAll("${p}", \u2026) with "**" requires an explicit empty indexes array ([]) \u2014 the write API takes no context`;
      case "mapper":
        return `$setAll("${p}", \u2026) with "**" does not take a mapper \u2014 the index tuple has a different length at each depth. Pass a constant value`;
      default:
        return `$setAll("${p}", \u2026) with "**" does not take { spread: true } \u2014 handing a flat array to a tree needs the author to know the walk order, which is not a usable contract`;
    }
  },
  recursionStructuralWrite: (p, target, repeatList) => target === "node" ? `$setAll("${p}") writes the recursion structure itself (a node). This version broadcasts to leaf properties only \u2014 replacing a node would invalidate the child addresses already resolved for this write` : target === "branch" ? `$setAll("${p}") writes the recursion structure itself (an object on the way to the "${repeatList}" list). This version broadcasts to leaf properties only \u2014 replacing it would invalidate the child addresses already resolved below it` : `$setAll("${p}") writes the recursion structure itself (the "${repeatList}" list). This version broadcasts to leaf properties only`,
  recursionReadonly: (p, getterPath) => `$setAll("${p}") writes into the recursive getter "${getterPath}", which has no setter in this version. Write the values it derives from instead`,
  recursionNotObject: () => `$recursion must be an object mapping one anchor path to its repeating sub-path (for example { "nodes.*": "children.*" }; the runtime throws at load time for this shape)`,
  recursionAnchorCount: (count) => count === 0 ? `$recursion must declare exactly one anchor; it is empty` : `$recursion declares ${count} anchors. This version supports exactly one self-recursive anchor per state`,
  recursionNodePathInvalid: (kind, path, problem) => {
    const subject = kind === "anchor" ? "$recursion anchor" : "$recursion repeating sub-path";
    switch (problem) {
      case "empty":
        return `${subject} must be a non-empty string`;
      case "emptySegment":
        return `${subject} "${path}" must not contain empty path segments`;
      case "notElement":
        return `${subject} "${path}" must name a list element: a property path ending with ".*" (for example "nodes.*")`;
      case "reservedRoot":
        return `${subject} "${path}" must not start with "$" \u2014 that namespace is reserved`;
      case "reservedMount":
        return `${subject} "${path}" must not contain "#" \u2014 that segment is reserved for mounts`;
      case "midWildcard":
        return `${subject} "${path}" must have exactly one "*", at the end (wildcards in the middle are not supported in this version)`;
      default:
        return `${subject} "${path}" must not contain "**" \u2014 the declaration is what gives "**" its meaning`;
    }
  },
  recursionRepeatNotString: (anchor) => `$recursion entry "${anchor}" must map to the repeating sub-path as a string (for example "children.*")`,
  recursionGetterInvalid: (key, problem, anchor) => {
    switch (problem) {
      case "setter":
        return `Recursive setters are not supported in this version: "${key}". Declare a plain path setter, or write through the concrete path`;
      case "notGetter":
        return `"${key}" contains "**" but is not a getter. The recursion wildcard only names a family of computed paths`;
      default:
        return `"${key}" names the recursive node itself. "**" names a computed path under a node (for example "${anchor}.total"), not the node`;
    }
  },
  recursionGetterCollision: (a, b, repeat) => `"${a}" and "${b}" expand to the same concrete path at different depths (they differ by whole repetitions of "${repeat}"). Rename one of them`
};
var CATALOGS = { ja, en };
function getMessages(locale3) {
  return CATALOGS[resolveLocale(locale3)];
}

// src/core/sidecar/schemaSubset.ts
var ALLOWED_SCHEMA_KEYWORDS = /* @__PURE__ */ new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "anyOf",
  "$defs",
  "$ref"
]);
var DiagnosticContext = class {
  constructor(spans) {
    this.spans = spans;
  }
  diagnostics = [];
  add(code, pointer2, message, severity, extra = {}, useKeySpan = false) {
    const span = this.spans.get(pointer2);
    const start = span === void 0 ? 0 : useKeySpan ? span.keyStart ?? span.start : span.start;
    const end = span === void 0 ? 0 : useKeySpan ? span.keyEnd ?? span.end : span.end;
    this.diagnostics.push({ code, start, end, message, severity, ...extra });
  }
};
function isSchemaObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isSchemaMap(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateSchemaSubset(schema, pointerBase, ctx, rootDefs) {
  walkKeywords(schema, pointerBase, ctx, rootDefs);
  const safe = /* @__PURE__ */ new Set();
  detectCycles(schema, pointerBase, ctx, rootDefs, /* @__PURE__ */ new Set(), safe);
  for (const [name, def] of Object.entries(rootDefs)) {
    detectCycles(def, `${pointerBase}/$defs/${escape(name)}`, ctx, rootDefs, /* @__PURE__ */ new Set(), safe);
  }
}
function walkKeywords(node, ptr, ctx, rootDefs) {
  if (!isSchemaObject(node)) return;
  for (const keyword of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(keyword)) {
      ctx.add(
        WcsDiagnosticCode.ManifestUnknownKeyword,
        `${ptr}/${escape(keyword)}`,
        `Unsupported schema keyword "${keyword}". Allowed: ${[...ALLOWED_SCHEMA_KEYWORDS].join(", ")}.`,
        "warning",
        {},
        true
      );
    }
  }
  if (typeof node.$ref === "string") {
    if (!node.$ref.startsWith("#/")) {
      ctx.add(
        WcsDiagnosticCode.ManifestExternalRef,
        `${ptr}/$ref`,
        `External $ref "${node.$ref}" is forbidden; only local "#/$defs/..." references are allowed.`,
        "error"
      );
    } else if (resolveLocalRef(node.$ref, rootDefs) === void 0) {
      ctx.add(
        WcsDiagnosticCode.ManifestRefUnresolved,
        `${ptr}/$ref`,
        `Unresolved local $ref "${node.$ref}".`,
        "error"
      );
    }
  }
  if (isSchemaMap(node.properties)) {
    for (const [name, child] of Object.entries(node.properties)) {
      walkKeywords(child, `${ptr}/properties/${escape(name)}`, ctx, rootDefs);
    }
  }
  if (node.items !== void 0 && isSchemaObject(node.items)) {
    walkKeywords(node.items, `${ptr}/items`, ctx, rootDefs);
  }
  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((child, i) => walkKeywords(child, `${ptr}/anyOf/${i}`, ctx, rootDefs));
  }
  if (isSchemaMap(node.$defs)) {
    for (const [name, child] of Object.entries(node.$defs)) {
      walkKeywords(child, `${ptr}/$defs/${escape(name)}`, ctx, rootDefs);
    }
  }
}
function detectCycles(node, ptr, ctx, rootDefs, refStack, safe) {
  if (!isSchemaObject(node)) return;
  if (typeof node.$ref === "string") {
    const ref2 = node.$ref;
    if (!ref2.startsWith("#/")) return;
    if (refStack.has(ref2)) {
      ctx.add(WcsDiagnosticCode.ManifestRefCycle, `${ptr}/$ref`, `Cyclic $ref detected at "${ref2}".`, "error");
      return;
    }
    if (safe.has(ref2)) return;
    const target = resolveLocalRef(ref2, rootDefs);
    if (target === void 0) return;
    refStack.add(ref2);
    detectCycles(target, ptr, ctx, rootDefs, refStack, safe);
    refStack.delete(ref2);
    safe.add(ref2);
    return;
  }
  if (isSchemaMap(node.properties)) {
    for (const child of Object.values(node.properties)) detectCycles(child, ptr, ctx, rootDefs, refStack, safe);
  }
  if (node.items !== void 0 && isSchemaObject(node.items)) {
    detectCycles(node.items, ptr, ctx, rootDefs, refStack, safe);
  }
  if (Array.isArray(node.anyOf)) {
    for (const child of node.anyOf) detectCycles(child, ptr, ctx, rootDefs, refStack, safe);
  }
}
function resolveLocalRef(ref2, rootDefs) {
  const match = /^#\/\$defs\/(.+)$/.exec(ref2);
  if (match === null) return void 0;
  const name = match[1].replace(/~1/g, "/").replace(/~0/g, "~");
  return rootDefs[name];
}
function resolveSchemaPath(root, rootDefs, segments) {
  let current2 = root;
  for (let depth = 0; depth < segments.length; depth++) {
    const segment = segments[depth];
    const resolved = derefUnion(current2, rootDefs);
    if (resolved.kind === "ref-error") return resolved;
    const candidates = resolved.nodes;
    if (segment === "*") {
      const items = firstDefined(candidates, (n) => isSchemaObject(n.items) ? n.items : void 0);
      if (items === void 0) {
        return { kind: "unknown" };
      }
      current2 = items;
      continue;
    }
    if (segment === "length" && candidates.some((n) => hasType(n, "array"))) {
      current2 = { type: "number" };
      continue;
    }
    const child = firstDefined(candidates, (n) => isSchemaMap(n.properties) ? n.properties[segment] : void 0);
    if (child !== void 0) {
      current2 = child;
      continue;
    }
    const anyObject = candidates.some((n) => hasType(n, "object") || isSchemaMap(n.properties));
    if (anyObject) {
      return { kind: "nonexistent", segment, depth };
    }
    return { kind: "unknown" };
  }
  const final = derefUnion(current2, rootDefs);
  if (final.kind === "ref-error") return final;
  return { kind: "resolved", schema: final.nodes.length === 1 ? final.nodes[0] : current2 };
}
function derefUnion(node, rootDefs) {
  const out = [];
  const stack = [{ node, chain: /* @__PURE__ */ new Set() }];
  while (stack.length > 0) {
    const { node: n, chain } = stack.pop();
    if (typeof n.$ref === "string") {
      if (!n.$ref.startsWith("#/") || chain.has(n.$ref)) {
        return { kind: "ref-error", ref: n.$ref };
      }
      const target = resolveLocalRef(n.$ref, rootDefs);
      if (target === void 0) return { kind: "ref-error", ref: n.$ref };
      stack.push({ node: target, chain: /* @__PURE__ */ new Set([...chain, n.$ref]) });
      continue;
    }
    if (Array.isArray(n.anyOf)) {
      for (const branch of n.anyOf) stack.push({ node: branch, chain });
      continue;
    }
    out.push(n);
  }
  return { kind: "ok", nodes: out };
}
function firstDefined(nodes, pick) {
  for (const n of nodes) {
    const v = pick(n);
    if (v !== void 0) return v;
  }
  return void 0;
}
function hasType(node, t) {
  const type = node.type;
  if (type === void 0) return false;
  return Array.isArray(type) ? type.includes(t) : type === t;
}
function escape(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// src/service/bindingValidator.ts
var filterMap = new Map(BUILTIN_FILTERS.map((f) => [f.name, f]));
function validateBindings(html, attrName, stateTagName = "wcs-state", locale3, fileReader, applicationSchema) {
  const diagnostics = [];
  const msgs = getMessages(locale3);
  const statePaths = mergeSchemaCandidates(getStatePathsFromHtml(html, stateTagName, fileReader), applicationSchema);
  const attrs = findAllBindAttributes(html, attrName);
  let structuralTemplates = null;
  const getStructuralTemplates = () => {
    structuralTemplates ??= collectStructuralTemplates(html, attrName);
    return structuralTemplates;
  };
  const filterNameSet = new Set(BUILTIN_FILTERS.map((f) => f.name));
  for (const attr of attrs) {
    const bindings = splitBindingExpressions(attr.value);
    const nonEmptyCount = bindings.filter((b) => b.trim().length > 0).length;
    if (nonEmptyCount > 1) {
      let scanPos = 0;
      for (const b of bindings) {
        const colon = b.indexOf(":");
        const prop = (colon === -1 ? b : b.slice(0, colon)).trim();
        if (STRUCTURAL_BINDING_TYPE_SET.has(prop)) {
          const leading = b.length - b.trimStart().length;
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: attr.valueStart + scanPos + leading,
            end: attr.valueStart + scanPos + b.trimEnd().length,
            message: msgs.structuralMustBeSingle(prop),
            severity: "error"
          });
        }
        scanPos += b.length + 1;
      }
    }
    let pos = 0;
    for (const binding of bindings) {
      const bindingStart = attr.valueStart + pos;
      const parsed = parseBindingExpression(binding);
      const scopedPaths = statePaths;
      const scopedPathSet = new Set(scopedPaths.map((p) => p.path));
      const propNoMod = parsed.property.replace(/#.*$/, "").trim();
      if (propNoMod === "...") {
        for (const filter of parsed.filters) {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart + filter.offset,
            end: bindingStart + filter.offset + filter.name.length,
            message: msgs.spreadFilterNotAllowed(),
            severity: "error"
          });
        }
        if (!parsed.path || parsed.path.trim() === "") {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart,
            end: bindingStart + binding.length,
            message: msgs.spreadTargetRequired(),
            severity: "error"
          });
        }
      }
      if (propNoMod.startsWith("eventToken.")) {
        const tokenNames = new Set(
          scopedPaths.filter((p) => p.kind === "eventToken").map((p) => p.path)
        );
        const tokenName = parsed.path?.trim() ?? "";
        if (tokenName && tokenNames.size > 0 && !tokenNames.has(tokenName)) {
          const pathOffset = binding.indexOf(parsed.path);
          const pathStart = bindingStart + pathOffset;
          diagnostics.push({
            code: WcsDiagnosticCode.TokenUndeclared,
            start: pathStart,
            end: pathStart + tokenName.length,
            message: msgs.eventTokenUndeclared(tokenName),
            severity: "warning"
          });
        }
        pos += binding.length + 1;
        continue;
      }
      const commandNames = new Set(
        scopedPaths.filter((p) => p.kind === "command").map((p) => p.path)
      );
      if (propNoMod.startsWith("command.")) {
        const tokenPath = parsed.path?.trim() ?? "";
        if (tokenPath) {
          const pathOffset = binding.indexOf(parsed.path);
          const pathStart = bindingStart + pathOffset;
          if (!tokenPath.startsWith("$command.")) {
            diagnostics.push({
              code: WcsDiagnosticCode.TokenMisconfigured,
              start: pathStart,
              end: pathStart + tokenPath.length,
              message: msgs.commandRhsFormat(),
              severity: "warning"
            });
          } else if (commandNames.size > 0 && !commandNames.has(tokenPath)) {
            diagnostics.push({
              code: WcsDiagnosticCode.TokenUndeclared,
              start: pathStart,
              end: pathStart + tokenPath.length,
              message: msgs.commandTokenUndeclared(tokenPath),
              severity: "warning"
            });
          }
        }
        pos += binding.length + 1;
        continue;
      }
      if (parsed.path && scopedPaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !isLiteral(pathTrimmed)) {
          let checkPath = pathTrimmed;
          if (pathTrimmed.startsWith(".")) {
            const forPath = getInnermostForPath(html, attr.valueStart, attrName);
            if (forPath && !forPath.startsWith(".")) {
              checkPath = pathTrimmed === "." ? `${forPath}.*` : `${forPath}.*.${pathTrimmed.slice(1)}`;
            } else {
              checkPath = "";
            }
          }
          if (checkPath) {
            const schema = applicationSchema;
            const verdict = hasRecursionWildcard(checkPath) ? {
              code: WcsDiagnosticCode.RecursionUnsupported,
              message: msgs.recursionUnsupported(checkPath, "binding"),
              severity: "error"
            } : schema !== void 0 ? validateSchemaPathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames, schema, msgs) : toMissingVerdict(validatePathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames, msgs));
            if (verdict) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              diagnostics.push({
                code: verdict.code,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: `${verdict.message}${pathTrimmed.startsWith(".") ? msgs.expansionSuffix(checkPath) : ""}`,
                severity: verdict.severity
              });
            }
          }
        }
      }
      if (parsed.path) {
        const pathTrimmed = parsed.path.trim();
        const prop = parsed.property.replace(/#.*$/, "");
        const insideFor = isInsideForTemplate(html, attr.valueStart, attrName);
        if (pathTrimmed && !prop.startsWith("on") && !hasRecursionWildcard(pathTrimmed)) {
          if (!insideFor && pathTrimmed.includes("*")) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.patternPathOutsideFor(pathTrimmed),
              severity: "warning"
            });
          }
          if (!insideFor && pathTrimmed.startsWith(".")) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.omittedPathOutsideFor(pathTrimmed),
              severity: "warning"
            });
          }
          if (!insideFor && /^\$\d+$/.test(pathTrimmed)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.loopIndexOutsideFor(pathTrimmed),
              severity: "warning"
            });
          }
          if (insideFor && !pathTrimmed.startsWith(".") && !binding.includes("@")) {
            const indexMatch = /^\$(\d+)$/.exec(pathTrimmed);
            const needed = indexMatch !== null ? Number(indexMatch[1]) : pathTrimmed.includes("*") ? countWildcardSegments(pathTrimmed) : 0;
            if (needed > 0) {
              const available = getAvailableWildcardRank(html, attr.valueStart, attrName);
              if (available > 0 && needed > available) {
                const pathOffset = binding.indexOf(parsed.path);
                const pathStart = bindingStart + pathOffset;
                diagnostics.push({
                  code: WcsDiagnosticCode.WildcardRank,
                  start: pathStart,
                  end: pathStart + pathTrimmed.length,
                  message: msgs.wildcardRank(`"${pathTrimmed}"`, needed, available),
                  severity: "warning"
                });
              }
            }
          }
          if (/\.\d+\.|\.\d+$/.test(pathTrimmed)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.resolvedPathInUi(pathTrimmed),
              severity: "warning"
            });
          }
        }
      }
      if (propNoMod === "...") {
      } else if (parsed.property.startsWith("on") && parsed.filters.length > 0) {
        for (const filter of parsed.filters) {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart + filter.offset,
            end: bindingStart + filter.offset + filter.name.length,
            message: msgs.handlerFilterNotAllowed(parsed.property),
            severity: "warning"
          });
        }
      } else {
        for (const filter of parsed.filters) {
          diagnostics.push(...validateFilterUsage(filter, bindingStart, msgs));
        }
        if (parsed.path && statePaths.length > 0) {
          const pathTrimmed = parsed.path.trim();
          if (pathTrimmed && !pathTrimmed.startsWith(".") && !isLiteral(pathTrimmed)) {
            const chainDiags = validateFilterChainTypes(
              pathTrimmed,
              parsed.filters,
              scopedPaths,
              bindingStart,
              msgs
            );
            diagnostics.push(...chainDiags);
          }
        }
      }
      for (const filter of parsed.inputFilters) {
        diagnostics.push(...validateFilterUsage(filter, bindingStart, msgs));
      }
      if (parsed.path && scopedPaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !pathTrimmed.startsWith(".") && !isLiteral(pathTrimmed)) {
          const resultType = resolveResultType(pathTrimmed, parsed.filters, scopedPaths);
          if (resultType !== null) {
            const typeReq = getExpectedType(
              parsed.property,
              () => isNegatedByElseChain(getStructuralTemplates(), attr.valueStart)
            );
            if (typeReq && resultType !== typeReq.expected) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              const schemaDefinite = typeReq.expected === "array" && parsed.filters.length === 0 && applicationSchema !== void 0 && scopedPaths.some((p) => p.path === pathTrimmed && p.fromSchema === true);
              diagnostics.push({
                code: schemaDefinite ? WcsDiagnosticCode.PathTypeMismatch : WcsDiagnosticCode.BindingTypeExpectation,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: schemaDefinite ? msgs.pathTypeMismatch(pathTrimmed, typeReq.label, typeReq.expected, resultType) : msgs.typeExpectation(typeReq.label, typeReq.expected, resultType),
                severity: schemaDefinite ? "error" : typeReq.severity
              });
            }
          }
        }
      }
      pos += binding.length + 1;
    }
  }
  return diagnostics;
}
function findAllBindAttributes(html, attrName) {
  const attrs = [];
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*(["'])`, "gi");
  let match;
  while ((match = regex.exec(html)) !== null) {
    const quote = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = html.indexOf(quote, valueStart);
    if (valueEnd === -1) continue;
    attrs.push({
      value: html.slice(valueStart, valueEnd),
      valueStart
    });
  }
  return attrs;
}
function splitBindingExpressions(value) {
  const result = [];
  let current2 = "";
  let parenDepth = 0;
  for (const ch of value) {
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === ";" && parenDepth === 0) {
      result.push(current2);
      current2 = "";
      continue;
    }
    current2 += ch;
  }
  result.push(current2);
  return result;
}
function parseBindingExpression(expr) {
  const colonIndex = expr.indexOf(":");
  if (colonIndex === -1) {
    return { property: expr.trim(), path: null, filters: [], inputFilters: [] };
  }
  const rawProp = expr.slice(0, colonIndex);
  const propSegments = splitByPipe(rawProp);
  const property = propSegments[0].trim();
  const inputFilters = parseFilterSegments(expr, propSegments.slice(1), propSegments[0].length + 1);
  const afterColon = expr.slice(colonIndex + 1);
  const segments = splitByPipe(afterColon);
  const pathSegment = segments[0] || "";
  const filterSegments = segments.slice(1);
  const atIndex = pathSegment.indexOf("@");
  const path = atIndex !== -1 ? pathSegment.slice(0, atIndex) : pathSegment;
  const filters = parseFilterSegments(expr, filterSegments, colonIndex + 1 + pathSegment.length + 1);
  return { property, path: path.trim() || null, filters, inputFilters };
}
function parseFilterSegments(expr, segments, searchStart) {
  const filters = [];
  let filterSearchStart = searchStart;
  for (const seg of segments) {
    const trimmed = seg.trim();
    const filterMatch = trimmed.match(/^(\w+)(?:\(([^)]*)\))?/);
    if (filterMatch) {
      const nameOffset = expr.indexOf(trimmed, filterSearchStart);
      const args = filterMatch[2] !== void 0 ? filterMatch[2].split(",").map((a) => a.trim()).filter((a) => a !== "") : [];
      filters.push({
        name: filterMatch[1],
        offset: nameOffset >= 0 ? nameOffset : filterSearchStart,
        args,
        argsOffset: nameOffset >= 0 ? nameOffset + filterMatch[1].length : filterSearchStart
      });
    }
    filterSearchStart += seg.length + 1;
  }
  return filters;
}
function validateFilterUsage(filter, bindingStart, msgs) {
  const diagnostics = [];
  const info = filterMap.get(filter.name);
  if (!info) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterUnknown,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterUnknown(filter.name),
      severity: "warning"
    });
    return diagnostics;
  }
  const argCount = filter.args.length;
  if (argCount < info.minArgs) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterArity,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterMinArgs(filter.name, info.minArgs, argCount),
      severity: "error"
    });
  } else if (argCount > info.maxArgs) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterArity,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterMaxArgs(filter.name, info.maxArgs, argCount),
      severity: "error"
    });
  }
  if (info.argTypes && argCount > 0) {
    for (let i = 0; i < Math.min(argCount, info.argTypes.length); i++) {
      const expectedArgType = info.argTypes[i];
      if (expectedArgType === "any") continue;
      const actualArgType = inferArgType(filter.args[i]);
      if (actualArgType !== expectedArgType) {
        diagnostics.push({
          code: WcsDiagnosticCode.FilterArgType,
          start: bindingStart + filter.argsOffset,
          end: bindingStart + filter.argsOffset + filter.name.length,
          message: msgs.filterArgType(filter.name, i + 1, expectedArgType, filter.args[i], actualArgType),
          severity: "warning"
        });
      }
    }
  }
  return diagnostics;
}
function splitByPipe(value) {
  const result = [];
  let current2 = "";
  let parenDepth = 0;
  for (const ch of value) {
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "|" && parenDepth === 0) {
      result.push(current2);
      current2 = "";
      continue;
    }
    current2 += ch;
  }
  result.push(current2);
  return result;
}
function validatePathExistence(checkPath, displayPath, scopedPaths, scopedPathSet, commandNames, msgs) {
  if (/^\$\d+$/.test(checkPath)) return null;
  if (checkPath.startsWith("$command.")) {
    if (commandNames.size > 0 && !commandNames.has(checkPath)) {
      return msgs.commandTokenUndeclared(displayPath);
    }
    return null;
  }
  if (checkPath.startsWith("$streamStatus.") || checkPath.startsWith("$streamError.")) {
    const prefix = checkPath.startsWith("$streamStatus.") ? "$streamStatus." : "$streamError.";
    const hasNamespace = scopedPaths.some((p) => p.path.startsWith(prefix));
    if (hasNamespace && !scopedPathSet.has(checkPath)) {
      return msgs.streamPathMissing(displayPath);
    }
    return null;
  }
  if (!scopedPathSet.has(checkPath) && !matchesRecursionCandidates(scopedPaths, checkPath, scopedPathSet)) {
    return msgs.pathMissing(displayPath);
  }
  return null;
}
function matchesRecursionCandidates(scopedPaths, checkPath, scopedPathSet) {
  const specs = collectRecursionSpecs(scopedPaths);
  if (specs.length === 0) return false;
  return matchesRecursion(specs, checkPath, (candidate) => scopedPathSet.has(candidate));
}
function toMissingVerdict(message) {
  return message ? { code: WcsDiagnosticCode.BindingPathMissing, message, severity: "warning" } : null;
}
function validateSchemaPathExistence(checkPath, displayPath, scopedPaths, scopedPathSet, commandNames, schema, msgs) {
  if (checkPath.startsWith("$")) {
    return toMissingVerdict(validatePathExistence(checkPath, displayPath, scopedPaths, scopedPathSet, commandNames, msgs));
  }
  if (scopedPathSet.has(checkPath)) return null;
  if (matchesRecursionCandidates(scopedPaths, checkPath, scopedPathSet)) return null;
  const resolution = resolveSchemaPath(schema, schema.$defs ?? {}, checkPath.split("."));
  if (resolution.kind === "nonexistent") {
    return { code: WcsDiagnosticCode.PathNonexistent, message: msgs.pathNonexistent(displayPath), severity: "error" };
  }
  return null;
}
function collectStructuralTemplates(html, attrName) {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrRegex = new RegExp(`${escaped}\\s*=\\s*(["'])`, "i");
  const tagRegex = /<template(?:\s[^>]*)?>|<\/template\s*>/gi;
  const templates = [];
  let depth = 0;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const attrMatch = attrRegex.exec(match[0]);
    if (attrMatch) {
      const quote = attrMatch[1];
      const valueStart = match.index + attrMatch.index + attrMatch[0].length;
      const valueEnd = html.indexOf(quote, valueStart);
      if (valueEnd !== -1) {
        const first = splitBindingExpressions(html.slice(valueStart, valueEnd))[0] ?? "";
        const prop = first.split(":")[0].replace(/#.*$/, "").trim();
        const type = prop === "if" || prop === "elseif" || prop === "else" ? prop : "other";
        templates.push({ valueStart, depth, type });
      }
    }
    depth++;
  }
  return templates;
}
function isNegatedByElseChain(templates, valueStart) {
  const index = templates.findIndex((t) => t.valueStart === valueStart);
  if (index === -1) return false;
  const selfDepth = templates[index].depth;
  for (let i = index + 1; i < templates.length; i++) {
    const next = templates[i];
    if (next.depth > selfDepth) continue;
    if (next.depth < selfDepth) return false;
    if (next.type === "elseif" || next.type === "else") return true;
    if (next.type === "if") return false;
  }
  return false;
}
function getExpectedType(property, isNegatedIf) {
  const prop = property.replace(/#.*$/, "");
  if (prop === "for") {
    return { label: "for", expected: "array", severity: "error" };
  }
  if (prop === "if" || prop === "elseif") {
    if (!isNegatedIf()) return null;
    return { label: prop, expected: "boolean", severity: "warning" };
  }
  if (prop.startsWith("class.")) {
    return { label: prop, expected: "boolean", severity: "warning" };
  }
  if (prop.startsWith("attr.")) {
    return { label: prop, expected: "string", severity: "warning" };
  }
  if (prop.startsWith("style.")) {
    return { label: prop, expected: "string", severity: "warning" };
  }
  return null;
}
function validateFilterChainTypes(path, filters, statePaths, bindingStart, msgs) {
  const diagnostics = [];
  const pathInfo = statePaths.find((p) => p.path === path);
  if (!pathInfo?.typeHint) return diagnostics;
  let currentType = pathInfo.typeHint;
  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) break;
    if (info.acceptTypes !== "any") {
      const currentTypes = currentType.split("|");
      const hasMatch = currentTypes.some((t) => info.acceptTypes.includes(t));
      if (!hasMatch) {
        diagnostics.push({
          code: WcsDiagnosticCode.FilterInputType,
          start: bindingStart + filter.offset,
          end: bindingStart + filter.offset + filter.name.length,
          message: msgs.filterInputType(filter.name, info.acceptTypes.join("|"), currentType),
          severity: "warning"
        });
      }
    }
    if (info.resultType !== "passthrough") {
      currentType = info.resultType;
    }
  }
  return diagnostics;
}
function resolveResultType(path, filters, statePaths) {
  const pathInfo = statePaths.find((p) => p.path === path);
  if (!pathInfo?.typeHint) return null;
  let currentType = pathInfo.typeHint;
  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) return null;
    if (info.resultType === "passthrough") continue;
    currentType = info.resultType;
  }
  return currentType;
}
function inferArgType(arg) {
  const v = arg.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  return "string";
}
function isLiteral(value) {
  return /^-?\d/.test(value) || /^["'`]/.test(value) || value === "true" || value === "false" || value === "null";
}

// src/service/stateTypeValidator.ts
function validateStateTypes(html, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics = [];
  for (const block of blocks) {
    const props = findJsDocTypedProperties(block.content);
    for (const prop of props) {
      if (!isValueCompatible(prop.declaredTypes, prop.valueType)) {
        const absStart = block.contentStart + prop.valueOffset;
        const absEnd = absStart + prop.valueLength;
        diagnostics.push({
          start: absStart,
          end: absEnd,
          message: msgs.typeAnnotationIncompatible(prop.valueType, prop.rawType),
          severity: "warning"
        });
      }
    }
  }
  return diagnostics;
}
function findJsDocTypedProperties(script) {
  const results = [];
  const regex = /\/\*\*\s*@type\s*\{([^}]+)\}\s*\*\/\s*(?:"([^"]+)"|'([^']+)'|(\w+))\s*:\s*/g;
  let match;
  while ((match = regex.exec(script)) !== null) {
    const rawType = match[1].trim();
    const name = match[2] ?? match[3] ?? match[4];
    const valueStart = match.index + match[0].length;
    const valueText = extractValue(script, valueStart);
    const valueType = inferValueType(valueText);
    if (valueType) {
      const declaredTypes = rawType.split("|").map((t) => normalizeType(t.trim()));
      results.push({
        name,
        rawType,
        declaredTypes,
        valueType,
        valueOffset: valueStart,
        valueLength: valueText.length
      });
    }
  }
  return results;
}
function extractValue(script, start) {
  let depth = 0;
  let inString = null;
  let i = start;
  while (i < script.length) {
    const ch = script[i];
    if (inString) {
      if (ch === inString && script[i - 1] !== "\\") inString = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if ((ch === "," || ch === "\n") && depth === 0) {
      break;
    }
    i++;
  }
  return script.slice(start, i).trim();
}
function inferValueType(value) {
  const v = value.replace(/,\s*$/, "").trim();
  if (v === "null") return "null";
  if (v === "undefined") return "null";
  if (v === "true" || v === "false") return "boolean";
  if (/^-?\d+\.\d/.test(v)) return "number";
  if (/^-?\d/.test(v)) return "number";
  if (/^["'`]/.test(v)) return "string";
  if (v.startsWith("[")) return "array";
  if (v.startsWith("{")) return "object";
  return null;
}
function normalizeType(type) {
  const lower = type.toLowerCase();
  if (lower === "null" || lower === "undefined") return "null";
  if (lower === "string") return "string";
  if (lower === "number") return "number";
  if (lower === "boolean") return "boolean";
  if (lower.endsWith("[]") || lower.startsWith("array")) return "array";
  if (lower === "object") return "object";
  return type;
}
function isValueCompatible(declaredTypes, valueType) {
  return declaredTypes.includes(valueType);
}

// src/service/scriptPatterns.ts
var ID = String.raw`[\w$]+`;
var SUB = String.raw`\s*(?:\?\.)?\s*\[(?!\s*["'])[^\[\]]+\]`;
var DOT_SEG = String.raw`\s*\??\.\s*${ID}`;
var CHAIN = String.raw`(?:${DOT_SEG}|${SUB})*`;
var BRACKETS_ONLY = String.raw`(?:${SUB})+`;
var CHAIN_ONE_PLUS = String.raw`(?:${DOT_SEG}|${SUB})+`;
var ROOT_DOT = String.raw`\bthis\s*\??\.\s*(${ID})`;
var ROOT_BRACKET = String.raw`\bthis\s*(?:\?\.)?\s*\[\s*["']([^"']+)["']\s*\]`;
var ASSIGN_TAIL = String.raw`\s*(?:(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[+\-*/%&|^])?=(?!=)|\+\+|--)`;
var PRE_INCDEC = String.raw`(?:\+\+|--)\s*`;
function chainToDotted(chain) {
  const token = new RegExp(String.raw`\s*(?:\??\.\s*(${ID})|(?:\?\.)?\s*\[([^\[\]]+)\])`, "g");
  let out = "";
  let match;
  while ((match = token.exec(chain)) !== null) {
    if (match[1] !== void 0) {
      out += `.${match[1]}`;
    } else {
      const key = match[2].trim();
      out += /^\d+$/.test(key) ? `.${key}` : `.<${key}>`;
    }
  }
  return out;
}
function hasDotSegment(chain) {
  return /[.]/.test(chain.replace(/\s*(?:\?\.)?\s*\[[^\[\]]+\]/g, ""));
}
function isApiRoot(root) {
  return root.startsWith("$");
}

// src/service/nestedAssignValidator.ts
var NESTED_ASSIGN = new RegExp(`${ROOT_DOT}(${CHAIN_ONE_PLUS})${ASSIGN_TAIL}`, "g");
var PRE_NESTED_INCDEC = new RegExp(`${PRE_INCDEC}${ROOT_DOT}(${CHAIN_ONE_PLUS})`, "g");
function validateNestedAssigns(html, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics = [];
  for (const block of blocks) {
    findNestedAssigns(block.content, block.contentStart, msgs, diagnostics);
  }
  return diagnostics;
}
function findNestedAssigns(script, baseOffset, msgs, out) {
  for (const regex of [NESTED_ASSIGN, PRE_NESTED_INCDEC]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(script)) !== null) {
      const [full, topProp, chainPart] = match;
      if (isApiRoot(topProp)) continue;
      if (!hasDotSegment(chainPart)) continue;
      const suggestedPath = topProp + chainToDotted(chainPart);
      const start = baseOffset + match.index;
      out.push({
        start,
        end: start + full.length,
        message: msgs.nestedAssign(suggestedPath),
        severity: "error"
      });
    }
  }
}

// src/service/arrayMutationValidator.ts
var DESTRUCTIVE_METHODS = "push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin";
var ALTERNATIVES = {
  push: (a) => `${a} = ${a}.concat(item)`,
  unshift: (a) => `${a} = [item, ...${a}]`,
  pop: (a) => `${a} = ${a}.slice(0, -1)`,
  shift: (a) => `${a} = ${a}.slice(1)`,
  splice: (a) => `${a} = ${a}.toSpliced(...)`,
  sort: (a) => `${a} = ${a}.toSorted(...)`,
  reverse: (a) => `${a} = ${a}.toReversed()`,
  fill: (a) => `${a} = ${a}.map(...)`,
  copyWithin: (a) => `${a} = ${a}.map(...)`
};
var METHOD_TAIL = String.raw`\s*\??\.\s*(${DESTRUCTIVE_METHODS})(?=\s*\()`;
var DOT_ROOT_CALL = new RegExp(`${ROOT_DOT}(${CHAIN})${METHOD_TAIL}`, "g");
var BRACKET_ROOT_CALL = new RegExp(`${ROOT_BRACKET}(${CHAIN})${METHOD_TAIL}`, "g");
var DOT_INDEX_ASSIGN = new RegExp(`${ROOT_DOT}(${BRACKETS_ONLY})${ASSIGN_TAIL}`, "g");
var BRACKET_INDEX_ASSIGN = new RegExp(`${ROOT_BRACKET}(${BRACKETS_ONLY})${ASSIGN_TAIL}`, "g");
var PRE_DOT_INDEX = new RegExp(`${PRE_INCDEC}${ROOT_DOT}(${BRACKETS_ONLY})`, "g");
var PRE_BRACKET_INDEX = new RegExp(`${PRE_INCDEC}${ROOT_BRACKET}(${BRACKETS_ONLY})`, "g");
function toAccessor(path) {
  return /^[A-Za-z_]\w*$/.test(path) ? `this.${path}` : `this["${path}"]`;
}
function validateArrayMutations(html, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics = [];
  for (const block of blocks) {
    findDestructiveCalls(block.content, block.contentStart, msgs, diagnostics);
    findIndexAssigns(block.content, block.contentStart, msgs, diagnostics);
  }
  return diagnostics;
}
function findDestructiveCalls(script, baseOffset, msgs, out) {
  for (const regex of [DOT_ROOT_CALL, BRACKET_ROOT_CALL]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(script)) !== null) {
      const [full, root, chain, method] = match;
      if (isApiRoot(root)) continue;
      const statePath = root + chainToDotted(chain);
      const start = baseOffset + match.index;
      out.push({
        code: WcsDiagnosticCode.ArrayMutation,
        start,
        end: start + full.length,
        message: msgs.arrayMutation(method, ALTERNATIVES[method](toAccessor(statePath))),
        severity: "error",
        statePath
      });
    }
  }
}
function findIndexAssigns(script, baseOffset, msgs, out) {
  for (const regex of [DOT_INDEX_ASSIGN, BRACKET_INDEX_ASSIGN, PRE_DOT_INDEX, PRE_BRACKET_INDEX]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(script)) !== null) {
      const [full, root, chain] = match;
      if (isApiRoot(root)) continue;
      const suggestedPath = root + chainToDotted(chain);
      const start = baseOffset + match.index;
      out.push({
        code: WcsDiagnosticCode.ArrayIndexAssign,
        start,
        end: start + full.length,
        message: msgs.arrayIndexAssign(suggestedPath),
        severity: "error",
        statePath: suggestedPath
      });
    }
  }
}

// src/service/templateSyntax.ts
function findAllMustacheSyntax(html) {
  const results = [];
  const regex = /\{\{\s*(.+?)\s*\}\}/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (isInsideTag(html, match.index, "script") || isInsideTag(html, match.index, "style")) {
      continue;
    }
    const expr = match[1];
    const exprStart = match.index + match[0].indexOf(expr);
    results.push({
      kind: "mustache",
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: isInsideTag(html, match.index, "template")
    });
  }
  return results;
}
function findAllCommentBindings(html, commentTextPrefix = "wcs-text") {
  const results = [];
  const escaped = commentTextPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<!--\\s*@@\\s*(?:${escaped})?\\s*:\\s*(.+?)\\s*-->`, "g");
  let match;
  while ((match = regex.exec(html)) !== null) {
    const expr = match[1];
    if (!expr) continue;
    const exprStart = match.index + match[0].indexOf(expr);
    results.push({
      kind: "comment",
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: isInsideTag(html, match.index, "template")
    });
  }
  return results;
}
function isInsideTag(html, offset2, tagName) {
  const tagRegex = new RegExp(`<(/?)${tagName}[\\s>]`, "gi");
  let depth = 0;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > offset2) break;
    if (match[1]) {
      depth = Math.max(0, depth - 1);
    } else {
      depth++;
    }
  }
  return depth > 0;
}

// src/service/templateSyntaxValidator.ts
function validateTemplateSyntax(html, stateTagName, bindAttrName = "data-wcs", locale3, fileReader, applicationSchema) {
  const diagnostics = [];
  const msgs = getMessages(locale3);
  const allPaths = mergeSchemaCandidates(getStatePathsFromHtml(html, stateTagName, fileReader), applicationSchema);
  const defaultSchema = applicationSchema;
  const missingVerdict = (path, displayPath, pathSet2, scoped) => {
    if (hasRecursionWildcard(path)) {
      return {
        code: WcsDiagnosticCode.RecursionUnsupported,
        severity: "error",
        message: msgs.recursionUnsupported(path, "binding")
      };
    }
    if (isValidTemplatePath(path, pathSet2, scoped)) return null;
    if (defaultSchema !== void 0 && !path.startsWith("$")) {
      const resolution = resolveSchemaPath(defaultSchema, defaultSchema.$defs ?? {}, path.split("."));
      return resolution.kind === "nonexistent" ? { code: WcsDiagnosticCode.PathNonexistent, severity: "error", message: msgs.pathNonexistent(displayPath) } : null;
    }
    return { code: WcsDiagnosticCode.BindingPathMissing, severity: "warning", message: msgs.pathMissing(displayPath) };
  };
  if (allPaths.length === 0) return diagnostics;
  const defaultPaths = allPaths;
  const pathSet = new Set(defaultPaths.map((p) => p.path));
  const filterNameSet = new Set(BUILTIN_FILTERS.map((f) => f.name));
  const mustaches = findAllMustacheSyntax(html);
  const comments = findAllCommentBindings(html);
  for (const item of [...mustaches, ...comments]) {
    if (item.kind === "comment") {
      diagnostics.push({
        code: WcsDiagnosticCode.TemplateSyntax,
        start: item.matchStart,
        end: item.matchEnd,
        message: msgs.wcsTextInfo(item.expression),
        severity: "info"
      });
    }
    if (item.kind === "mustache" && !item.insideTemplate) {
      diagnostics.push({
        code: WcsDiagnosticCode.TemplateSyntax,
        start: item.matchStart,
        end: item.matchEnd,
        message: msgs.moustacheFouc(item.expression),
        severity: "info"
      });
    }
    if (!item.expression) continue;
    const parts = item.expression.split("|");
    const pathPart = (parts[0] || "").trim();
    if (pathPart.includes("@")) continue;
    const insideFor = item.insideTemplate && isInsideForTemplate(html, item.matchStart, bindAttrName);
    if (pathPart && !/^-?\d|^["'`]|^true$|^false$|^null$/.test(pathPart)) {
      if (!insideFor && pathPart.includes("*")) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.patternPathOutsideFor(pathPart),
          severity: "warning"
        });
      }
      if (!insideFor && pathPart.startsWith(".")) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.omittedPathOutsideFor(pathPart),
          severity: "warning"
        });
      }
      if (insideFor && !pathPart.startsWith(".")) {
        const indexMatch = /^\$(\d+)$/.exec(pathPart);
        const needed = indexMatch !== null ? Number(indexMatch[1]) : pathPart.includes("*") ? countWildcardSegments(pathPart) : 0;
        if (needed > 0) {
          const available = getAvailableWildcardRank(html, item.matchStart, bindAttrName);
          if (available > 0 && needed > available) {
            diagnostics.push({
              code: WcsDiagnosticCode.WildcardRank,
              start: item.exprStart,
              end: item.exprStart + pathPart.length,
              message: msgs.wildcardRank(`"${pathPart}"`, needed, available),
              severity: "warning"
            });
          }
        }
      }
      if (/\.\d+\.|\.\d+$/.test(pathPart)) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.resolvedPathInUi(pathPart),
          severity: "warning"
        });
      }
      if (pathPart.startsWith(".")) {
        const forPath = insideFor ? getInnermostForPath(html, item.matchStart, bindAttrName) : null;
        if (forPath && !forPath.startsWith(".")) {
          const expandedPath = pathPart === "." ? `${forPath}.*` : `${forPath}.*.${pathPart.slice(1)}`;
          const verdict = missingVerdict(expandedPath, pathPart, pathSet, defaultPaths);
          if (verdict) {
            diagnostics.push({
              code: verdict.code,
              start: item.exprStart,
              end: item.exprStart + pathPart.length,
              message: verdict.message + msgs.expansionSuffix(expandedPath),
              severity: verdict.severity
            });
          }
        }
      } else {
        const verdict = missingVerdict(pathPart, pathPart, pathSet, defaultPaths);
        if (verdict) {
          diagnostics.push({
            code: verdict.code,
            start: item.exprStart,
            end: item.exprStart + pathPart.length,
            message: verdict.message,
            severity: verdict.severity
          });
        }
      }
    }
    for (let i = 1; i < parts.length; i++) {
      const filterName = parts[i].trim().replace(/\(.*$/, "");
      if (filterName && !filterNameSet.has(filterName)) {
        const filterOffset = item.expression.indexOf(parts[i]);
        diagnostics.push({
          code: WcsDiagnosticCode.FilterUnknown,
          start: item.exprStart + filterOffset,
          end: item.exprStart + filterOffset + filterName.length,
          message: msgs.filterUnknown(filterName),
          severity: "warning"
        });
      }
    }
  }
  return diagnostics;
}
function isValidTemplatePath(path, pathSet, scopedPaths) {
  if (/^\$\d+$/.test(path)) return true;
  if (path.startsWith("$streamStatus.") || path.startsWith("$streamError.")) {
    const prefix = path.startsWith("$streamStatus.") ? "$streamStatus." : "$streamError.";
    const hasNamespace = scopedPaths.some((p) => p.path.startsWith(prefix));
    return !hasNamespace || pathSet.has(path);
  }
  return pathSet.has(path) || matchesRecursionCandidates(scopedPaths, path, pathSet);
}

// src/service/generated/builtinTags.generated.ts
var BUILTIN_TAGS = {
  "wcs-accelerometer": {
    "package": "accelerometer",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-ambient-light-sensor": {
    "package": "ambient-light-sensor",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "illuminance",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-audio": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "volume",
      "limiter",
      "resume-on-gesture"
    ],
    "inputs": {
      "volume": "volume",
      "limiter": "limiter",
      "resumeOnGesture": "resume-on-gesture"
    },
    "properties": [
      "state",
      "running",
      "suspended",
      "unsupported",
      "voices",
      "noteOn",
      "noteOff",
      "warnings",
      "error",
      "errorInfo"
    ],
    "commands": [
      "resume",
      "suspend",
      "noteOn",
      "noteOff",
      "allNotesOff"
    ]
  },
  "wcs-voice": {
    "package": "audio",
    "hasWcBindable": false,
    "observedAttributes": [
      "poly"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-osc": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "frequency",
      "detune",
      "type",
      "glide",
      "transpose",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "frequency": "frequency",
      "detune": "detune",
      "type": "type",
      "glide": "glide",
      "transpose": "transpose"
    },
    "properties": [],
    "commands": []
  },
  "wcs-noise": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-biquad": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "frequency",
      "q",
      "gain",
      "detune",
      "type",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "frequency": "frequency",
      "q": "q",
      "gain": "gain",
      "detune": "detune",
      "type": "type"
    },
    "properties": [],
    "commands": []
  },
  "wcs-gain": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "gain",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "gain": "gain"
    },
    "properties": [],
    "commands": []
  },
  "wcs-delay": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "time",
      "feedback",
      "mix",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "time": "time",
      "feedback": "feedback",
      "mix": "mix"
    },
    "properties": [],
    "commands": []
  },
  "wcs-shaper": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "amount",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "amount": "amount"
    },
    "properties": [],
    "commands": []
  },
  "wcs-env": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "attack",
      "decay",
      "sustain",
      "release",
      "depth",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "attack": "attack",
      "decay": "decay",
      "sustain": "sustain",
      "release": "release",
      "depth": "depth"
    },
    "properties": [],
    "commands": []
  },
  "wcs-lfo": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "rate",
      "depth",
      "type",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "rate": "rate",
      "depth": "depth",
      "type": "type"
    },
    "properties": [],
    "commands": []
  },
  "wcs-analyser": {
    "package": "audio",
    "hasWcBindable": true,
    "observedAttributes": [
      "fft",
      "smoothing",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "fft": "fft",
      "smoothing": "smoothing"
    },
    "properties": [
      "frame"
    ],
    "commands": [
      "sample"
    ]
  },
  "wcs-broadcast": {
    "package": "broadcast",
    "hasWcBindable": true,
    "observedAttributes": [
      "name"
    ],
    "inputs": {
      "name": "name",
      "manual": "manual"
    },
    "properties": [
      "message",
      "error",
      "errorInfo"
    ],
    "commands": [
      "open",
      "post",
      "close"
    ]
  },
  "wcs-camera": {
    "package": "camera",
    "hasWcBindable": true,
    "observedAttributes": [
      "facing-mode",
      "device-id",
      "audio",
      "width",
      "height"
    ],
    "inputs": {
      "audio": "audio",
      "facingMode": "facing-mode",
      "deviceId": "device-id",
      "width": "width",
      "height": "height",
      "autostart": "autostart",
      "keepAlive": "keep-alive"
    },
    "properties": [
      "active",
      "permission",
      "audioPermission",
      "deviceId",
      "devices",
      "error",
      "errorInfo",
      "streamReady",
      "ended"
    ],
    "commands": [
      "start",
      "stop",
      "switchCamera"
    ]
  },
  "wcs-recorder": {
    "package": "camera",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "mimeType": "mime-type",
      "timeslice": "timeslice",
      "audioBitsPerSecond": "audio-bits",
      "videoBitsPerSecond": "video-bits"
    },
    "properties": [
      "recording",
      "paused",
      "duration",
      "mimeType",
      "blob",
      "objectURL",
      "error",
      "errorInfo",
      "recorded",
      "dataavailable"
    ],
    "commands": [
      "attachStream",
      "start",
      "stop",
      "pause",
      "resume"
    ]
  },
  "wcs-clipboard": {
    "package": "clipboard",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "monitor": "monitor"
    },
    "properties": [
      "text",
      "items",
      "loading",
      "error",
      "readPermission",
      "writePermission",
      "monitoring",
      "errorInfo",
      "copied",
      "cut",
      "pasted"
    ],
    "commands": [
      "writeText",
      "write",
      "readText",
      "read",
      "startMonitor",
      "stopMonitor"
    ]
  },
  "wcs-contacts": {
    "package": "contacts",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "select"
    ]
  },
  "wcs-credential": {
    "package": "credential",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "get",
      "store"
    ]
  },
  "wcs-debounce": {
    "package": "debounce",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "source": null,
      "wait": "wait",
      "leading": null,
      "trailing": null,
      "maxWait": "max-wait"
    },
    "properties": [
      "value",
      "fired",
      "pending"
    ],
    "commands": [
      "trigger",
      "cancel",
      "flush"
    ]
  },
  "wcs-throttle": {
    "package": "debounce",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "source": null,
      "wait": "wait",
      "leading": null,
      "trailing": null,
      "maxWait": "max-wait"
    },
    "properties": [
      "value",
      "fired",
      "pending"
    ],
    "commands": [
      "trigger",
      "cancel",
      "flush"
    ]
  },
  "wcs-defined": {
    "package": "defined",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "tags": "tags",
      "mode": "mode",
      "timeout": "timeout"
    },
    "properties": [
      "defined",
      "pending",
      "missing",
      "count",
      "total",
      "error"
    ],
    "commands": []
  },
  "wcs-eyedropper": {
    "package": "eyedropper",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "open",
      "abort"
    ]
  },
  "wcs-fetch": {
    "package": "fetch",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": null,
      "method": null,
      "target": null,
      "manual": null,
      "body": null,
      "responseType": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "error",
      "status",
      "objectURL",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "fetch",
      "abort"
    ]
  },
  "wcs-fetch-header": {
    "package": "fetch",
    "hasWcBindable": false,
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-fetch-body": {
    "package": "fetch",
    "hasWcBindable": false,
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-infinite-scroll": {
    "package": "fetch",
    "hasWcBindable": false,
    "observedAttributes": [
      "target",
      "root",
      "root-margin",
      "threshold",
      "disabled"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-fullscreen": {
    "package": "fullscreen",
    "hasWcBindable": true,
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestFullscreen",
      "exitFullscreen"
    ]
  },
  "wcs-geo": {
    "package": "geolocation",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "highAccuracy": "high-accuracy",
      "timeout": "timeout",
      "maximumAge": "maximum-age",
      "watch": "watch",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "position",
      "latitude",
      "longitude",
      "accuracy",
      "coords",
      "timestamp",
      "watching",
      "loading",
      "error",
      "permission",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "getCurrentPosition",
      "watchPosition",
      "clearWatch"
    ]
  },
  "wcs-gyroscope": {
    "package": "gyroscope",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-idle": {
    "package": "idle",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "threshold": "threshold"
    },
    "properties": [
      "userState",
      "screenState",
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ]
  },
  "wcs-intersect": {
    "package": "intersection",
    "hasWcBindable": true,
    "observedAttributes": [
      "target",
      "root",
      "root-margin",
      "threshold"
    ],
    "inputs": {
      "target": "target",
      "root": "root",
      "rootMargin": "root-margin",
      "threshold": "threshold",
      "once": "once",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "entry",
      "intersecting",
      "ratio",
      "visible",
      "observing",
      "trigger"
    ],
    "commands": [
      "observe",
      "reobserve",
      "unobserve",
      "disconnect",
      "reset"
    ]
  },
  "wcs-magnetometer": {
    "package": "magnetometer",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-media-query": {
    "package": "media-query",
    "hasWcBindable": true,
    "observedAttributes": [
      "query"
    ],
    "inputs": {
      "query": "query"
    },
    "properties": [
      "matched",
      "media",
      "supported"
    ],
    "commands": []
  },
  "wcs-midi": {
    "package": "midi",
    "hasWcBindable": true,
    "observedAttributes": [
      "input",
      "output",
      "channel"
    ],
    "inputs": {
      "input": "input",
      "output": "output",
      "channel": "channel",
      "sysex": "sysex",
      "auto": "auto"
    },
    "properties": [
      "message",
      "type",
      "channel",
      "note",
      "velocity",
      "control",
      "value",
      "devices",
      "connected",
      "permission",
      "granted",
      "denied",
      "unsupported",
      "error",
      "errorInfo"
    ],
    "commands": [
      "request",
      "close",
      "send"
    ]
  },
  "wcs-network": {
    "package": "network",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "effectiveType",
      "downlink",
      "rtt",
      "saveData",
      "supported"
    ],
    "commands": []
  },
  "wcs-notify": {
    "package": "notification",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "notice": null,
      "mode": "mode",
      "body": "body",
      "icon": "icon",
      "badge": "badge",
      "tag": "tag",
      "lang": "lang",
      "dir": "dir",
      "requireInteraction": "require-interaction",
      "silent": "silent",
      "renotify": "renotify",
      "manual": "manual"
    },
    "properties": [
      "permission",
      "granted",
      "denied",
      "prompt",
      "unsupported",
      "error",
      "errorInfo",
      "clicked",
      "closed",
      "shown"
    ],
    "commands": [
      "request",
      "notify",
      "close",
      "closeAll"
    ]
  },
  "wcs-permission": {
    "package": "permission",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "name": "name",
      "userVisibleOnly": "user-visible-only",
      "sysex": "sysex"
    },
    "properties": [
      "state",
      "granted",
      "denied",
      "prompt",
      "unsupported"
    ],
    "commands": []
  },
  "wcs-pip": {
    "package": "picture-in-picture",
    "hasWcBindable": true,
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPictureInPicture",
      "exitPictureInPicture"
    ]
  },
  "wcs-pointer-lock": {
    "package": "pointer-lock",
    "hasWcBindable": true,
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPointerLock",
      "exitPointerLock"
    ]
  },
  "wcs-raf": {
    "package": "raf",
    "hasWcBindable": true,
    "observedAttributes": [
      "reduced-motion"
    ],
    "inputs": {
      "once": "once",
      "repeat": "repeat",
      "manual": "manual",
      "reducedMotion": "reduced-motion",
      "trigger": null
    },
    "properties": [
      "tick",
      "elapsed",
      "dt",
      "running",
      "suspended",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "reset",
      "pause",
      "resume"
    ]
  },
  "wcs-resize": {
    "package": "resize",
    "hasWcBindable": true,
    "observedAttributes": [
      "target",
      "box",
      "round"
    ],
    "inputs": {
      "target": "target",
      "box": "box",
      "round": "round",
      "once": "once",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "entry",
      "width",
      "height",
      "observing",
      "trigger"
    ],
    "commands": [
      "observe",
      "unobserve",
      "disconnect"
    ]
  },
  "wcs-screen-orientation": {
    "package": "screen-orientation",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "type",
      "angle",
      "portrait",
      "landscape",
      "error",
      "errorInfo"
    ],
    "commands": [
      "lock",
      "unlock"
    ]
  },
  "wcs-share": {
    "package": "share",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "share"
    ]
  },
  "wcs-speak": {
    "package": "speech",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "say": null,
      "rate": "rate",
      "pitch": "pitch",
      "volume": "volume",
      "voice": "voice",
      "lang": "lang",
      "manual": "manual"
    },
    "properties": [
      "voices",
      "speaking",
      "paused",
      "pending",
      "charIndex",
      "spokenWord",
      "error",
      "errorInfo",
      "unsupported"
    ],
    "commands": [
      "speak",
      "cancel",
      "pause",
      "resume"
    ]
  },
  "wcs-listen": {
    "package": "speech",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {
      "lang": "lang",
      "continuous": "continuous",
      "interim": "interim",
      "maxRestarts": "max-restarts",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "interimTranscript",
      "finalTranscript",
      "result",
      "listening",
      "permission",
      "error",
      "errorInfo",
      "unsupported",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "abort"
    ]
  },
  "wcs-sse": {
    "package": "sse",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": "url",
      "withCredentials": "with-credentials",
      "events": "events",
      "raw": "raw",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "message",
      "connected",
      "loading",
      "error",
      "errorInfo",
      "readyState",
      "trigger"
    ],
    "commands": [
      "connect",
      "close"
    ]
  },
  "wcs-storage": {
    "package": "storage",
    "hasWcBindable": true,
    "observedAttributes": [
      "key",
      "type"
    ],
    "inputs": {
      "key": null,
      "type": null,
      "value": null,
      "manual": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "error",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "load",
      "save",
      "remove"
    ]
  },
  "wcs-tilt": {
    "package": "tilt",
    "hasWcBindable": true,
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "alpha",
      "beta",
      "gamma",
      "absolute",
      "permissionState",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ]
  },
  "wcs-timer": {
    "package": "timer",
    "hasWcBindable": true,
    "observedAttributes": [
      "interval"
    ],
    "inputs": {
      "interval": "interval",
      "once": "once",
      "repeat": "repeat",
      "immediate": "immediate",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "tick",
      "elapsed",
      "running",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "reset",
      "pause",
      "resume"
    ]
  },
  "wcs-upload": {
    "package": "upload",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": null,
      "method": null,
      "fieldName": null,
      "multiple": null,
      "maxSize": null,
      "accept": null,
      "manual": null,
      "files": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "progress",
      "error",
      "status",
      "errorInfo",
      "trigger",
      "files"
    ],
    "commands": [
      "upload",
      "abort"
    ]
  },
  "wcs-view-transition": {
    "package": "view-transition",
    "hasWcBindable": true,
    "observedAttributes": [
      "mode",
      "naming",
      "naming-limit",
      "reduced-motion",
      "types",
      "disabled",
      "for"
    ],
    "inputs": {
      "disabled": "disabled",
      "mode": "mode",
      "naming": "naming",
      "namingLimit": "naming-limit",
      "reducedMotion": "reduced-motion",
      "types": "types",
      "participants": "for"
    },
    "properties": [
      "active",
      "error"
    ],
    "commands": [
      "skip"
    ]
  },
  "wcs-wakelock": {
    "package": "wakelock",
    "hasWcBindable": true,
    "observedAttributes": [
      "active",
      "type"
    ],
    "inputs": {
      "active": "active",
      "type": "type",
      "manual": "manual"
    },
    "properties": [
      "held",
      "error",
      "errorInfo"
    ],
    "commands": [
      "request",
      "release"
    ]
  },
  "wcs-ws": {
    "package": "websocket",
    "hasWcBindable": true,
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": "url",
      "protocols": "protocols",
      "autoReconnect": "auto-reconnect",
      "reconnectInterval": "reconnect-interval",
      "maxReconnects": "max-reconnects",
      "binaryType": "binary-type",
      "manual": "manual",
      "trigger": null,
      "send": null
    },
    "properties": [
      "message",
      "connected",
      "loading",
      "error",
      "errorInfo",
      "readyState",
      "trigger",
      "send"
    ],
    "commands": [
      "connect",
      "sendMessage",
      "close"
    ]
  },
  "wcs-worker": {
    "package": "worker",
    "hasWcBindable": true,
    "observedAttributes": [
      "src"
    ],
    "inputs": {
      "src": "src",
      "type": "type",
      "name": "name",
      "manual": "manual",
      "keepAlive": "keep-alive",
      "restartOnError": "restart-on-error",
      "maxRestarts": "max-restarts",
      "restartInterval": "restart-interval"
    },
    "properties": [
      "message",
      "error",
      "errorInfo",
      "running"
    ],
    "commands": [
      "start",
      "post",
      "terminate"
    ]
  }
};

// src/service/ioNodeValidator.ts
var DOM_COMMON_PROPERTIES = /* @__PURE__ */ new Set([
  "textContent",
  "innerHTML",
  "innerText",
  "hidden",
  "title",
  "id",
  "slot",
  "dir",
  "lang",
  "role",
  "tabIndex",
  "className"
]);
var STRUCTURAL_DIRECTIVES2 = /* @__PURE__ */ new Set(["for", "if", "elseif", "else"]);
var EMPTYISH_SEEDS = /* @__PURE__ */ new Set(["''", '""', "``", "null", "[]", "{}"]);
function validateIoNodes(html, bindAttribute = "data-wcs", stateTagName = "wcs-state", locale3, fileReader) {
  const diagnostics = [];
  const msgs = getMessages(locale3);
  const occurrences = findBuiltinTagOccurrences(html);
  if (occurrences.length === 0) return diagnostics;
  let statePaths = null;
  const getPaths = () => statePaths ??= getStatePathsFromHtml(html, stateTagName, fileReader);
  for (const occ of occurrences) {
    const contract = BUILTIN_TAGS[occ.tagName];
    const bindAttr = extractAttributeValue(occ.attrsText, bindAttribute);
    if (!bindAttr) continue;
    const valueStart = occ.attrsStart + bindAttr.valueOffsetInAttrs;
    if (!contract.hasWcBindable) {
      let spreadExprOffset = 0;
      for (const expr of splitBindingExpressions(bindAttr.value)) {
        const exprStart = valueStart + spreadExprOffset;
        spreadExprOffset += expr.length + 1;
        if (parseBindingExpression(expr).property !== "...") continue;
        const start = exprStart + expr.indexOf("...");
        diagnostics.push({
          code: WcsDiagnosticCode.SpreadNoBindable,
          start,
          end: start + 3,
          severity: "error",
          tag: occ.tagName,
          message: msgs.spreadNoBindable(occ.tagName)
        });
      }
      continue;
    }
    if (contract.properties.length === 0 && contract.commands.length === 0 && Object.keys(contract.inputs).length === 0) continue;
    const hasManual = hasBooleanAttribute(occ.attrsText, "manual");
    let exprOffset = 0;
    for (const expr of splitBindingExpressions(bindAttr.value)) {
      const exprStart = valueStart + exprOffset;
      exprOffset += expr.length + 1;
      const parsed = parseBindingExpression(expr);
      const property = parsed.property;
      if (!property) continue;
      const propIndex = expr.indexOf(property);
      const start = propIndex === -1 ? exprStart : exprStart + propIndex;
      const end = propIndex === -1 ? exprStart + expr.length : start + property.length;
      validateBindingAgainstContract(
        occ.tagName,
        contract,
        parsed,
        property,
        start,
        end,
        hasManual,
        getPaths,
        diagnostics,
        msgs
      );
    }
  }
  return diagnostics;
}
function validateBindingAgainstContract(tagName, contract, parsed, property, start, end, hasManual, getPaths, diagnostics, msgs) {
  const hashIndex = property.indexOf("#");
  const modifiers = hashIndex === -1 ? "" : property.slice(hashIndex + 1);
  property = hashIndex === -1 ? property : property.slice(0, hashIndex);
  if (property === "...") return;
  if (STRUCTURAL_DIRECTIVES2.has(property)) return;
  if (/^(class|style|attr)\./.test(property)) return;
  if (/^on\w/.test(property)) return;
  const inputNames = Object.keys(contract.inputs);
  if (property.startsWith("command.")) {
    const name = property.slice("command.".length);
    if (!contract.commands.includes(name)) {
      diagnostics.push({
        code: WcsDiagnosticCode.TagMemberUnknown,
        start,
        end,
        severity: "warning",
        tag: tagName,
        member: name,
        message: msgs.tagCommandUnknown(name, tagName, contract.commands.join(", ") || msgs.none()) + suggestion(name, contract.commands, msgs)
      });
    }
    return;
  }
  if (property.startsWith("eventToken.")) {
    const name = property.slice("eventToken.".length);
    if (!contract.properties.includes(name)) {
      diagnostics.push({
        code: WcsDiagnosticCode.TagMemberUnknown,
        start,
        end,
        severity: "warning",
        tag: tagName,
        member: name,
        message: msgs.tagEventTokenKeyUnknown(name, tagName, contract.properties.join(", ")) + suggestion(name, contract.properties, msgs)
      });
    }
    return;
  }
  if (!contract.properties.includes(property) && !(property in contract.inputs) && !DOM_COMMON_PROPERTIES.has(property)) {
    const members = [...contract.properties, ...inputNames];
    diagnostics.push({
      code: WcsDiagnosticCode.TagMemberUnknown,
      start,
      end,
      severity: "warning",
      tag: tagName,
      member: property,
      message: msgs.tagMemberUnknown(property, tagName) + suggestion(property, members, msgs)
    });
    return;
  }
  if (property === "trigger" && "trigger" in contract.inputs && parsed.path) {
    const cand = findDataSlot(getPaths(), parsed.path);
    if (cand?.rawInitial === "true") {
      diagnostics.push({
        code: WcsDiagnosticCode.TriggerSeededTruthy,
        start,
        end,
        severity: "warning",
        tag: tagName,
        statePath: parsed.path,
        message: msgs.triggerSeededTruthy(parsed.path)
      });
    }
  }
  if (tagName === "wcs-storage" && property === "value" && !hasManual && parsed.path && !/(?:^|,)init=(?:element|auto)\b/.test(modifiers)) {
    const cand = findDataSlot(getPaths(), parsed.path);
    if (cand?.rawInitial !== void 0 && EMPTYISH_SEEDS.has(normalizeSeed(cand.rawInitial))) {
      diagnostics.push({
        code: WcsDiagnosticCode.StorageSeedClobber,
        start,
        end,
        severity: "warning",
        tag: tagName,
        statePath: parsed.path,
        message: msgs.storageSeedClobber(parsed.path, cand.rawInitial)
      });
    }
  }
}
function findDataSlot(paths, path) {
  return paths.find((c) => c.kind === "data" && c.path === path);
}
function normalizeSeed(raw) {
  const compact = raw.replace(/\s+/g, "");
  return compact === "" ? raw : compact;
}
function suggestion(input, candidates, msgs) {
  let best = null;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = editDistance(input.toLowerCase(), c.toLowerCase(), bestDistance);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best !== null ? msgs.didYouMean(best) : "";
}
function editDistance(a, b, bound) {
  if (Math.abs(a.length - b.length) >= bound) return bound;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin >= bound) return bound;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return Math.min(prev[b.length], bound);
}
function findBuiltinTagOccurrences(html) {
  const out = [];
  const regex = /<(wcs-[a-z0-9-]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    if (!(tagName in BUILTIN_TAGS)) continue;
    out.push({
      tagName,
      tagStart: match.index,
      attrsText: match[2],
      attrsStart: match.index + 1 + match[1].length
    });
  }
  return out;
}
function extractAttributeValue(attrsText, attrName) {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])`, "i");
  const match = regex.exec(attrsText);
  if (!match) return null;
  const quote = match[1];
  const valueStart = match.index + match[0].length;
  const valueEnd = attrsText.indexOf(quote, valueStart);
  if (valueEnd === -1) return null;
  return { value: attrsText.slice(valueStart, valueEnd), valueOffsetInAttrs: valueStart };
}
function hasBooleanAttribute(attrsText, attrName) {
  return new RegExp(`(?:^|\\s)${attrName}(?:\\s|=|$)`, "i").test(attrsText);
}

// src/service/ariaValidator.ts
var ARIA_ATTRIBUTES = /* @__PURE__ */ new Set([
  // widget attributes
  "aria-autocomplete",
  "aria-checked",
  "aria-disabled",
  "aria-errormessage",
  "aria-expanded",
  "aria-haspopup",
  "aria-hidden",
  "aria-invalid",
  "aria-label",
  "aria-level",
  "aria-modal",
  "aria-multiline",
  "aria-multiselectable",
  "aria-orientation",
  "aria-placeholder",
  "aria-pressed",
  "aria-readonly",
  "aria-required",
  "aria-selected",
  "aria-sort",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
  // live region attributes
  "aria-busy",
  "aria-live",
  "aria-relevant",
  "aria-atomic",
  // drag-and-drop (deprecated in 1.1, still valid names)
  "aria-dropeffect",
  "aria-grabbed",
  // relationship attributes
  "aria-activedescendant",
  "aria-colcount",
  "aria-colindex",
  "aria-colindextext",
  "aria-colspan",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  "aria-posinset",
  "aria-rowcount",
  "aria-rowindex",
  "aria-rowindextext",
  "aria-rowspan",
  "aria-setsize",
  // global additions
  "aria-current",
  "aria-keyshortcuts",
  "aria-roledescription",
  // 1.3 additions with broad implementation
  "aria-braillelabel",
  "aria-brailleroledescription",
  "aria-description"
]);
function validateAriaAttributes(html, bindAttribute = "data-wcs", locale3) {
  const diagnostics = [];
  const msgs = getMessages(locale3);
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    let exprOffset = 0;
    for (const expr of splitBindingExpressions(attr.value)) {
      const exprStart = attr.valueStart + exprOffset;
      exprOffset += expr.length + 1;
      const property = parseBindingExpression(expr).property;
      if (!property) continue;
      const bare = property.split("#")[0];
      if (!bare.toLowerCase().startsWith("attr.aria-")) continue;
      const ariaName = bare.slice("attr.".length).toLowerCase();
      if (ARIA_ATTRIBUTES.has(ariaName)) continue;
      const propIndex = expr.indexOf(property);
      const start = propIndex === -1 ? exprStart : exprStart + propIndex;
      const end = propIndex === -1 ? exprStart + expr.length : start + property.length;
      diagnostics.push({
        code: WcsDiagnosticCode.AriaAttrUnknown,
        start,
        end,
        severity: "warning",
        member: ariaName,
        message: msgs.ariaAttrUnknown(ariaName) + suggestion(ariaName, [...ARIA_ATTRIBUTES], msgs)
      });
    }
  }
  return diagnostics;
}

// src/service/documentEnvValidator.ts
function validateDocumentEnv(html, locale3) {
  const diagnostics = [];
  const msgs = getMessages(locale3);
  const scanText = blankHtmlComments(html);
  const autos = findWcstackAutoScripts(scanText);
  const stateIndex = autos.findIndex((a) => a.pkg === "state");
  if (stateIndex !== -1) {
    for (const later of autos.slice(stateIndex + 1)) {
      if (later.pkg !== "devtools") continue;
      diagnostics.push({
        code: WcsDiagnosticCode.ScriptOrder,
        start: later.start,
        end: later.end,
        severity: "warning",
        message: msgs.devtoolsAfterState()
      });
    }
  }
  const router = autos.find((a) => a.pkg === "router");
  if (router && !/<base\b[^>]*\bhref\s*=/i.test(scanText)) {
    diagnostics.push({
      code: WcsDiagnosticCode.BaseHrefMissing,
      start: router.start,
      end: router.end,
      severity: "warning",
      message: msgs.baseHrefMissing()
    });
  }
  const refs = collectSignalsRefs(scanText);
  const dom = refs.find((r) => r.kind === "dom");
  const bare = refs.find((r) => r.kind === "bare");
  if (dom && bare) {
    const later = bare.start > dom.start ? bare : dom;
    diagnostics.push({
      code: WcsDiagnosticCode.SignalsDualEntry,
      start: later.start,
      end: later.end,
      severity: "error",
      message: msgs.signalsDualEntry()
    });
  }
  return diagnostics;
}
function findWcstackAutoScripts(html) {
  const out = [];
  const scriptRegex = /<script\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = extractSrc(match[0]);
    if (!src) continue;
    const pkgMatch = /@wcstack\/([a-z0-9-]+)\/auto\b/.exec(src.value);
    if (!pkgMatch) continue;
    out.push({
      pkg: pkgMatch[1],
      start: match.index + src.offsetInTag,
      end: match.index + src.offsetInTag + src.value.length
    });
  }
  return out;
}
function collectSignalsRefs(html) {
  const refs = [];
  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const openTag = html.slice(match.index, match.index + match[0].indexOf(">") + 1);
    const src = extractSrc(openTag);
    if (src) {
      const kind = classifySignalsSpecifier(src.value);
      if (kind) {
        refs.push({
          kind,
          start: match.index + src.offsetInTag,
          end: match.index + src.offsetInTag + src.value.length
        });
      }
      continue;
    }
    if (!/\btype\s*=\s*(["'])module\1/i.test(match[1])) continue;
    const bodyStart = match.index + match[0].indexOf(">") + 1;
    const body = blankJsComments(match[2]);
    const importRegex = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']*@wcstack\/signals[^"']*)\1/g;
    let im;
    while ((im = importRegex.exec(body)) !== null) {
      const kind = classifySignalsSpecifier(im[2]);
      if (!kind) continue;
      const specStart = bodyStart + im.index + im[0].indexOf(im[1]) + 1;
      refs.push({ kind, start: specStart, end: specStart + im[2].length });
    }
  }
  return refs;
}
function classifySignalsSpecifier(spec) {
  if (!spec.includes("@wcstack/signals")) return null;
  return /@wcstack\/signals\/dom\b/.test(spec) ? "dom" : "bare";
}
function extractSrc(openTag) {
  const srcMatch = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(openTag);
  if (!srcMatch) return null;
  return {
    value: srcMatch[2],
    offsetInTag: srcMatch.index + srcMatch[0].indexOf(srcMatch[1]) + 1
  };
}
function blankHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
}
function blankJsComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length)).replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

// src/service/watchDeclarationValidator.ts
var STATE_NAME_SEPARATOR = "@";
function validateWatchDeclarations(html, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const out = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    const nonObject = findNonObjectWatch(block.content);
    if (nonObject !== null) {
      out.push({
        code: WcsDiagnosticCode.WatchDeclarationInvalid,
        start: block.contentStart + nonObject.start,
        end: block.contentStart + nonObject.end,
        message: msgs.watchNotObject(),
        severity: "error"
      });
    }
    const entries = analyzeWatchEntries(block.content);
    if (entries.length === 0) continue;
    const paths = analyzeStatePaths(block.content);
    const pathSet = new Set(paths.map((p) => p.path));
    for (const entry of entries) {
      const diagnostic = validateEntry(entry, pathSet, paths, msgs);
      if (diagnostic === null) continue;
      out.push({
        code: diagnostic.code,
        start: block.contentStart + entry.start,
        end: block.contentStart + entry.end,
        message: diagnostic.message,
        severity: diagnostic.severity
      });
    }
  }
  return out;
}
function validateEntry(entry, pathSet, paths, msgs) {
  const { key } = entry;
  const invalid = (message) => ({ code: WcsDiagnosticCode.WatchDeclarationInvalid, message, severity: "error" });
  if (key.includes(STATE_NAME_SEPARATOR)) {
    return invalid(msgs.watchKeyCrossState(key));
  }
  if (key.startsWith("$")) {
    return invalid(msgs.watchKeyReserved(key));
  }
  if (key.split(".").some((segment) => segment.length === 0)) {
    return invalid(msgs.watchKeyEmptySegment(key));
  }
  if (hasRecursionWildcard(key)) {
    return {
      code: WcsDiagnosticCode.RecursionUnsupported,
      message: msgs.recursionUnsupported(key, "watch"),
      severity: "error"
    };
  }
  if (entry.definitelyNotFunction) {
    return invalid(msgs.watchHandlerNotFunction(key));
  }
  if (pathSet.size > 0 && !pathSet.has(key) && !matchesRecursion(collectRecursionSpecs(paths), key, (p) => pathSet.has(p))) {
    return {
      code: WcsDiagnosticCode.WatchPathMissing,
      message: msgs.watchPathMissing(key),
      severity: "warning"
    };
  }
  return null;
}

// src/service/scriptCallArgs.ts
var STRING_LITERAL = /^\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*$/;
function splitCallArgs(source, open) {
  const args = [];
  const starts = [];
  let depth = 0;
  let argStart = open;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" && depth === 0) {
      args.push(source.slice(argStart, i));
      starts.push(argStart);
      return { args, starts, end: i + 1 };
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      i++;
      continue;
    }
    if (ch === "," && depth === 0) {
      args.push(source.slice(argStart, i));
      starts.push(argStart);
      argStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  return null;
}
function literalString(arg) {
  const match = STRING_LITERAL.exec(arg);
  return match === null ? null : match[2];
}
function literalArrayLength(arg) {
  const trimmed = arg.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.trim().length === 0) return 0;
  if (/(^|[^.])\.\.\./.test(inner)) return null;
  const parts = splitCallArgs(`${inner})`, 0);
  if (parts === null) return null;
  return parts.args.filter((part) => part.trim().length > 0).length;
}
function blankComments(source) {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out[i] = " ";
        i++;
      }
      if (i < source.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}
function createApiCallRegex(apis) {
  return new RegExp(`\\.\\s*\\$(${apis.join("|")})\\s*\\(`, "g");
}

// src/service/recursionValidator.ts
var RECURSION_APIS = ["getAll", "setAll", "resolve"];
function validateRecursion(html, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const out = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    if (!hasRecursionWildcard(block.content) && block.content.indexOf("$recursion") === -1) continue;
    const declaration = analyzeRecursionDeclaration(block.content);
    const spec = validateDeclaration(declaration, block.contentStart, msgs, out);
    const getterSuffixes = validateRecursiveGetters(block.content, block.contentStart, spec, declaration, msgs, out);
    validateApiCalls(block.content, block.contentStart, spec, getterSuffixes, msgs, out);
  }
  return out;
}
function push(out, code, start, end, message, severity = "error") {
  out.push({ code, start, end, message, severity });
}
function validateDeclaration(declaration, offset2, msgs, out) {
  if (declaration === null) return null;
  const code = WcsDiagnosticCode.RecursionDeclarationInvalid;
  if (declaration.notObject) {
    push(out, code, offset2 + declaration.start, offset2 + declaration.end, msgs.recursionNotObject());
    return null;
  }
  if (declaration.entries.length !== 1) {
    if (!declaration.objectLiteral) return null;
    push(
      out,
      code,
      offset2 + declaration.start,
      offset2 + declaration.end,
      msgs.recursionAnchorCount(declaration.entries.length)
    );
    return null;
  }
  const entry = declaration.entries[0];
  const anchorProblem = checkNodePath(entry.anchor);
  if (anchorProblem !== null) {
    push(
      out,
      code,
      offset2 + entry.start,
      offset2 + entry.end,
      msgs.recursionNodePathInvalid("anchor", entry.anchor, anchorProblem)
    );
    return null;
  }
  if (entry.repeat === null) {
    push(
      out,
      code,
      offset2 + entry.valueStart,
      offset2 + entry.valueEnd,
      msgs.recursionRepeatNotString(entry.anchor)
    );
    return null;
  }
  const repeatProblem = checkNodePath(entry.repeat);
  if (repeatProblem !== null) {
    push(
      out,
      code,
      offset2 + entry.valueStart,
      offset2 + entry.valueEnd,
      msgs.recursionNodePathInvalid("repeat", entry.repeat, repeatProblem)
    );
    return null;
  }
  return makeRecursionSpec(entry.anchor, entry.repeat);
}
function validateRecursiveGetters(script, offset2, spec, declaration, msgs, out) {
  const seen = /* @__PURE__ */ new Set();
  const spans = analyzeDeclarationSpans(script).filter((s) => hasRecursionWildcard(s.name)).filter((s) => seen.has(s.name) ? false : (seen.add(s.name), true));
  if (spans.length === 0) return [];
  const setterNames = new Set(
    analyzeCallableBodies(script).filter((c) => c.accessor === "set").map((c) => c.name)
  );
  const suffixes = [];
  const accepted = [];
  for (const span of spans) {
    const start = offset2 + span.start;
    const end = offset2 + span.end;
    if (spec === null) {
      if (declaration === null) {
        push(
          out,
          WcsDiagnosticCode.RecursionUnsupported,
          start,
          end,
          msgs.recursionUnsupported(span.name, "undeclared"),
          "warning"
        );
      }
      continue;
    }
    if (span.kind !== "getter") {
      push(
        out,
        WcsDiagnosticCode.RecursionDeclarationInvalid,
        start,
        end,
        msgs.recursionGetterInvalid(span.name, "notGetter", spec.recursiveAnchor)
      );
      continue;
    }
    if (setterNames.has(span.name)) {
      push(
        out,
        WcsDiagnosticCode.RecursionDeclarationInvalid,
        start,
        end,
        msgs.recursionGetterInvalid(span.name, "setter", spec.recursiveAnchor)
      );
      continue;
    }
    const suffix = splitRecursivePath(spec, span.name);
    if (suffix === null) {
      push(
        out,
        WcsDiagnosticCode.RecursionAnchor,
        start,
        end,
        msgs.recursionAnchorMismatch(span.name, spec.recursiveAnchor)
      );
      continue;
    }
    if (suffix.length === 0) {
      push(
        out,
        WcsDiagnosticCode.RecursionDeclarationInvalid,
        start,
        end,
        msgs.recursionGetterInvalid(span.name, "nodeItself", spec.recursiveAnchor)
      );
      continue;
    }
    const collision = accepted.find((other) => sameFamily(spec, other.suffix, suffix));
    if (collision !== void 0) {
      push(
        out,
        WcsDiagnosticCode.RecursionDeclarationInvalid,
        start,
        end,
        msgs.recursionGetterCollision(collision.name, span.name, spec.repeat)
      );
      continue;
    }
    accepted.push({ name: span.name, suffix, start, end });
    suffixes.push(suffix);
  }
  return suffixes;
}
function validateApiCalls(script, offset2, spec, getterSuffixes, msgs, out) {
  const scan = blankComments(script);
  const regex = createApiCallRegex(RECURSION_APIS);
  let match;
  while ((match = regex.exec(scan)) !== null) {
    const api = `$${match[1]}`;
    const parsed = splitCallArgs(scan, match.index + match[0].length);
    if (parsed === null) continue;
    regex.lastIndex = parsed.end;
    if (parsed.args.length === 0) continue;
    const pathArg = parsed.args[0];
    const path = literalString(pathArg);
    if (path === null || !hasRecursionWildcard(path)) continue;
    const leading = pathArg.length - pathArg.trimStart().length;
    const start = offset2 + parsed.starts[0] + leading;
    const end = offset2 + parsed.starts[0] + pathArg.trimEnd().length;
    if (api === "$resolve") {
      push(out, WcsDiagnosticCode.RecursionUnsupported, start, end, msgs.recursionUnsupported(path, "resolve"));
      continue;
    }
    if (spec === null) {
      push(out, WcsDiagnosticCode.RecursionUnsupported, start, end, msgs.recursionUnsupported(path, "undeclared"));
      continue;
    }
    const suffix = splitRecursivePath(spec, path);
    if (suffix === null) {
      push(out, WcsDiagnosticCode.RecursionAnchor, start, end, msgs.recursionAnchorMismatch(path, spec.recursiveAnchor));
      continue;
    }
    if (api === "$getAll") {
      const indexes = parsed.args.length > 1 ? literalArrayLength(parsed.args[1]) : null;
      if (indexes !== null && indexes > 0) {
        push(out, WcsDiagnosticCode.RecursionGetAllForm, start, end, msgs.recursionGetAllForm(path));
      }
      continue;
    }
    validateSetAllForm(path, suffix, parsed.args, spec, getterSuffixes, start, end, msgs, out);
  }
}
function validateSetAllForm(path, suffix, args, spec, getterSuffixes, start, end, msgs, out) {
  const formCode = WcsDiagnosticCode.RecursionSetAllForm;
  const indexesArg = args.length > 1 ? args[1].trim() : "";
  if (args.length < 2 || indexesArg === "undefined" || indexesArg === "null") {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, "noIndexes"));
    return;
  }
  const indexes = literalArrayLength(args[1]);
  if (indexes !== null && indexes > 0) {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, "prefix"));
    return;
  }
  if (args.length > 2 && isFunctionLiteral(args[2])) {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, "mapper"));
    return;
  }
  if (args.length > 3 && /\bspread\s*:\s*true\b/.test(args[3])) {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, "spread"));
    return;
  }
  const structural = structuralWriteTarget(spec, suffix);
  if (structural !== null) {
    push(
      out,
      WcsDiagnosticCode.RecursionStructuralWrite,
      start,
      end,
      msgs.recursionStructuralWrite(path, structural, spec.repeatList)
    );
    return;
  }
  const conflicting = conflictingGetterSuffix(spec, getterSuffixes, suffix);
  if (conflicting !== null) {
    push(
      out,
      WcsDiagnosticCode.RecursionReadonly,
      start,
      end,
      msgs.recursionReadonly(path, spec.recursiveAnchor + conflicting)
    );
  }
}
function isFunctionLiteral(arg) {
  const trimmed = arg.trim();
  if (trimmed.length === 0) return false;
  return /^(?:async\s+)?function\b/.test(trimmed) || /^(?:async\s+)?\([^()]*\)\s*=>/.test(trimmed) || /^(?:async\s+)?[$\w]+\s*=>/.test(trimmed);
}

// src/service/namedStateValidator.ts
function findStateSelector(expr, embedded = false) {
  const colon = embedded ? -1 : expr.indexOf(":");
  const from = colon + 1;
  let depth = 0;
  let end = expr.length;
  for (let i = from; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "|" && depth === 0) {
      end = i;
      break;
    }
  }
  const at2 = expr.indexOf("@", from);
  if (at2 === -1 || at2 >= end) return null;
  const raw = expr.slice(at2 + 1, end);
  const name = raw.trim();
  const nameStart = at2 + 1 + (raw.length - raw.trimStart().length);
  return { start: at2, end: name.length === 0 ? at2 + 1 : nameStart + name.length, name: name.length === 0 ? "default" : name };
}
function validateNamedState(html, attrName, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const diagnostics = [];
  for (const element of parseWcsStateElements(html, stateTagName)) {
    const tagText = html.slice(element.tagStart, element.tagEnd);
    const match = /(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagText);
    if (match === null) continue;
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const quoted = match[1] !== void 0 || match[2] !== void 0;
    const valueEnd = element.tagStart + match.index + match[0].length - (quoted ? 1 : 0);
    diagnostics.push({
      code: WcsDiagnosticCode.NamedStateDeprecated,
      start: valueEnd - value.length,
      end: valueEnd,
      message: msgs.namedStateAttrDeprecated(value),
      severity: "error"
    });
  }
  for (const attr of findAllBindAttributes(html, attrName)) {
    let pos = 0;
    for (const expr of splitBindingExpressions(attr.value)) {
      const selector = findStateSelector(expr);
      if (selector !== null) {
        diagnostics.push({
          code: WcsDiagnosticCode.NamedStateDeprecated,
          start: attr.valueStart + pos + selector.start,
          end: attr.valueStart + pos + selector.end,
          message: msgs.namedStatePathDeprecated(selector.name),
          severity: "error"
        });
      }
      pos += expr.length + 1;
    }
  }
  for (const item of [...findAllMustacheSyntax(html), ...findAllCommentBindings(html)]) {
    const selector = findStateSelector(item.expression, true);
    if (selector !== null) {
      diagnostics.push({
        code: WcsDiagnosticCode.NamedStateDeprecated,
        start: item.exprStart + selector.start,
        end: item.exprStart + selector.end,
        message: msgs.namedStatePathDeprecated(selector.name),
        severity: "error"
      });
    }
  }
  return diagnostics;
}

// src/service/mountAttrValidator.ts
function findMountPathProblem(mountPath) {
  if (mountPath.length === 0) return "empty";
  for (const segment of mountPath.split(".")) {
    if (segment.length === 0) return "emptySegment";
    if (segment === "*") return "wildcard";
    if (segment.includes("$") || segment.includes("#") || segment.includes("@")) return "reserved";
  }
  return null;
}
function validateMountAttributes(html, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const diagnostics = [];
  for (const element of parseWcsStateElements(html, stateTagName)) {
    if (element.mountPath === null) continue;
    const problem = findMountPathProblem(element.mountPath);
    if (problem === null) continue;
    const tagText = html.slice(element.tagStart, element.tagEnd);
    const match = /(?:^|\s)mount\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagText);
    if (match === null) continue;
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const quoted = match[1] !== void 0 || match[2] !== void 0;
    const valueEnd = element.tagStart + match.index + match[0].length - (quoted ? 1 : 0);
    const attrStart = element.tagStart + match.index + (/^\s/.test(match[0]) ? 1 : 0);
    diagnostics.push({
      code: WcsDiagnosticCode.MountPathInvalid,
      start: value.length === 0 ? attrStart : valueEnd - value.length,
      end: valueEnd + (quoted && value.length === 0 ? 1 : 0),
      message: msgs.mountPathInvalid(problem, element.mountPath),
      severity: "error"
    });
  }
  return diagnostics;
}

// node_modules/acorn/dist/acorn.mjs
var astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 7, 9, 32, 4, 318, 1, 78, 5, 71, 10, 50, 3, 123, 2, 54, 14, 32, 10, 3, 1, 11, 3, 46, 10, 8, 0, 46, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 3, 0, 158, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 68, 8, 2, 0, 3, 0, 2, 3, 2, 4, 2, 0, 15, 1, 83, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 7, 19, 58, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 199, 7, 137, 9, 54, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 55, 9, 266, 3, 10, 1, 2, 0, 49, 6, 4, 4, 14, 10, 5350, 0, 7, 14, 11465, 27, 2343, 9, 87, 9, 39, 4, 60, 6, 26, 9, 535, 9, 470, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 4178, 9, 519, 45, 3, 22, 543, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 101, 0, 161, 6, 10, 9, 357, 0, 62, 13, 499, 13, 245, 1, 2, 9, 233, 0, 3, 0, 8, 1, 6, 0, 475, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];
var astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 13, 10, 2, 14, 2, 6, 2, 1, 2, 10, 2, 14, 2, 6, 2, 1, 4, 51, 13, 310, 10, 21, 11, 7, 25, 5, 2, 41, 2, 8, 70, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 7, 25, 39, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 39, 27, 10, 22, 251, 41, 7, 1, 17, 5, 57, 28, 11, 0, 9, 21, 43, 17, 47, 20, 28, 22, 13, 52, 58, 1, 3, 0, 14, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 20, 1, 64, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 31, 9, 2, 0, 3, 0, 2, 37, 2, 0, 26, 0, 2, 0, 45, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 38, 6, 186, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 19, 72, 200, 32, 32, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 24, 43, 261, 18, 16, 0, 2, 12, 2, 33, 125, 0, 80, 921, 103, 110, 18, 195, 2637, 96, 16, 1071, 18, 5, 26, 3994, 6, 582, 6842, 29, 1763, 568, 8, 30, 18, 78, 18, 29, 19, 47, 17, 3, 32, 20, 6, 18, 433, 44, 212, 63, 33, 24, 3, 24, 45, 74, 6, 0, 67, 12, 65, 1, 2, 0, 15, 4, 10, 7381, 42, 31, 98, 114, 8702, 3, 2, 6, 2, 1, 2, 290, 16, 0, 30, 2, 3, 0, 15, 3, 9, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 1845, 30, 7, 5, 262, 61, 147, 44, 11, 6, 17, 0, 322, 29, 19, 43, 485, 27, 229, 29, 3, 0, 208, 30, 2, 2, 2, 1, 2, 6, 3, 4, 10, 1, 225, 6, 2, 3, 2, 1, 2, 14, 2, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42719, 33, 4381, 3, 5773, 3, 7472, 16, 621, 2467, 541, 1507, 4938, 6, 8489];
var nonASCIIidentifierChars = "\u200C\u200D\xB7\u0300-\u036F\u0387\u0483-\u0487\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u0669\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u06F0-\u06F9\u0711\u0730-\u074A\u07A6-\u07B0\u07C0-\u07C9\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u0897-\u089F\u08CA-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0966-\u096F\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09E6-\u09EF\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A66-\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AE6-\u0AEF\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B55-\u0B57\u0B62\u0B63\u0B66-\u0B6F\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0BE6-\u0BEF\u0C00-\u0C04\u0C3C\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0CE6-\u0CEF\u0CF3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D66-\u0D6F\u0D81-\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0E50-\u0E59\u0EB1\u0EB4-\u0EBC\u0EC8-\u0ECE\u0ED0-\u0ED9\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1040-\u1049\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F-\u109D\u135D-\u135F\u1369-\u1371\u1712-\u1715\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u17E0-\u17E9\u180B-\u180D\u180F-\u1819\u18A9\u1920-\u192B\u1930-\u193B\u1946-\u194F\u19D0-\u19DA\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AB0-\u1ABD\u1ABF-\u1ADD\u1AE0-\u1AEB\u1B00-\u1B04\u1B34-\u1B44\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BB0-\u1BB9\u1BE6-\u1BF3\u1C24-\u1C37\u1C40-\u1C49\u1C50-\u1C59\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DFF\u200C\u200D\u203F\u2040\u2054\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\u30FB\uA620-\uA629\uA66F\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA82C\uA880\uA881\uA8B4-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F1\uA8FF-\uA909\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9D0-\uA9D9\uA9E5\uA9F0-\uA9F9\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA50-\uAA59\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uABF0-\uABF9\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFF10-\uFF19\uFF3F\uFF65";
var nonASCIIidentifierStartChars = "\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0560-\u0588\u05D0-\u05EA\u05EF-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u0860-\u086A\u0870-\u0887\u0889-\u088F\u08A0-\u08C9\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u09FC\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C5C\u0C5D\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDC-\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D04-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E86-\u0E8A\u0E8C-\u0EA3\u0EA5\u0EA7-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u1711\u171F-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1878\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4C\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C8A\u1C90-\u1CBA\u1CBD-\u1CBF\u1CE9-\u1CEC\u1CEE-\u1CF3\u1CF5\u1CF6\u1CFA\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312F\u3131-\u318E\u31A0-\u31BF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7DC\uA7F1-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA8FE\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB69\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC";
var reservedWords = {
  3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile",
  5: "class enum extends super const export import",
  6: "enum",
  strict: "implements interface let package private protected public static yield",
  strictBind: "eval arguments"
};
var ecma5AndLessKeywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";
var keywords$1 = {
  5: ecma5AndLessKeywords,
  "5module": ecma5AndLessKeywords + " export import",
  6: ecma5AndLessKeywords + " const class extends export import super"
};
var keywordRelationalOperator = /^in(stanceof)?$/;
var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
function isInAstralSet(code, set) {
  var pos = 65536;
  for (var i = 0; i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) {
      return false;
    }
    pos += set[i + 1];
    if (pos >= code) {
      return true;
    }
  }
  return false;
}
function isIdentifierStart(code, astral) {
  if (code < 65) {
    return code === 36;
  }
  if (code < 91) {
    return true;
  }
  if (code < 97) {
    return code === 95;
  }
  if (code < 123) {
    return true;
  }
  if (code <= 65535) {
    return code >= 170 && nonASCIIidentifierStart.test(String.fromCharCode(code));
  }
  if (astral === false) {
    return false;
  }
  return isInAstralSet(code, astralIdentifierStartCodes);
}
function isIdentifierChar(code, astral) {
  if (code < 48) {
    return code === 36;
  }
  if (code < 58) {
    return true;
  }
  if (code < 65) {
    return false;
  }
  if (code < 91) {
    return true;
  }
  if (code < 97) {
    return code === 95;
  }
  if (code < 123) {
    return true;
  }
  if (code <= 65535) {
    return code >= 170 && nonASCIIidentifier.test(String.fromCharCode(code));
  }
  if (astral === false) {
    return false;
  }
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
}
var TokenType = function TokenType2(label, conf) {
  if (conf === void 0) conf = {};
  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.isLoop = !!conf.isLoop;
  this.isAssign = !!conf.isAssign;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.binop = conf.binop || null;
  this.updateContext = null;
};
function binop(name, prec) {
  return new TokenType(name, { beforeExpr: true, binop: prec });
}
var beforeExpr = { beforeExpr: true };
var startsExpr = { startsExpr: true };
var keywords = {};
function kw(name, options) {
  if (options === void 0) options = {};
  options.keyword = name;
  return keywords[name] = new TokenType(name, options);
}
var types$1 = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  name: new TokenType("name", startsExpr),
  privateId: new TokenType("privateId", startsExpr),
  eof: new TokenType("eof"),
  // Punctuation token types.
  bracketL: new TokenType("[", { beforeExpr: true, startsExpr: true }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", { beforeExpr: true, startsExpr: true }),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", { beforeExpr: true, startsExpr: true }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."),
  question: new TokenType("?", beforeExpr),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr),
  backQuote: new TokenType("`", startsExpr),
  dollarBraceL: new TokenType("${", { beforeExpr: true, startsExpr: true }),
  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.
  eq: new TokenType("=", { beforeExpr: true, isAssign: true }),
  assign: new TokenType("_=", { beforeExpr: true, isAssign: true }),
  incDec: new TokenType("++/--", { prefix: true, postfix: true, startsExpr: true }),
  prefix: new TokenType("!/~", { beforeExpr: true, prefix: true, startsExpr: true }),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", { beforeExpr: true, binop: 9, prefix: true, startsExpr: true }),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", { beforeExpr: true }),
  coalesce: binop("??", 1),
  // Keyword token types.
  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", { isLoop: true, beforeExpr: true }),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", { isLoop: true }),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", { isLoop: true }),
  _with: kw("with"),
  _new: kw("new", { beforeExpr: true, startsExpr: true }),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import", startsExpr),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", { beforeExpr: true, binop: 7 }),
  _instanceof: kw("instanceof", { beforeExpr: true, binop: 7 }),
  _typeof: kw("typeof", { beforeExpr: true, prefix: true, startsExpr: true }),
  _void: kw("void", { beforeExpr: true, prefix: true, startsExpr: true }),
  _delete: kw("delete", { beforeExpr: true, prefix: true, startsExpr: true })
};
var lineBreak = /\r\n?|\n|\u2028|\u2029/;
var lineBreakG = new RegExp(lineBreak.source, "g");
function isNewLine(code) {
  return code === 10 || code === 13 || code === 8232 || code === 8233;
}
function nextLineBreak(code, from, end) {
  if (end === void 0) end = code.length;
  for (var i = from; i < end; i++) {
    var next = code.charCodeAt(i);
    if (isNewLine(next)) {
      return i < end - 1 && next === 13 && code.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
    }
  }
  return -1;
}
var nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;
var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;
var ref = Object.prototype;
var hasOwnProperty = ref.hasOwnProperty;
var toString = ref.toString;
var hasOwn = Object.hasOwn || (function(obj, propName) {
  return hasOwnProperty.call(obj, propName);
});
var isArray = Array.isArray || (function(obj) {
  return toString.call(obj) === "[object Array]";
});
var regexpCache = /* @__PURE__ */ Object.create(null);
function wordsRegexp(words) {
  return regexpCache[words] || (regexpCache[words] = new RegExp("^(?:" + words.replace(/ /g, "|") + ")$"));
}
function codePointToString(code) {
  if (code <= 65535) {
    return String.fromCharCode(code);
  }
  code -= 65536;
  return String.fromCharCode((code >> 10) + 55296, (code & 1023) + 56320);
}
var loneSurrogate = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])/;
var Position = function Position2(line, col) {
  this.line = line;
  this.column = col;
};
Position.prototype.offset = function offset(n) {
  return new Position(this.line, this.column + n);
};
var SourceLocation = function SourceLocation2(p, start, end) {
  this.start = start;
  this.end = end;
  if (p.sourceFile !== null) {
    this.source = p.sourceFile;
  }
};
function getLineInfo(input, offset2) {
  for (var line = 1, cur = 0; ; ) {
    var nextBreak = nextLineBreak(input, cur, offset2);
    if (nextBreak < 0) {
      return new Position(line, offset2 - cur);
    }
    ++line;
    cur = nextBreak;
  }
}
var defaultOptions = {
  // `ecmaVersion` indicates the ECMAScript version to parse. Must be
  // either 3, 5, 6 (or 2015), 7 (2016), 8 (2017), 9 (2018), 10
  // (2019), 11 (2020), 12 (2021), 13 (2022), 14 (2023), or `"latest"`
  // (the latest version the library supports). This influences
  // support for strict mode, the set of reserved words, and support
  // for new syntax features.
  ecmaVersion: null,
  // `sourceType` indicates the mode the code should be parsed in.
  // Can be either `"script"`, `"module"` or `"commonjs"`. This influences global
  // strict mode and parsing of `import` and `export` declarations.
  sourceType: "script",
  // When set to true, enable strict parsing mode even if `sourceType`
  // is `"script"`.
  strict: false,
  // `onInsertedSemicolon` can be a callback that will be called when
  // a semicolon is automatically inserted. It will be passed the
  // position of the inserted semicolon as an offset, and if
  // `locations` is enabled, it is given the location as a `{line,
  // column}` object as second argument.
  onInsertedSemicolon: null,
  // `onTrailingComma` is similar to `onInsertedSemicolon`, but for
  // trailing commas.
  onTrailingComma: null,
  // By default, reserved words are only enforced if ecmaVersion >= 5.
  // Set `allowReserved` to a boolean value to explicitly turn this on
  // an off. When this option has the value "never", reserved words
  // and keywords can also not be used as property names.
  allowReserved: null,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program, and an import.meta expression
  // in a script isn't considered an error.
  allowImportExportEverywhere: false,
  // By default, await identifiers are allowed to appear at the top-level scope only if ecmaVersion >= 2022.
  // When enabled, await identifiers are allowed to appear at the top-level scope,
  // but they are still not allowed in non-async functions.
  allowAwaitOutsideFunction: null,
  // When enabled, super identifiers are not constrained to
  // appearing in methods and do not raise an error when they appear elsewhere.
  allowSuperOutsideMethod: null,
  // When enabled, hashbang directive in the beginning of file is
  // allowed and treated as a line comment. Enabled by default when
  // `ecmaVersion` >= 2023.
  allowHashBang: false,
  // By default, the parser will verify that private properties are
  // only used in places where they are valid and have been declared.
  // Set this to false to turn such checks off.
  checkPrivateFields: true,
  // When `locations` is on, `loc` properties holding objects with
  // `start` and `end` properties in `{line, column}` form (with
  // line being 1-based and column 0-based) will be attached to the
  // nodes.
  locations: false,
  // Pass an optional `{line, column}` object to use for the start of
  // the parse. This is mostly useful when using `parseExpressionAt`
  // with `locations: true`, to prevent the parser from having to
  // determine the line position at the start position.
  startLocation: null,
  // A function can be passed as `onToken` option, which will
  // cause Acorn to call that function with object in the same
  // format as tokens returned from `tokenizer().getToken()`. Note
  // that you are not allowed to call the parser from the
  // callback—that will corrupt its internal state.
  onToken: null,
  // A function can be passed as `onComment` option, which will
  // cause Acorn to call that function with `(block, text, start,
  // end)` parameters whenever a comment is skipped. `block` is a
  // boolean indicating whether this is a block (`/* */`) comment,
  // `text` is the content of the comment, and `start` and `end` are
  // character offsets that denote the start and end of the comment.
  // When the `locations` option is on, two more parameters are
  // passed, the full `{line, column}` locations of the start and
  // end of the comments. Note that you are not allowed to call the
  // parser from the callback—that will corrupt its internal state.
  // When this option has an array as value, objects representing the
  // comments are pushed to it.
  onComment: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // It is possible to parse multiple files into a single AST by
  // passing the tree produced by parsing the first file as
  // `program` option in subsequent parses. This will add the
  // toplevel forms of the parsed file to the `Program` (top) node
  // of an existing parse tree.
  program: null,
  // When `locations` is on, you can pass this to record the source
  // file in every node's `loc` object.
  sourceFile: null,
  // This value, if given, is stored in every node, whether
  // `locations` is on or off.
  directSourceFile: null,
  // When enabled, parenthesized expressions are represented by
  // (non-standard) ParenthesizedExpression nodes
  preserveParens: false
};
var warnedAboutEcmaVersion = false;
function getOptions(opts) {
  var options = {};
  for (var opt in defaultOptions) {
    options[opt] = opts && hasOwn(opts, opt) ? opts[opt] : defaultOptions[opt];
  }
  if (options.ecmaVersion === "latest") {
    options.ecmaVersion = 1e8;
  } else if (options.ecmaVersion == null) {
    if (!warnedAboutEcmaVersion && typeof console === "object" && console.warn) {
      warnedAboutEcmaVersion = true;
      console.warn("Since Acorn 8.0.0, options.ecmaVersion is required.\nDefaulting to 2020, but this will stop working in the future.");
    }
    options.ecmaVersion = 11;
  } else if (options.ecmaVersion >= 2015) {
    options.ecmaVersion -= 2009;
  }
  if (options.allowReserved == null) {
    options.allowReserved = options.ecmaVersion < 5;
  }
  if (!opts || opts.allowHashBang == null) {
    options.allowHashBang = options.ecmaVersion >= 14;
  }
  if (isArray(options.onToken)) {
    var tokens = options.onToken;
    options.onToken = function(token) {
      return tokens.push(token);
    };
  }
  if (isArray(options.onComment)) {
    options.onComment = pushComment(options, options.onComment);
  }
  if (options.sourceType === "commonjs" && options.allowAwaitOutsideFunction) {
    throw new Error("Cannot use allowAwaitOutsideFunction with sourceType: commonjs");
  }
  return options;
}
function pushComment(options, array) {
  return function(block, text, start, end, startLoc, endLoc) {
    var comment = {
      type: block ? "Block" : "Line",
      value: text,
      start,
      end
    };
    if (options.locations) {
      comment.loc = new SourceLocation(this, startLoc, endLoc);
    }
    if (options.ranges) {
      comment.range = [start, end];
    }
    array.push(comment);
  };
}
var SCOPE_TOP = 1;
var SCOPE_FUNCTION = 2;
var SCOPE_ASYNC = 4;
var SCOPE_GENERATOR = 8;
var SCOPE_ARROW = 16;
var SCOPE_SIMPLE_CATCH = 32;
var SCOPE_SUPER = 64;
var SCOPE_DIRECT_SUPER = 128;
var SCOPE_CLASS_STATIC_BLOCK = 256;
var SCOPE_CLASS_FIELD_INIT = 512;
var SCOPE_SWITCH = 1024;
var SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK;
function functionFlags(async, generator) {
  return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0);
}
var BIND_NONE = 0;
var BIND_VAR = 1;
var BIND_LEXICAL = 2;
var BIND_FUNCTION = 3;
var BIND_SIMPLE_CATCH = 4;
var BIND_OUTSIDE = 5;
var Parser = function Parser2(options, input, startPos) {
  this.options = options = getOptions(options);
  this.sourceFile = options.sourceFile;
  this.keywords = wordsRegexp(keywords$1[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5]);
  var reserved = "";
  if (options.allowReserved !== true) {
    reserved = reservedWords[options.ecmaVersion >= 6 ? 6 : options.ecmaVersion === 5 ? 5 : 3];
    if (options.sourceType === "module") {
      reserved += " await";
    }
  }
  this.reservedWords = wordsRegexp(reserved);
  var reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict;
  this.reservedWordsStrict = wordsRegexp(reservedStrict);
  this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind);
  this.input = String(input);
  this.containsEsc = false;
  this.pos = startPos || 0;
  this.curLine = 1;
  if (options.startLocation) {
    this.lineStart = this.pos - options.startLocation.column;
    this.curLine = options.startLocation.line;
  } else if (startPos) {
    this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
    if (this.options.locations) {
      this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length;
    }
  } else {
    this.lineStart = 0;
  }
  this.type = types$1.eof;
  this.value = null;
  this.start = this.end = this.pos;
  this.startLoc = this.endLoc = this.curPosition();
  this.lastTokEndLoc = this.lastTokStartLoc = null;
  this.lastTokStart = this.lastTokEnd = this.pos;
  this.context = this.initialContext();
  this.exprAllowed = true;
  this.inModule = options.sourceType === "module";
  this.strict = this.inModule || options.strict === true || this.strictDirective(this.pos);
  this.potentialArrowAt = -1;
  this.potentialArrowInForAwait = false;
  this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
  this.labels = [];
  this.undefinedExports = /* @__PURE__ */ Object.create(null);
  if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!") {
    this.skipLineComment(2);
  }
  this.scopeStack = [];
  this.enterScope(
    this.options.sourceType === "commonjs" ? SCOPE_FUNCTION : SCOPE_TOP
  );
  this.regexpState = null;
  this.privateNameStack = [];
};
var prototypeAccessors = { inFunction: { configurable: true }, inGenerator: { configurable: true }, inAsync: { configurable: true }, canAwait: { configurable: true }, allowReturn: { configurable: true }, allowSuper: { configurable: true }, allowDirectSuper: { configurable: true }, treatFunctionsAsVar: { configurable: true }, allowNewDotTarget: { configurable: true }, allowUsing: { configurable: true }, inClassStaticBlock: { configurable: true } };
Parser.prototype.parse = function parse() {
  var this$1$1 = this;
  var node = this.options.program || this.startNode();
  this.nextToken();
  return this.catchStackOverflow(function() {
    return this$1$1.parseTopLevel(node);
  });
};
prototypeAccessors.inFunction.get = function() {
  return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0;
};
prototypeAccessors.inGenerator.get = function() {
  return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0;
};
prototypeAccessors.inAsync.get = function() {
  return (this.currentVarScope().flags & SCOPE_ASYNC) > 0;
};
prototypeAccessors.canAwait.get = function() {
  for (var i = this.scopeStack.length - 1; i >= 0; i--) {
    var ref2 = this.scopeStack[i];
    var flags = ref2.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT)) {
      return false;
    }
    if (flags & SCOPE_FUNCTION) {
      return (flags & SCOPE_ASYNC) > 0;
    }
  }
  return this.inModule && this.options.ecmaVersion >= 13 || this.options.allowAwaitOutsideFunction;
};
prototypeAccessors.allowReturn.get = function() {
  if (this.inFunction) {
    return true;
  }
  if (this.options.allowReturnOutsideFunction && this.currentVarScope().flags & SCOPE_TOP) {
    return true;
  }
  return false;
};
prototypeAccessors.allowSuper.get = function() {
  var ref2 = this.currentThisScope();
  var flags = ref2.flags;
  return (flags & SCOPE_SUPER) > 0 || this.options.allowSuperOutsideMethod;
};
prototypeAccessors.allowDirectSuper.get = function() {
  return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0;
};
prototypeAccessors.treatFunctionsAsVar.get = function() {
  return this.treatFunctionsAsVarInScope(this.currentScope());
};
prototypeAccessors.allowNewDotTarget.get = function() {
  for (var i = this.scopeStack.length - 1; i >= 0; i--) {
    var ref2 = this.scopeStack[i];
    var flags = ref2.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT) || flags & SCOPE_FUNCTION && !(flags & SCOPE_ARROW)) {
      return true;
    }
  }
  return false;
};
prototypeAccessors.allowUsing.get = function() {
  var ref2 = this.currentScope();
  var flags = ref2.flags;
  if (flags & SCOPE_SWITCH) {
    return false;
  }
  if (!this.inModule && flags & SCOPE_TOP) {
    return false;
  }
  return true;
};
prototypeAccessors.inClassStaticBlock.get = function() {
  return (this.currentVarScope().flags & SCOPE_CLASS_STATIC_BLOCK) > 0;
};
Parser.extend = function extend() {
  var plugins = [], len = arguments.length;
  while (len--) plugins[len] = arguments[len];
  var cls = this;
  for (var i = 0; i < plugins.length; i++) {
    cls = plugins[i](cls);
  }
  return cls;
};
Parser.parse = function parse2(input, options) {
  return new this(options, input).parse();
};
Parser.parseExpressionAt = function parseExpressionAt(input, pos, options) {
  var parser = new this(options, input, pos);
  parser.nextToken();
  return parser.parseExpression();
};
Parser.tokenizer = function tokenizer(input, options) {
  return new this(options, input);
};
Object.defineProperties(Parser.prototype, prototypeAccessors);
var pp$9 = Parser.prototype;
var literal = /^(?:'((?:\\[^]|[^'\\])*?)'|"((?:\\[^]|[^"\\])*?)")/;
pp$9.strictDirective = function(start) {
  if (this.options.ecmaVersion < 5) {
    return false;
  }
  for (; ; ) {
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    var match = literal.exec(this.input.slice(start));
    if (!match) {
      return false;
    }
    if ((match[1] || match[2]) === "use strict") {
      skipWhiteSpace.lastIndex = start + match[0].length;
      var spaceAfter = skipWhiteSpace.exec(this.input), end = spaceAfter.index + spaceAfter[0].length;
      var next = this.input.charAt(end);
      return next === ";" || next === "}" || lineBreak.test(spaceAfter[0]) && !(/[(`.[+\-/*%<>=,?^&]/.test(next) || next === "!" && this.input.charAt(end + 1) === "=");
    }
    start += match[0].length;
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    if (this.input[start] === ";") {
      start++;
    }
  }
};
pp$9.eat = function(type) {
  if (this.type === type) {
    this.next();
    return true;
  } else {
    return false;
  }
};
pp$9.isContextual = function(name) {
  return this.type === types$1.name && this.value === name && !this.containsEsc;
};
pp$9.eatContextual = function(name) {
  if (!this.isContextual(name)) {
    return false;
  }
  this.next();
  return true;
};
pp$9.catchStackOverflow = function(f) {
  try {
    return f();
  } catch (e) {
    if (e instanceof Error && (/\bstack\b.*\b(exceeded|overflow)\b/i.test(e.message) || /\btoo much recursion\b/i.test(e.message))) {
      this.raise(this.start, "Not enough stack space to parse input");
    } else {
      throw e;
    }
  }
};
pp$9.expectContextual = function(name) {
  if (!this.eatContextual(name)) {
    this.unexpected();
  }
};
pp$9.canInsertSemicolon = function() {
  return this.type === types$1.eof || this.type === types$1.braceR || lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};
pp$9.insertSemicolon = function() {
  if (this.canInsertSemicolon()) {
    if (this.options.onInsertedSemicolon) {
      this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc);
    }
    return true;
  }
};
pp$9.semicolon = function() {
  if (!this.eat(types$1.semi) && !this.insertSemicolon()) {
    this.unexpected();
  }
};
pp$9.afterTrailingComma = function(tokType, notNext) {
  if (this.type === tokType) {
    if (this.options.onTrailingComma) {
      this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc);
    }
    if (!notNext) {
      this.next();
    }
    return true;
  }
};
pp$9.expect = function(type) {
  this.eat(type) || this.unexpected();
};
pp$9.unexpected = function(pos) {
  this.raise(pos != null ? pos : this.start, "Unexpected token");
};
var DestructuringErrors = function DestructuringErrors2() {
  this.shorthandAssign = this.trailingComma = this.parenthesizedAssign = this.parenthesizedBind = this.doubleProto = -1;
};
pp$9.checkPatternErrors = function(refDestructuringErrors, isAssign) {
  if (!refDestructuringErrors) {
    return;
  }
  if (refDestructuringErrors.trailingComma > -1) {
    this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element");
  }
  var parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind;
  if (parens > -1) {
    this.raiseRecoverable(parens, isAssign ? "Assigning to rvalue" : "Parenthesized pattern");
  }
};
pp$9.checkExpressionErrors = function(refDestructuringErrors, andThrow) {
  if (!refDestructuringErrors) {
    return false;
  }
  var shorthandAssign = refDestructuringErrors.shorthandAssign;
  var doubleProto = refDestructuringErrors.doubleProto;
  if (!andThrow) {
    return shorthandAssign >= 0 || doubleProto >= 0;
  }
  if (shorthandAssign >= 0) {
    this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns");
  }
  if (doubleProto >= 0) {
    this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property");
  }
};
pp$9.checkYieldAwaitInDefaultParams = function() {
  if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos)) {
    this.raise(this.yieldPos, "Yield expression cannot be a default value");
  }
  if (this.awaitPos) {
    this.raise(this.awaitPos, "Await expression cannot be a default value");
  }
};
pp$9.isSimpleAssignTarget = function(expr) {
  if (expr.type === "ParenthesizedExpression") {
    return this.isSimpleAssignTarget(expr.expression);
  }
  return expr.type === "Identifier" || expr.type === "MemberExpression";
};
var pp$8 = Parser.prototype;
pp$8.parseTopLevel = function(node) {
  var exports$1 = /* @__PURE__ */ Object.create(null);
  if (!node.body) {
    node.body = [];
  }
  while (this.type !== types$1.eof) {
    var stmt = this.parseStatement(null, true, exports$1);
    node.body.push(stmt);
  }
  if (this.inModule) {
    for (var i = 0, list = Object.keys(this.undefinedExports); i < list.length; i += 1) {
      var name = list[i];
      this.raiseRecoverable(this.undefinedExports[name].start, "Export '" + name + "' is not defined");
    }
  }
  this.adaptDirectivePrologue(node.body);
  this.next();
  node.sourceType = this.options.sourceType === "commonjs" ? "script" : this.options.sourceType;
  return this.finishNode(node, "Program");
};
var loopLabel = { kind: "loop" };
var switchLabel = { kind: "switch" };
pp$8.isLet = function(context) {
  if (this.options.ecmaVersion < 6 || !this.isContextual("let")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, nextCh = this.fullCharCodeAt(next);
  if (nextCh === 91 || nextCh === 92) {
    return true;
  }
  if (context) {
    return false;
  }
  if (nextCh === 123) {
    return true;
  }
  if (isIdentifierStart(nextCh)) {
    var start = next;
    do {
      next += nextCh <= 65535 ? 1 : 2;
    } while (isIdentifierChar(nextCh = this.fullCharCodeAt(next)));
    if (nextCh === 92) {
      return true;
    }
    var ident = this.input.slice(start, next);
    if (!keywordRelationalOperator.test(ident)) {
      return true;
    }
  }
  return false;
};
pp$8.isAsyncFunction = function() {
  if (this.options.ecmaVersion < 8 || !this.isContextual("async")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, after;
  return !lineBreak.test(this.input.slice(this.pos, next)) && this.input.slice(next, next + 8) === "function" && (next + 8 === this.input.length || !(isIdentifierChar(after = this.fullCharCodeAt(next + 8)) || after === 92));
};
pp$8.isUsingKeyword = function(isAwaitUsing, isFor) {
  if (this.options.ecmaVersion < 17 || !this.isContextual(isAwaitUsing ? "await" : "using")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length;
  if (lineBreak.test(this.input.slice(this.pos, next))) {
    return false;
  }
  if (isAwaitUsing) {
    var usingEndPos = next + 5, after;
    if (this.input.slice(next, usingEndPos) !== "using" || usingEndPos === this.input.length || isIdentifierChar(after = this.fullCharCodeAt(usingEndPos)) || after === 92) {
      return false;
    }
    skipWhiteSpace.lastIndex = usingEndPos;
    var skipAfterUsing = skipWhiteSpace.exec(this.input);
    next = usingEndPos + skipAfterUsing[0].length;
    if (skipAfterUsing && lineBreak.test(this.input.slice(usingEndPos, next))) {
      return false;
    }
  }
  var ch = this.fullCharCodeAt(next);
  if (!isIdentifierStart(ch) && ch !== 92) {
    return false;
  }
  var idStart = next;
  do {
    next += ch <= 65535 ? 1 : 2;
  } while (isIdentifierChar(ch = this.fullCharCodeAt(next)));
  if (ch === 92) {
    return true;
  }
  var id2 = this.input.slice(idStart, next);
  if (keywordRelationalOperator.test(id2)) {
    return false;
  }
  if (isFor && !isAwaitUsing && id2 === "of") {
    skipWhiteSpace.lastIndex = next;
    var skipAfterOf = skipWhiteSpace.exec(this.input);
    next = next + skipAfterOf[0].length;
    if (this.input.charCodeAt(next) !== 61 || // Check for ==, === and => operators
    (ch = this.input.charCodeAt(next + 1)) === 61 || ch === 62) {
      return false;
    }
  }
  return true;
};
pp$8.isAwaitUsing = function(isFor) {
  return this.isUsingKeyword(true, isFor);
};
pp$8.isUsing = function(isFor) {
  return this.isUsingKeyword(false, isFor);
};
pp$8.parseStatement = function(context, topLevel, exports$1) {
  var starttype = this.type, node = this.startNode(), kind;
  if (this.isLet(context)) {
    starttype = types$1._var;
    kind = "let";
  }
  switch (starttype) {
    case types$1._break:
    case types$1._continue:
      return this.parseBreakContinueStatement(node, starttype.keyword);
    case types$1._debugger:
      return this.parseDebuggerStatement(node);
    case types$1._do:
      return this.parseDoStatement(node);
    case types$1._for:
      return this.parseForStatement(node);
    case types$1._function:
      if (context && (this.strict || context !== "if" && context !== "label") && this.options.ecmaVersion >= 6) {
        this.unexpected();
      }
      return this.parseFunctionStatement(node, false, !context);
    case types$1._class:
      if (context) {
        this.unexpected();
      }
      return this.parseClass(node, true);
    case types$1._if:
      return this.parseIfStatement(node);
    case types$1._return:
      return this.parseReturnStatement(node);
    case types$1._switch:
      return this.parseSwitchStatement(node);
    case types$1._throw:
      return this.parseThrowStatement(node);
    case types$1._try:
      return this.parseTryStatement(node);
    case types$1._const:
    case types$1._var:
      kind = kind || this.value;
      if (context && kind !== "var") {
        this.unexpected();
      }
      return this.parseVarStatement(node, kind);
    case types$1._while:
      return this.parseWhileStatement(node);
    case types$1._with:
      return this.parseWithStatement(node);
    case types$1.braceL:
      return this.parseBlock(true, node);
    case types$1.semi:
      return this.parseEmptyStatement(node);
    case types$1._export:
    case types$1._import:
      if (this.options.ecmaVersion > 10 && starttype === types$1._import) {
        skipWhiteSpace.lastIndex = this.pos;
        var skip = skipWhiteSpace.exec(this.input);
        var next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next);
        if (nextCh === 40 || nextCh === 46) {
          return this.parseExpressionStatement(node, this.parseExpression());
        }
      }
      if (!this.options.allowImportExportEverywhere) {
        if (!topLevel) {
          this.raise(this.start, "'import' and 'export' may only appear at the top level");
        }
        if (!this.inModule) {
          this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'");
        }
      }
      return starttype === types$1._import ? this.parseImport(node) : this.parseExport(node, exports$1);
    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
    default:
      if (this.isAsyncFunction()) {
        if (context) {
          this.unexpected();
        }
        this.next();
        return this.parseFunctionStatement(node, true, !context);
      }
      var usingKind = this.isAwaitUsing(false) ? "await using" : this.isUsing(false) ? "using" : null;
      if (usingKind) {
        if (!this.allowUsing) {
          this.raise(this.start, "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement");
        }
        if (context) {
          this.raise(this.start, "Using declaration is not allowed in single-statement positions");
        }
        if (usingKind === "await using") {
          if (!this.canAwait) {
            this.raise(this.start, "Await using cannot appear outside of async function");
          }
          this.next();
        }
        this.next();
        this.parseVar(node, false, usingKind);
        this.semicolon();
        return this.finishNode(node, "VariableDeclaration");
      }
      var maybeName = this.value, expr = this.parseExpression();
      if (starttype === types$1.name && expr.type === "Identifier" && this.eat(types$1.colon)) {
        return this.parseLabeledStatement(node, maybeName, expr, context);
      } else {
        return this.parseExpressionStatement(node, expr);
      }
  }
};
pp$8.parseBreakContinueStatement = function(node, keyword) {
  var isBreak = keyword === "break";
  this.next();
  if (this.eat(types$1.semi) || this.insertSemicolon()) {
    node.label = null;
  } else if (this.type !== types$1.name) {
    this.unexpected();
  } else {
    node.label = this.parseIdent();
    this.semicolon();
  }
  var i = 0;
  for (; i < this.labels.length; ++i) {
    var lab = this.labels[i];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) {
        break;
      }
      if (node.label && isBreak) {
        break;
      }
    }
  }
  if (i === this.labels.length) {
    this.raise(node.start, "Unsyntactic " + keyword);
  }
  return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
};
pp$8.parseDebuggerStatement = function(node) {
  this.next();
  this.semicolon();
  return this.finishNode(node, "DebuggerStatement");
};
pp$8.parseDoStatement = function(node) {
  this.next();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("do");
  this.labels.pop();
  this.expect(types$1._while);
  node.test = this.parseParenExpression();
  if (this.options.ecmaVersion >= 6) {
    this.eat(types$1.semi);
  } else {
    this.semicolon();
  }
  return this.finishNode(node, "DoWhileStatement");
};
pp$8.parseForStatement = function(node) {
  this.next();
  var awaitAt = this.options.ecmaVersion >= 9 && this.canAwait && this.eatContextual("await") ? this.lastTokStart : -1;
  this.labels.push(loopLabel);
  this.enterScope(0);
  this.expect(types$1.parenL);
  if (this.type === types$1.semi) {
    if (awaitAt > -1) {
      this.unexpected(awaitAt);
    }
    return this.parseFor(node, null);
  }
  var isLet = this.isLet();
  if (this.type === types$1._var || this.type === types$1._const || isLet) {
    var init$1 = this.startNode(), kind = isLet ? "let" : this.value;
    this.next();
    this.parseVar(init$1, true, kind);
    this.finishNode(init$1, "VariableDeclaration");
    return this.parseForAfterInit(node, init$1, awaitAt);
  }
  var startsWithLet = this.isContextual("let"), isForOf = false;
  var usingKind = this.isUsing(true) ? "using" : this.isAwaitUsing(true) ? "await using" : null;
  if (usingKind) {
    var init$2 = this.startNode();
    this.next();
    if (usingKind === "await using") {
      if (!this.canAwait) {
        this.raise(this.start, "Await using cannot appear outside of async function");
      }
      this.next();
    }
    this.parseVar(init$2, true, usingKind);
    this.finishNode(init$2, "VariableDeclaration");
    return this.parseForAfterInit(node, init$2, awaitAt);
  }
  var containsEsc = this.containsEsc;
  var refDestructuringErrors = new DestructuringErrors();
  var initPos = this.start;
  var init = awaitAt > -1 ? this.parseExprSubscripts(refDestructuringErrors, "await") : this.parseExpression(true, refDestructuringErrors);
  if (this.type === types$1._in || (isForOf = this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
    if (awaitAt > -1) {
      if (this.type === types$1._in) {
        this.unexpected(awaitAt);
      }
      node.await = true;
    } else if (isForOf && this.options.ecmaVersion >= 8) {
      if (init.start === initPos && !containsEsc && init.type === "Identifier" && init.name === "async") {
        this.unexpected();
      } else if (this.options.ecmaVersion >= 9) {
        node.await = false;
      }
    }
    if (startsWithLet && isForOf) {
      this.raise(init.start, "The left-hand side of a for-of loop may not start with 'let'.");
    }
    this.toAssignable(init, false, refDestructuringErrors);
    this.checkLValPattern(init);
    return this.parseForIn(node, init);
  } else {
    this.checkExpressionErrors(refDestructuringErrors, true);
  }
  if (awaitAt > -1) {
    this.unexpected(awaitAt);
  }
  return this.parseFor(node, init);
};
pp$8.parseForAfterInit = function(node, init, awaitAt) {
  if ((this.type === types$1._in || this.options.ecmaVersion >= 6 && this.isContextual("of")) && init.declarations.length === 1) {
    if (this.type === types$1._in) {
      if ((init.kind === "using" || init.kind === "await using") && !init.declarations[0].init) {
        this.raise(this.start, "Using declaration is not allowed in for-in loops");
      }
      if (this.options.ecmaVersion >= 9 && awaitAt > -1) {
        this.unexpected(awaitAt);
      }
    } else if (this.options.ecmaVersion >= 9) {
      node.await = awaitAt > -1;
    }
    return this.parseForIn(node, init);
  }
  if (awaitAt > -1) {
    this.unexpected(awaitAt);
  }
  return this.parseFor(node, init);
};
pp$8.parseFunctionStatement = function(node, isAsync, declarationPosition) {
  this.next();
  return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync);
};
pp$8.parseIfStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  node.consequent = this.parseStatement("if");
  node.alternate = this.eat(types$1._else) ? this.parseStatement("if") : null;
  return this.finishNode(node, "IfStatement");
};
pp$8.parseReturnStatement = function(node) {
  if (!this.allowReturn) {
    this.raise(this.start, "'return' outside of function");
  }
  this.next();
  if (this.eat(types$1.semi) || this.insertSemicolon()) {
    node.argument = null;
  } else {
    node.argument = this.parseExpression();
    this.semicolon();
  }
  return this.finishNode(node, "ReturnStatement");
};
pp$8.parseSwitchStatement = function(node) {
  this.next();
  node.discriminant = this.parseParenExpression();
  node.cases = [];
  this.expect(types$1.braceL);
  this.labels.push(switchLabel);
  this.enterScope(SCOPE_SWITCH);
  var cur;
  for (var sawDefault = false; this.type !== types$1.braceR; ) {
    if (this.type === types$1._case || this.type === types$1._default) {
      var isCase = this.type === types$1._case;
      if (cur) {
        this.finishNode(cur, "SwitchCase");
      }
      node.cases.push(cur = this.startNode());
      cur.consequent = [];
      this.next();
      if (isCase) {
        cur.test = this.parseExpression();
      } else {
        if (sawDefault) {
          this.raiseRecoverable(this.lastTokStart, "Multiple default clauses");
        }
        sawDefault = true;
        cur.test = null;
      }
      this.expect(types$1.colon);
    } else {
      if (!cur) {
        this.unexpected();
      }
      cur.consequent.push(this.parseStatement(null));
    }
  }
  this.exitScope();
  if (cur) {
    this.finishNode(cur, "SwitchCase");
  }
  this.next();
  this.labels.pop();
  return this.finishNode(node, "SwitchStatement");
};
pp$8.parseThrowStatement = function(node) {
  this.next();
  if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) {
    this.raise(this.lastTokEnd, "Illegal newline after throw");
  }
  node.argument = this.parseExpression();
  this.semicolon();
  return this.finishNode(node, "ThrowStatement");
};
var empty$1 = [];
pp$8.parseCatchClauseParam = function() {
  var param = this.parseBindingAtom();
  var simple = param.type === "Identifier";
  this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
  this.checkLValPattern(param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
  this.expect(types$1.parenR);
  return param;
};
pp$8.parseTryStatement = function(node) {
  this.next();
  node.block = this.parseBlock();
  node.handler = null;
  if (this.type === types$1._catch) {
    var clause = this.startNode();
    this.next();
    if (this.eat(types$1.parenL)) {
      clause.param = this.parseCatchClauseParam();
    } else {
      if (this.options.ecmaVersion < 10) {
        this.unexpected();
      }
      clause.param = null;
      this.enterScope(0);
    }
    clause.body = this.parseBlock(false);
    this.exitScope();
    node.handler = this.finishNode(clause, "CatchClause");
  }
  node.finalizer = this.eat(types$1._finally) ? this.parseBlock() : null;
  if (!node.handler && !node.finalizer) {
    this.raise(node.start, "Missing catch or finally clause");
  }
  return this.finishNode(node, "TryStatement");
};
pp$8.parseVarStatement = function(node, kind, allowMissingInitializer) {
  this.next();
  this.parseVar(node, false, kind, allowMissingInitializer);
  this.semicolon();
  return this.finishNode(node, "VariableDeclaration");
};
pp$8.parseWhileStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("while");
  this.labels.pop();
  return this.finishNode(node, "WhileStatement");
};
pp$8.parseWithStatement = function(node) {
  if (this.strict) {
    this.raise(this.start, "'with' in strict mode");
  }
  this.next();
  node.object = this.parseParenExpression();
  node.body = this.parseStatement("with");
  return this.finishNode(node, "WithStatement");
};
pp$8.parseEmptyStatement = function(node) {
  this.next();
  return this.finishNode(node, "EmptyStatement");
};
pp$8.parseLabeledStatement = function(node, maybeName, expr, context) {
  for (var i$1 = 0, list = this.labels; i$1 < list.length; i$1 += 1) {
    var label = list[i$1];
    if (label.name === maybeName) {
      this.raise(expr.start, "Label '" + maybeName + "' is already declared");
    }
  }
  var kind = this.type.isLoop ? "loop" : this.type === types$1._switch ? "switch" : null;
  for (var i = this.labels.length - 1; i >= 0; i--) {
    var label$1 = this.labels[i];
    if (label$1.statementStart === node.start) {
      label$1.statementStart = this.start;
      label$1.kind = kind;
    } else {
      break;
    }
  }
  this.labels.push({ name: maybeName, kind, statementStart: this.start });
  node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label");
  this.labels.pop();
  node.label = expr;
  return this.finishNode(node, "LabeledStatement");
};
pp$8.parseExpressionStatement = function(node, expr) {
  node.expression = expr;
  this.semicolon();
  return this.finishNode(node, "ExpressionStatement");
};
pp$8.parseBlock = function(createNewLexicalScope, node, exitStrict) {
  if (createNewLexicalScope === void 0) createNewLexicalScope = true;
  if (node === void 0) node = this.startNode();
  node.body = [];
  this.expect(types$1.braceL);
  if (createNewLexicalScope) {
    this.enterScope(0);
  }
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  if (exitStrict) {
    this.strict = false;
  }
  this.next();
  if (createNewLexicalScope) {
    this.exitScope();
  }
  return this.finishNode(node, "BlockStatement");
};
pp$8.parseFor = function(node, init) {
  node.init = init;
  this.expect(types$1.semi);
  node.test = this.type === types$1.semi ? null : this.parseExpression();
  this.expect(types$1.semi);
  node.update = this.type === types$1.parenR ? null : this.parseExpression();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, "ForStatement");
};
pp$8.parseForIn = function(node, init) {
  var isForIn = this.type === types$1._in;
  this.next();
  if (init.type === "VariableDeclaration" && init.declarations[0].init != null && (!isForIn || this.options.ecmaVersion < 8 || this.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")) {
    this.raise(
      init.start,
      (isForIn ? "for-in" : "for-of") + " loop variable declaration may not have an initializer"
    );
  }
  node.left = init;
  node.right = isForIn ? this.parseExpression() : this.parseMaybeAssign();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement");
};
pp$8.parseVar = function(node, isFor, kind, allowMissingInitializer) {
  node.declarations = [];
  node.kind = kind;
  for (; ; ) {
    var decl = this.startNode();
    this.parseVarId(decl, kind);
    if (this.eat(types$1.eq)) {
      decl.init = this.parseMaybeAssign(isFor);
    } else if (!allowMissingInitializer && kind === "const" && !(this.type === types$1._in || this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
      this.unexpected();
    } else if (!allowMissingInitializer && (kind === "using" || kind === "await using") && this.options.ecmaVersion >= 17 && this.type !== types$1._in && !this.isContextual("of")) {
      this.raise(this.lastTokEnd, "Missing initializer in " + kind + " declaration");
    } else if (!allowMissingInitializer && decl.id.type !== "Identifier" && !(isFor && (this.type === types$1._in || this.isContextual("of")))) {
      this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      decl.init = null;
    }
    node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
    if (!this.eat(types$1.comma)) {
      break;
    }
  }
  return node;
};
pp$8.parseVarId = function(decl, kind) {
  decl.id = kind === "using" || kind === "await using" ? this.parseIdent() : this.parseBindingAtom();
  this.checkLValPattern(decl.id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
};
var FUNC_STATEMENT = 1;
var FUNC_HANGING_STATEMENT = 2;
var FUNC_NULLABLE_ID = 4;
pp$8.parseFunction = function(node, statement, allowExpressionBody, isAsync, forInit) {
  this.initFunction(node);
  if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
    if (this.type === types$1.star && statement & FUNC_HANGING_STATEMENT) {
      this.unexpected();
    }
    node.generator = this.eat(types$1.star);
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  if (statement & FUNC_STATEMENT) {
    node.id = statement & FUNC_NULLABLE_ID && this.type !== types$1.name ? null : this.parseIdent();
    if (node.id && !(statement & FUNC_HANGING_STATEMENT)) {
      this.checkLValSimple(node.id, this.strict || node.generator || node.async ? this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL : BIND_FUNCTION);
    }
  }
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(node.async, node.generator));
  if (!(statement & FUNC_STATEMENT)) {
    node.id = this.type === types$1.name ? this.parseIdent() : null;
  }
  this.parseFunctionParams(node);
  this.parseFunctionBody(node, allowExpressionBody, false, forInit);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, statement & FUNC_STATEMENT ? "FunctionDeclaration" : "FunctionExpression");
};
pp$8.parseFunctionParams = function(node) {
  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
};
pp$8.parseClass = function(node, isStatement) {
  this.next();
  var oldStrict = this.strict;
  this.strict = true;
  this.parseClassId(node, isStatement);
  this.parseClassSuper(node);
  var privateNameMap = this.enterClassBody();
  var classBody = this.startNode();
  var hadConstructor = false;
  classBody.body = [];
  this.expect(types$1.braceL);
  while (this.type !== types$1.braceR) {
    var element = this.parseClassElement(node.superClass !== null);
    if (element) {
      classBody.body.push(element);
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) {
          this.raiseRecoverable(element.start, "Duplicate constructor in the same class");
        }
        hadConstructor = true;
      } else if (element.key && element.key.type === "PrivateIdentifier" && isPrivateNameConflicted(privateNameMap, element)) {
        this.raiseRecoverable(element.key.start, "Identifier '#" + element.key.name + "' has already been declared");
      }
    }
  }
  this.strict = oldStrict;
  this.next();
  node.body = this.finishNode(classBody, "ClassBody");
  this.exitClassBody();
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
};
pp$8.parseClassElement = function(constructorAllowsSuper) {
  if (this.eat(types$1.semi)) {
    return null;
  }
  var ecmaVersion = this.options.ecmaVersion;
  var node = this.startNode();
  var keyName = "";
  var isGenerator = false;
  var isAsync = false;
  var kind = "method";
  var isStatic = false;
  if (this.eatContextual("static")) {
    if (ecmaVersion >= 13 && this.eat(types$1.braceL)) {
      this.parseClassStaticBlock(node);
      return node;
    }
    if (this.isClassElementNameStart() || this.type === types$1.star) {
      isStatic = true;
    } else {
      keyName = "static";
    }
  }
  node.static = isStatic;
  if (!keyName && ecmaVersion >= 8 && this.eatContextual("async")) {
    if ((this.isClassElementNameStart() || this.type === types$1.star) && !this.canInsertSemicolon()) {
      isAsync = true;
    } else {
      keyName = "async";
    }
  }
  if (!keyName && (ecmaVersion >= 9 || !isAsync) && this.eat(types$1.star)) {
    isGenerator = true;
  }
  if (!keyName && !isAsync && !isGenerator) {
    var lastValue = this.value;
    if (this.eatContextual("get") || this.eatContextual("set")) {
      if (this.isClassElementNameStart()) {
        kind = lastValue;
      } else {
        keyName = lastValue;
      }
    }
  }
  if (keyName) {
    node.computed = false;
    node.key = this.startNodeAt(this.lastTokStart, this.lastTokStartLoc);
    node.key.name = keyName;
    this.finishNode(node.key, "Identifier");
  } else {
    this.parseClassElementName(node);
  }
  if (ecmaVersion < 13 || this.type === types$1.parenL || kind !== "method" || isGenerator || isAsync) {
    var isConstructor = !node.static && checkKeyName(node, "constructor");
    var allowsDirectSuper = isConstructor && constructorAllowsSuper;
    if (isConstructor && kind !== "method") {
      this.raise(node.key.start, "Constructor can't have get/set modifier");
    }
    node.kind = isConstructor ? "constructor" : kind;
    this.parseClassMethod(node, isGenerator, isAsync, allowsDirectSuper);
  } else {
    this.parseClassField(node);
  }
  return node;
};
pp$8.isClassElementNameStart = function() {
  return this.type === types$1.name || this.type === types$1.privateId || this.type === types$1.num || this.type === types$1.string || this.type === types$1.bracketL || this.type.keyword;
};
pp$8.parseClassElementName = function(element) {
  if (this.type === types$1.privateId) {
    if (this.value === "constructor") {
      this.raise(this.start, "Classes can't have an element named '#constructor'");
    }
    element.computed = false;
    element.key = this.parsePrivateIdent();
  } else {
    this.parsePropertyName(element);
  }
};
pp$8.parseClassMethod = function(method, isGenerator, isAsync, allowsDirectSuper) {
  var key = method.key;
  if (method.kind === "constructor") {
    if (isGenerator) {
      this.raise(key.start, "Constructor can't be a generator");
    }
    if (isAsync) {
      this.raise(key.start, "Constructor can't be an async method");
    }
  } else if (method.static && checkKeyName(method, "prototype")) {
    this.raise(key.start, "Classes may not have a static property named prototype");
  }
  var value = method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);
  if (method.kind === "get" && value.params.length !== 0) {
    this.raiseRecoverable(value.start, "getter should have no params");
  }
  if (method.kind === "set" && value.params.length !== 1) {
    this.raiseRecoverable(value.start, "setter should have exactly one param");
  }
  if (method.kind === "set" && value.params[0].type === "RestElement") {
    this.raiseRecoverable(value.params[0].start, "Setter cannot use rest params");
  }
  return this.finishNode(method, "MethodDefinition");
};
pp$8.parseClassField = function(field) {
  if (checkKeyName(field, "constructor")) {
    this.raise(field.key.start, "Classes can't have a field named 'constructor'");
  } else if (field.static && checkKeyName(field, "prototype")) {
    this.raise(field.key.start, "Classes can't have a static field named 'prototype'");
  }
  if (this.eat(types$1.eq)) {
    this.enterScope(SCOPE_CLASS_FIELD_INIT | SCOPE_SUPER);
    field.value = this.parseMaybeAssign();
    this.exitScope();
  } else {
    field.value = null;
  }
  this.semicolon();
  return this.finishNode(field, "PropertyDefinition");
};
pp$8.parseClassStaticBlock = function(node) {
  node.body = [];
  var oldLabels = this.labels;
  this.labels = [];
  this.enterScope(SCOPE_CLASS_STATIC_BLOCK | SCOPE_SUPER);
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  this.next();
  this.exitScope();
  this.labels = oldLabels;
  return this.finishNode(node, "StaticBlock");
};
pp$8.parseClassId = function(node, isStatement) {
  if (this.type === types$1.name) {
    node.id = this.parseIdent();
    if (isStatement) {
      this.checkLValSimple(node.id, BIND_LEXICAL, false);
    }
  } else {
    if (isStatement === true) {
      this.unexpected();
    }
    node.id = null;
  }
};
pp$8.parseClassSuper = function(node) {
  node.superClass = this.eat(types$1._extends) ? this.parseExprSubscripts(null, false) : null;
};
pp$8.enterClassBody = function() {
  var element = { declared: /* @__PURE__ */ Object.create(null), used: [] };
  this.privateNameStack.push(element);
  return element.declared;
};
pp$8.exitClassBody = function() {
  var ref2 = this.privateNameStack.pop();
  var declared = ref2.declared;
  var used = ref2.used;
  if (!this.options.checkPrivateFields) {
    return;
  }
  var len = this.privateNameStack.length;
  var parent = len === 0 ? null : this.privateNameStack[len - 1];
  for (var i = 0; i < used.length; ++i) {
    var id2 = used[i];
    if (!hasOwn(declared, id2.name)) {
      if (parent) {
        parent.used.push(id2);
      } else {
        this.raiseRecoverable(id2.start, "Private field '#" + id2.name + "' must be declared in an enclosing class");
      }
    }
  }
};
function isPrivateNameConflicted(privateNameMap, element) {
  var name = element.key.name;
  var curr = privateNameMap[name];
  var next = "true";
  if (element.type === "MethodDefinition" && (element.kind === "get" || element.kind === "set")) {
    next = (element.static ? "s" : "i") + element.kind;
  }
  if (curr === "iget" && next === "iset" || curr === "iset" && next === "iget" || curr === "sget" && next === "sset" || curr === "sset" && next === "sget") {
    privateNameMap[name] = "true";
    return false;
  } else if (!curr) {
    privateNameMap[name] = next;
    return false;
  } else {
    return true;
  }
}
function checkKeyName(node, name) {
  var computed = node.computed;
  var key = node.key;
  return !computed && (key.type === "Identifier" && key.name === name || key.type === "Literal" && key.value === name);
}
pp$8.parseExportAllDeclaration = function(node, exports$1) {
  if (this.options.ecmaVersion >= 11) {
    if (this.eatContextual("as")) {
      node.exported = this.parseModuleExportName();
      this.checkExport(exports$1, node.exported, this.lastTokStart);
    } else {
      node.exported = null;
    }
  }
  this.expectContextual("from");
  if (this.type !== types$1.string) {
    this.unexpected();
  }
  node.source = this.parseExprAtom();
  if (this.options.ecmaVersion >= 16) {
    node.attributes = this.parseWithClause();
  }
  this.semicolon();
  return this.finishNode(node, "ExportAllDeclaration");
};
pp$8.parseExport = function(node, exports$1) {
  this.next();
  if (this.eat(types$1.star)) {
    return this.parseExportAllDeclaration(node, exports$1);
  }
  if (this.eat(types$1._default)) {
    this.checkExport(exports$1, "default", this.lastTokStart);
    node.declaration = this.parseExportDefaultDeclaration();
    return this.finishNode(node, "ExportDefaultDeclaration");
  }
  if (this.shouldParseExportStatement()) {
    node.declaration = this.parseExportDeclaration(node);
    if (node.declaration.type === "VariableDeclaration") {
      this.checkVariableExport(exports$1, node.declaration.declarations);
    } else {
      this.checkExport(exports$1, node.declaration.id, node.declaration.id.start);
    }
    node.specifiers = [];
    node.source = null;
    if (this.options.ecmaVersion >= 16) {
      node.attributes = [];
    }
  } else {
    node.declaration = null;
    node.specifiers = this.parseExportSpecifiers(exports$1);
    if (this.eatContextual("from")) {
      if (this.type !== types$1.string) {
        this.unexpected();
      }
      node.source = this.parseExprAtom();
      if (this.options.ecmaVersion >= 16) {
        node.attributes = this.parseWithClause();
      }
    } else {
      for (var i = 0, list = node.specifiers; i < list.length; i += 1) {
        var spec = list[i];
        this.checkUnreserved(spec.local);
        this.checkLocalExport(spec.local);
        if (spec.local.type === "Literal") {
          this.raise(spec.local.start, "A string literal cannot be used as an exported binding without `from`.");
        }
      }
      node.source = null;
      if (this.options.ecmaVersion >= 16) {
        node.attributes = [];
      }
    }
    this.semicolon();
  }
  return this.finishNode(node, "ExportNamedDeclaration");
};
pp$8.parseExportDeclaration = function(node) {
  return this.parseStatement(null);
};
pp$8.parseExportDefaultDeclaration = function() {
  var isAsync;
  if (this.type === types$1._function || (isAsync = this.isAsyncFunction())) {
    var fNode = this.startNode();
    this.next();
    if (isAsync) {
      this.next();
    }
    return this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
  } else if (this.type === types$1._class) {
    var cNode = this.startNode();
    return this.parseClass(cNode, "nullableID");
  } else {
    var declaration = this.parseMaybeAssign();
    this.semicolon();
    return declaration;
  }
};
pp$8.checkExport = function(exports$1, name, pos) {
  if (!exports$1) {
    return;
  }
  if (typeof name !== "string") {
    name = name.type === "Identifier" ? name.name : name.value;
  }
  if (hasOwn(exports$1, name)) {
    this.raiseRecoverable(pos, "Duplicate export '" + name + "'");
  }
  exports$1[name] = true;
};
pp$8.checkPatternExport = function(exports$1, pat) {
  var type = pat.type;
  if (type === "Identifier") {
    this.checkExport(exports$1, pat, pat.start);
  } else if (type === "ObjectPattern") {
    for (var i = 0, list = pat.properties; i < list.length; i += 1) {
      var prop = list[i];
      this.checkPatternExport(exports$1, prop);
    }
  } else if (type === "ArrayPattern") {
    for (var i$1 = 0, list$1 = pat.elements; i$1 < list$1.length; i$1 += 1) {
      var elt = list$1[i$1];
      if (elt) {
        this.checkPatternExport(exports$1, elt);
      }
    }
  } else if (type === "Property") {
    this.checkPatternExport(exports$1, pat.value);
  } else if (type === "AssignmentPattern") {
    this.checkPatternExport(exports$1, pat.left);
  } else if (type === "RestElement") {
    this.checkPatternExport(exports$1, pat.argument);
  }
};
pp$8.checkVariableExport = function(exports$1, decls) {
  if (!exports$1) {
    return;
  }
  for (var i = 0, list = decls; i < list.length; i += 1) {
    var decl = list[i];
    this.checkPatternExport(exports$1, decl.id);
  }
};
pp$8.shouldParseExportStatement = function() {
  return this.type.keyword === "var" || this.type.keyword === "const" || this.type.keyword === "class" || this.type.keyword === "function" || this.isLet() || this.isAsyncFunction();
};
pp$8.parseExportSpecifier = function(exports$1) {
  var node = this.startNode();
  node.local = this.parseModuleExportName();
  node.exported = this.eatContextual("as") ? this.parseModuleExportName() : node.local;
  this.checkExport(
    exports$1,
    node.exported,
    node.exported.start
  );
  return this.finishNode(node, "ExportSpecifier");
};
pp$8.parseExportSpecifiers = function(exports$1) {
  var nodes = [], first = true;
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    nodes.push(this.parseExportSpecifier(exports$1));
  }
  return nodes;
};
pp$8.parseImport = function(node) {
  this.next();
  if (this.type === types$1.string) {
    node.specifiers = empty$1;
    node.source = this.parseExprAtom();
  } else {
    node.specifiers = this.parseImportSpecifiers();
    this.expectContextual("from");
    node.source = this.type === types$1.string ? this.parseExprAtom() : this.unexpected();
  }
  if (this.options.ecmaVersion >= 16) {
    node.attributes = this.parseWithClause();
  }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration");
};
pp$8.parseImportSpecifier = function() {
  var node = this.startNode();
  node.imported = this.parseModuleExportName();
  if (this.eatContextual("as")) {
    node.local = this.parseIdent();
  } else {
    this.checkUnreserved(node.imported);
    node.local = node.imported;
  }
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportSpecifier");
};
pp$8.parseImportDefaultSpecifier = function() {
  var node = this.startNode();
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportDefaultSpecifier");
};
pp$8.parseImportNamespaceSpecifier = function() {
  var node = this.startNode();
  this.next();
  this.expectContextual("as");
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportNamespaceSpecifier");
};
pp$8.parseImportSpecifiers = function() {
  var nodes = [], first = true;
  if (this.type === types$1.name) {
    nodes.push(this.parseImportDefaultSpecifier());
    if (!this.eat(types$1.comma)) {
      return nodes;
    }
  }
  if (this.type === types$1.star) {
    nodes.push(this.parseImportNamespaceSpecifier());
    return nodes;
  }
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    nodes.push(this.parseImportSpecifier());
  }
  return nodes;
};
pp$8.parseWithClause = function() {
  var nodes = [];
  if (!this.eat(types$1._with)) {
    return nodes;
  }
  this.expect(types$1.braceL);
  var attributeKeys = {};
  var first = true;
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    var attr = this.parseImportAttribute();
    var keyName = attr.key.type === "Identifier" ? attr.key.name : attr.key.value;
    if (hasOwn(attributeKeys, keyName)) {
      this.raiseRecoverable(attr.key.start, "Duplicate attribute key '" + keyName + "'");
    }
    attributeKeys[keyName] = true;
    nodes.push(attr);
  }
  return nodes;
};
pp$8.parseImportAttribute = function() {
  var node = this.startNode();
  node.key = this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
  this.expect(types$1.colon);
  if (this.type !== types$1.string) {
    this.unexpected();
  }
  node.value = this.parseExprAtom();
  return this.finishNode(node, "ImportAttribute");
};
pp$8.parseModuleExportName = function() {
  if (this.options.ecmaVersion >= 13 && this.type === types$1.string) {
    var stringLiteral = this.parseLiteral(this.value);
    if (loneSurrogate.test(stringLiteral.value)) {
      this.raise(stringLiteral.start, "An export name cannot include a lone surrogate.");
    }
    return stringLiteral;
  }
  return this.parseIdent(true);
};
pp$8.adaptDirectivePrologue = function(statements) {
  for (var i = 0; i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
    statements[i].directive = statements[i].expression.raw.slice(1, -1);
  }
};
pp$8.isDirectiveCandidate = function(statement) {
  return this.options.ecmaVersion >= 5 && statement.type === "ExpressionStatement" && statement.expression.type === "Literal" && typeof statement.expression.value === "string" && // Reject parenthesized strings.
  (this.input[statement.start] === '"' || this.input[statement.start] === "'");
};
var pp$7 = Parser.prototype;
pp$7.toAssignable = function(node, isBinding, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 6 && node) {
    switch (node.type) {
      case "Identifier":
        if (this.inAsync && node.name === "await") {
          this.raise(node.start, "Cannot use 'await' as identifier inside an async function");
        }
        break;
      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
        break;
      case "ObjectExpression":
        node.type = "ObjectPattern";
        if (refDestructuringErrors) {
          this.checkPatternErrors(refDestructuringErrors, true);
        }
        for (var i = 0, list = node.properties; i < list.length; i += 1) {
          var prop = list[i];
          this.toAssignable(prop, isBinding);
          if (prop.type === "RestElement" && (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")) {
            this.raise(prop.argument.start, "Unexpected token");
          }
        }
        break;
      case "Property":
        if (node.kind !== "init") {
          this.raise(node.key.start, "Object pattern can't contain getter or setter");
        }
        this.toAssignable(node.value, isBinding);
        break;
      case "ArrayExpression":
        node.type = "ArrayPattern";
        if (refDestructuringErrors) {
          this.checkPatternErrors(refDestructuringErrors, true);
        }
        this.toAssignableList(node.elements, isBinding);
        break;
      case "SpreadElement":
        node.type = "RestElement";
        this.toAssignable(node.argument, isBinding);
        if (node.argument.type === "AssignmentPattern") {
          this.raise(node.argument.start, "Rest elements cannot have a default value");
        }
        break;
      case "AssignmentExpression":
        if (node.operator !== "=") {
          this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
        }
        node.type = "AssignmentPattern";
        delete node.operator;
        this.toAssignable(node.left, isBinding);
        break;
      case "ParenthesizedExpression":
        this.toAssignable(node.expression, isBinding, refDestructuringErrors);
        break;
      case "ChainExpression":
        this.raiseRecoverable(node.start, "Optional chaining cannot appear in left-hand side");
        break;
      case "MemberExpression":
        if (!isBinding) {
          break;
        }
      default:
        this.raise(node.start, "Assigning to rvalue");
    }
  } else if (refDestructuringErrors) {
    this.checkPatternErrors(refDestructuringErrors, true);
  }
  return node;
};
pp$7.toAssignableList = function(exprList, isBinding) {
  var end = exprList.length;
  for (var i = 0; i < end; i++) {
    var elt = exprList[i];
    if (elt) {
      this.toAssignable(elt, isBinding);
    }
  }
  if (end) {
    var last = exprList[end - 1];
    if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier") {
      this.unexpected(last.argument.start);
    }
  }
  return exprList;
};
pp$7.parseSpread = function(refDestructuringErrors) {
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeAssign(false, refDestructuringErrors);
  return this.finishNode(node, "SpreadElement");
};
pp$7.parseRestBinding = function() {
  var node = this.startNode();
  this.next();
  if (this.options.ecmaVersion === 6 && this.type !== types$1.name) {
    this.unexpected();
  }
  node.argument = this.parseBindingAtom();
  return this.finishNode(node, "RestElement");
};
pp$7.parseBindingAtom = function() {
  if (this.options.ecmaVersion >= 6) {
    switch (this.type) {
      case types$1.bracketL:
        var node = this.startNode();
        this.next();
        node.elements = this.parseBindingList(types$1.bracketR, true, true);
        return this.finishNode(node, "ArrayPattern");
      case types$1.braceL:
        return this.parseObj(true);
    }
  }
  return this.parseIdent();
};
pp$7.parseBindingList = function(close, allowEmpty, allowTrailingComma, allowModifiers) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (first) {
      first = false;
    } else {
      this.expect(types$1.comma);
    }
    if (allowEmpty && this.type === types$1.comma) {
      elts.push(null);
    } else if (allowTrailingComma && this.afterTrailingComma(close)) {
      break;
    } else if (this.type === types$1.ellipsis) {
      var rest = this.parseRestBinding();
      this.parseBindingListItem(rest);
      elts.push(rest);
      if (this.type === types$1.comma) {
        this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
      }
      this.expect(close);
      break;
    } else {
      elts.push(this.parseAssignableListItem(allowModifiers));
    }
  }
  return elts;
};
pp$7.parseAssignableListItem = function(allowModifiers) {
  var elem = this.parseMaybeDefault(this.start, this.startLoc);
  this.parseBindingListItem(elem);
  return elem;
};
pp$7.parseBindingListItem = function(param) {
  return param;
};
pp$7.parseMaybeDefault = function(startPos, startLoc, left) {
  left = left || this.parseBindingAtom();
  if (this.options.ecmaVersion < 6 || !this.eat(types$1.eq)) {
    return left;
  }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.right = this.parseMaybeAssign();
  return this.finishNode(node, "AssignmentPattern");
};
pp$7.checkLValSimple = function(expr, bindingType, checkClashes) {
  if (bindingType === void 0) bindingType = BIND_NONE;
  var isBind = bindingType !== BIND_NONE;
  switch (expr.type) {
    case "Identifier":
      if (this.strict && this.reservedWordsStrictBind.test(expr.name)) {
        this.raiseRecoverable(expr.start, (isBind ? "Binding " : "Assigning to ") + expr.name + " in strict mode");
      }
      if (isBind) {
        if (bindingType === BIND_LEXICAL && expr.name === "let") {
          this.raiseRecoverable(expr.start, "let is disallowed as a lexically bound name");
        }
        if (checkClashes) {
          if (hasOwn(checkClashes, expr.name)) {
            this.raiseRecoverable(expr.start, "Argument name clash");
          }
          checkClashes[expr.name] = true;
        }
        if (bindingType !== BIND_OUTSIDE) {
          this.declareName(expr.name, bindingType, expr.start);
        }
      }
      break;
    case "ChainExpression":
      this.raiseRecoverable(expr.start, "Optional chaining cannot appear in left-hand side");
      break;
    case "MemberExpression":
      if (isBind) {
        this.raiseRecoverable(expr.start, "Binding member expression");
      }
      break;
    case "ParenthesizedExpression":
      if (isBind) {
        this.raiseRecoverable(expr.start, "Binding parenthesized expression");
      }
      return this.checkLValSimple(expr.expression, bindingType, checkClashes);
    default:
      this.raise(expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue");
  }
};
pp$7.checkLValPattern = function(expr, bindingType, checkClashes) {
  if (bindingType === void 0) bindingType = BIND_NONE;
  switch (expr.type) {
    case "ObjectPattern":
      for (var i = 0, list = expr.properties; i < list.length; i += 1) {
        var prop = list[i];
        this.checkLValInnerPattern(prop, bindingType, checkClashes);
      }
      break;
    case "ArrayPattern":
      for (var i$1 = 0, list$1 = expr.elements; i$1 < list$1.length; i$1 += 1) {
        var elem = list$1[i$1];
        if (elem) {
          this.checkLValInnerPattern(elem, bindingType, checkClashes);
        }
      }
      break;
    default:
      this.checkLValSimple(expr, bindingType, checkClashes);
  }
};
pp$7.checkLValInnerPattern = function(expr, bindingType, checkClashes) {
  if (bindingType === void 0) bindingType = BIND_NONE;
  switch (expr.type) {
    case "Property":
      this.checkLValInnerPattern(expr.value, bindingType, checkClashes);
      break;
    case "AssignmentPattern":
      this.checkLValPattern(expr.left, bindingType, checkClashes);
      break;
    case "RestElement":
      this.checkLValPattern(expr.argument, bindingType, checkClashes);
      break;
    default:
      this.checkLValPattern(expr, bindingType, checkClashes);
  }
};
var TokContext = function TokContext2(token, isExpr, preserveSpace, override, generator) {
  this.token = token;
  this.isExpr = !!isExpr;
  this.preserveSpace = !!preserveSpace;
  this.override = override;
  this.generator = !!generator;
};
var types = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, function(p) {
    return p.tryReadTemplateToken();
  }),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true)
};
var pp$6 = Parser.prototype;
pp$6.initialContext = function() {
  return [types.b_stat];
};
pp$6.curContext = function() {
  return this.context[this.context.length - 1];
};
pp$6.braceIsBlock = function(prevType) {
  var parent = this.curContext();
  if (parent === types.f_expr || parent === types.f_stat) {
    return true;
  }
  if (prevType === types$1.colon && (parent === types.b_stat || parent === types.b_expr)) {
    return !parent.isExpr;
  }
  if (prevType === types$1._return || prevType === types$1.name && this.exprAllowed) {
    return lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
  }
  if (prevType === types$1._else || prevType === types$1.semi || prevType === types$1.eof || prevType === types$1.parenR || prevType === types$1.arrow) {
    return true;
  }
  if (prevType === types$1.braceL) {
    return parent === types.b_stat;
  }
  if (prevType === types$1._var || prevType === types$1._const || prevType === types$1.name) {
    return false;
  }
  return !this.exprAllowed;
};
pp$6.inGeneratorContext = function() {
  for (var i = this.context.length - 1; i >= 1; i--) {
    var context = this.context[i];
    if (context.token === "function") {
      return context.generator;
    }
  }
  return false;
};
pp$6.updateContext = function(prevType) {
  var update, type = this.type;
  if (type.keyword && prevType === types$1.dot) {
    this.exprAllowed = false;
  } else if (update = type.updateContext) {
    update.call(this, prevType);
  } else {
    this.exprAllowed = type.beforeExpr;
  }
};
pp$6.overrideContext = function(tokenCtx) {
  if (this.curContext() !== tokenCtx) {
    this.context[this.context.length - 1] = tokenCtx;
  }
};
types$1.parenR.updateContext = types$1.braceR.updateContext = function() {
  if (this.context.length === 1) {
    this.exprAllowed = true;
    return;
  }
  var out = this.context.pop();
  if (out === types.b_stat && this.curContext().token === "function") {
    out = this.context.pop();
  }
  this.exprAllowed = !out.isExpr;
};
types$1.braceL.updateContext = function(prevType) {
  this.context.push(this.braceIsBlock(prevType) ? types.b_stat : types.b_expr);
  this.exprAllowed = true;
};
types$1.dollarBraceL.updateContext = function() {
  this.context.push(types.b_tmpl);
  this.exprAllowed = true;
};
types$1.parenL.updateContext = function(prevType) {
  var statementParens = prevType === types$1._if || prevType === types$1._for || prevType === types$1._with || prevType === types$1._while;
  this.context.push(statementParens ? types.p_stat : types.p_expr);
  this.exprAllowed = true;
};
types$1.incDec.updateContext = function() {
};
types$1._function.updateContext = types$1._class.updateContext = function(prevType) {
  if (prevType.beforeExpr && prevType !== types$1._else && !(prevType === types$1.semi && this.curContext() !== types.p_stat) && !(prevType === types$1._return && lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) && !((prevType === types$1.colon || prevType === types$1.braceL) && this.curContext() === types.b_stat)) {
    this.context.push(types.f_expr);
  } else {
    this.context.push(types.f_stat);
  }
  this.exprAllowed = false;
};
types$1.colon.updateContext = function() {
  if (this.curContext().token === "function") {
    this.context.pop();
  }
  this.exprAllowed = true;
};
types$1.backQuote.updateContext = function() {
  if (this.curContext() === types.q_tmpl) {
    this.context.pop();
  } else {
    this.context.push(types.q_tmpl);
  }
  this.exprAllowed = false;
};
types$1.star.updateContext = function(prevType) {
  if (prevType === types$1._function) {
    var index = this.context.length - 1;
    if (this.context[index] === types.f_expr) {
      this.context[index] = types.f_expr_gen;
    } else {
      this.context[index] = types.f_gen;
    }
  }
  this.exprAllowed = true;
};
types$1.name.updateContext = function(prevType) {
  var allowed = false;
  if (this.options.ecmaVersion >= 6 && prevType !== types$1.dot) {
    if (this.value === "of" && !this.exprAllowed || this.value === "yield" && this.inGeneratorContext()) {
      allowed = true;
    }
  }
  this.exprAllowed = allowed;
};
var pp$5 = Parser.prototype;
pp$5.checkPropClash = function(prop, propHash, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement") {
    return;
  }
  if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand)) {
    return;
  }
  var key = prop.key;
  var name;
  switch (key.type) {
    case "Identifier":
      name = key.name;
      break;
    case "Literal":
      name = String(key.value);
      break;
    default:
      return;
  }
  var kind = prop.kind;
  if (this.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors) {
          if (refDestructuringErrors.doubleProto < 0) {
            refDestructuringErrors.doubleProto = key.start;
          }
        } else {
          this.raiseRecoverable(key.start, "Redefinition of __proto__ property");
        }
      }
      propHash.proto = true;
    }
    return;
  }
  name = "$" + name;
  var other = propHash[name];
  if (other) {
    var redefinition;
    if (kind === "init") {
      redefinition = this.strict && other.init || other.get || other.set;
    } else {
      redefinition = other.init || other[kind];
    }
    if (redefinition) {
      this.raiseRecoverable(key.start, "Redefinition of property");
    }
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false
    };
  }
  other[kind] = true;
};
pp$5.parseExpression = function(forInit, refDestructuringErrors) {
  var this$1$1 = this;
  return this.catchStackOverflow(function() {
    var startPos = this$1$1.start, startLoc = this$1$1.startLoc;
    var expr = this$1$1.parseMaybeAssign(forInit, refDestructuringErrors);
    if (this$1$1.type === types$1.comma) {
      var node = this$1$1.startNodeAt(startPos, startLoc);
      node.expressions = [expr];
      while (this$1$1.eat(types$1.comma)) {
        node.expressions.push(this$1$1.parseMaybeAssign(forInit, refDestructuringErrors));
      }
      return this$1$1.finishNode(node, "SequenceExpression");
    }
    return expr;
  });
};
pp$5.parseMaybeAssign = function(forInit, refDestructuringErrors, afterLeftParse) {
  if (this.isContextual("yield")) {
    if (this.inGenerator) {
      return this.parseYield(forInit);
    } else {
      this.exprAllowed = false;
    }
  }
  var ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldDoubleProto = -1;
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign;
    oldTrailingComma = refDestructuringErrors.trailingComma;
    oldDoubleProto = refDestructuringErrors.doubleProto;
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
  } else {
    refDestructuringErrors = new DestructuringErrors();
    ownDestructuringErrors = true;
  }
  var startPos = this.start, startLoc = this.startLoc;
  if (this.type === types$1.parenL || this.type === types$1.name) {
    this.potentialArrowAt = this.start;
    this.potentialArrowInForAwait = forInit === "await";
  }
  var left = this.parseMaybeConditional(forInit, refDestructuringErrors);
  if (afterLeftParse) {
    left = afterLeftParse.call(this, left, startPos, startLoc);
  }
  if (this.type.isAssign) {
    var node = this.startNodeAt(startPos, startLoc);
    node.operator = this.value;
    if (this.type === types$1.eq) {
      left = this.toAssignable(left, false, refDestructuringErrors);
    }
    if (!ownDestructuringErrors) {
      refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = refDestructuringErrors.doubleProto = -1;
    }
    if (refDestructuringErrors.shorthandAssign >= left.start) {
      refDestructuringErrors.shorthandAssign = -1;
    }
    if (this.type === types$1.eq) {
      this.checkLValPattern(left);
    } else {
      this.checkLValSimple(left);
    }
    node.left = left;
    this.next();
    node.right = this.parseMaybeAssign(forInit);
    if (oldDoubleProto > -1) {
      refDestructuringErrors.doubleProto = oldDoubleProto;
    }
    return this.finishNode(node, "AssignmentExpression");
  } else {
    if (ownDestructuringErrors) {
      this.checkExpressionErrors(refDestructuringErrors, true);
    }
  }
  if (oldParenAssign > -1) {
    refDestructuringErrors.parenthesizedAssign = oldParenAssign;
  }
  if (oldTrailingComma > -1) {
    refDestructuringErrors.trailingComma = oldTrailingComma;
  }
  return left;
};
pp$5.parseMaybeConditional = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprOps(forInit, refDestructuringErrors);
  if (this.checkExpressionErrors(refDestructuringErrors)) {
    return expr;
  }
  if (!(expr.type === "ArrowFunctionExpression" && expr.start === startPos) && this.eat(types$1.question)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    this.expect(types$1.colon);
    node.alternate = this.parseMaybeAssign(forInit);
    return this.finishNode(node, "ConditionalExpression");
  }
  return expr;
};
pp$5.parseExprOps = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseMaybeUnary(refDestructuringErrors, false, false, forInit);
  if (this.checkExpressionErrors(refDestructuringErrors)) {
    return expr;
  }
  return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, forInit);
};
pp$5.parseExprOp = function(left, leftStartPos, leftStartLoc, minPrec, forInit) {
  var prec = this.type.binop;
  if (prec != null && (!forInit || this.type !== types$1._in)) {
    if (prec > minPrec) {
      var logical = this.type === types$1.logicalOR || this.type === types$1.logicalAND;
      var coalesce = this.type === types$1.coalesce;
      if (coalesce) {
        prec = types$1.logicalAND.binop;
      }
      var op = this.value;
      this.next();
      var startPos = this.start, startLoc = this.startLoc;
      var right = this.parseExprOp(this.parseMaybeUnary(null, false, false, forInit), startPos, startLoc, prec, forInit);
      var node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical || coalesce);
      if (logical && this.type === types$1.coalesce || coalesce && (this.type === types$1.logicalOR || this.type === types$1.logicalAND)) {
        this.raiseRecoverable(this.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
      }
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, forInit);
    }
  }
  return left;
};
pp$5.buildBinary = function(startPos, startLoc, left, right, op, logical) {
  if (right.type === "PrivateIdentifier") {
    this.raise(right.start, "Private identifier can only be left side of binary expression");
  }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.operator = op;
  node.right = right;
  return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression");
};
pp$5.parseMaybeUnary = function(refDestructuringErrors, sawUnary, incDec, forInit) {
  var startPos = this.start, startLoc = this.startLoc, expr;
  if (this.isContextual("await") && this.canAwait) {
    expr = this.parseAwait(forInit);
    sawUnary = true;
  } else if (this.type.prefix) {
    var node = this.startNode(), update = this.type === types$1.incDec;
    node.operator = this.value;
    node.prefix = true;
    this.next();
    node.argument = this.parseMaybeUnary(null, true, update, forInit);
    this.checkExpressionErrors(refDestructuringErrors, true);
    if (update) {
      this.checkLValSimple(node.argument);
    } else if (this.strict && node.operator === "delete" && isLocalVariableAccess(node.argument)) {
      this.raiseRecoverable(node.start, "Deleting local variable in strict mode");
    } else if (node.operator === "delete" && isPrivateFieldAccess(node.argument)) {
      this.raiseRecoverable(node.start, "Private fields can not be deleted");
    } else {
      sawUnary = true;
    }
    expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  } else if (!sawUnary && this.type === types$1.privateId) {
    if ((forInit || this.privateNameStack.length === 0) && this.options.checkPrivateFields) {
      this.unexpected();
    }
    expr = this.parsePrivateIdent();
    if (this.type !== types$1._in) {
      this.unexpected();
    }
  } else {
    expr = this.parseExprSubscripts(refDestructuringErrors, forInit);
    if (this.checkExpressionErrors(refDestructuringErrors)) {
      return expr;
    }
    while (this.type.postfix && !this.canInsertSemicolon()) {
      var node$1 = this.startNodeAt(startPos, startLoc);
      node$1.operator = this.value;
      node$1.prefix = false;
      node$1.argument = expr;
      this.checkLValSimple(expr);
      this.next();
      expr = this.finishNode(node$1, "UpdateExpression");
    }
  }
  if (!incDec && !(expr.type === "ArrowFunctionExpression" && expr.start === startPos) && this.eat(types$1.starstar)) {
    if (sawUnary) {
      this.unexpected(this.lastTokStart);
    } else {
      return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false, false, forInit), "**", false);
    }
  } else {
    return expr;
  }
};
function isLocalVariableAccess(node) {
  return node.type === "Identifier" || node.type === "ParenthesizedExpression" && isLocalVariableAccess(node.expression);
}
function isPrivateFieldAccess(node) {
  return node.type === "MemberExpression" && node.property.type === "PrivateIdentifier" || node.type === "ChainExpression" && isPrivateFieldAccess(node.expression) || node.type === "ParenthesizedExpression" && isPrivateFieldAccess(node.expression);
}
pp$5.parseExprSubscripts = function(refDestructuringErrors, forInit) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprAtom(refDestructuringErrors, forInit);
  if (expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")") {
    return expr;
  }
  var result = this.parseSubscripts(expr, startPos, startLoc, false, forInit);
  if (refDestructuringErrors && result.type === "MemberExpression") {
    if (refDestructuringErrors.parenthesizedAssign >= result.start) {
      refDestructuringErrors.parenthesizedAssign = -1;
    }
    if (refDestructuringErrors.parenthesizedBind >= result.start) {
      refDestructuringErrors.parenthesizedBind = -1;
    }
    if (refDestructuringErrors.trailingComma >= result.start) {
      refDestructuringErrors.trailingComma = -1;
    }
  }
  return result;
};
pp$5.parseSubscripts = function(base, startPos, startLoc, noCalls, forInit) {
  var maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" && this.lastTokEnd === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 && this.potentialArrowAt === base.start;
  var optionalChained = false;
  while (true) {
    var element = this.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit);
    if (element.optional) {
      optionalChained = true;
    }
    if (element === base || element.type === "ArrowFunctionExpression") {
      if (optionalChained) {
        var chainNode = this.startNodeAt(startPos, startLoc);
        chainNode.expression = element;
        element = this.finishNode(chainNode, "ChainExpression");
      }
      return element;
    }
    base = element;
  }
};
pp$5.shouldParseAsyncArrow = function() {
  return !this.canInsertSemicolon() && this.eat(types$1.arrow);
};
pp$5.parseSubscriptAsyncArrow = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true, forInit);
};
pp$5.parseSubscript = function(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit) {
  var optionalSupported = this.options.ecmaVersion >= 11;
  var optional = optionalSupported && this.eat(types$1.questionDot);
  if (noCalls && optional) {
    this.raise(this.lastTokStart, "Optional chaining cannot appear in the callee of new expressions");
  }
  var computed = this.eat(types$1.bracketL);
  if (computed || optional && this.type !== types$1.parenL && this.type !== types$1.backQuote || this.eat(types$1.dot)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.object = base;
    if (computed) {
      node.property = this.parseExpression();
      this.expect(types$1.bracketR);
    } else if (this.type === types$1.privateId && base.type !== "Super") {
      node.property = this.parsePrivateIdent();
    } else {
      node.property = this.parseIdent(this.options.allowReserved !== "never");
    }
    node.computed = !!computed;
    if (optionalSupported) {
      node.optional = optional;
    }
    base = this.finishNode(node, "MemberExpression");
  } else if (!noCalls && this.eat(types$1.parenL)) {
    var refDestructuringErrors = new DestructuringErrors(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    var exprList = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false, refDestructuringErrors);
    if (maybeAsyncArrow && !optional && this.shouldParseAsyncArrow()) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      if (this.awaitIdentPos > 0) {
        this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function");
      }
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.parseSubscriptAsyncArrow(startPos, startLoc, exprList, forInit);
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
    var node$1 = this.startNodeAt(startPos, startLoc);
    node$1.callee = base;
    node$1.arguments = exprList;
    if (optionalSupported) {
      node$1.optional = optional;
    }
    base = this.finishNode(node$1, "CallExpression");
  } else if (this.type === types$1.backQuote) {
    if (optional || optionalChained) {
      this.raise(this.start, "Optional chaining cannot appear in the tag of tagged template expressions");
    }
    var node$2 = this.startNodeAt(startPos, startLoc);
    node$2.tag = base;
    node$2.quasi = this.parseTemplate({ isTagged: true });
    base = this.finishNode(node$2, "TaggedTemplateExpression");
  }
  return base;
};
pp$5.parseExprAtom = function(refDestructuringErrors, forInit, forNew) {
  if (this.type === types$1.slash) {
    this.readRegexp();
  }
  var node, canBeArrow = this.potentialArrowAt === this.start;
  switch (this.type) {
    case types$1._super:
      if (!this.allowSuper) {
        this.raise(this.start, "'super' keyword outside a method");
      }
      node = this.startNode();
      this.next();
      if (this.type === types$1.parenL && !this.allowDirectSuper) {
        this.raise(node.start, "super() call outside constructor of a subclass");
      }
      if (this.type !== types$1.dot && this.type !== types$1.bracketL && this.type !== types$1.parenL) {
        this.unexpected();
      }
      return this.finishNode(node, "Super");
    case types$1._this:
      node = this.startNode();
      this.next();
      return this.finishNode(node, "ThisExpression");
    case types$1.name:
      var startPos = this.start, startLoc = this.startLoc, containsEsc = this.containsEsc;
      var id2 = this.parseIdent(false);
      if (this.options.ecmaVersion >= 8 && !containsEsc && id2.name === "async" && !this.canInsertSemicolon() && this.eat(types$1._function)) {
        this.overrideContext(types.f_expr);
        return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true, forInit);
      }
      if (canBeArrow && !this.canInsertSemicolon()) {
        if (this.eat(types$1.arrow)) {
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id2], false, forInit);
        }
        if (this.options.ecmaVersion >= 8 && id2.name === "async" && this.type === types$1.name && !containsEsc && (!this.potentialArrowInForAwait || this.value !== "of" || this.containsEsc)) {
          id2 = this.parseIdent(false);
          if (this.canInsertSemicolon() || !this.eat(types$1.arrow)) {
            this.unexpected();
          }
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id2], true, forInit);
        }
      }
      return id2;
    case types$1.regexp:
      var value = this.value;
      node = this.parseLiteral(value.value);
      node.regex = { pattern: value.pattern, flags: value.flags };
      return node;
    case types$1.num:
    case types$1.string:
      return this.parseLiteral(this.value);
    case types$1._null:
    case types$1._true:
    case types$1._false:
      node = this.startNode();
      node.value = this.type === types$1._null ? null : this.type === types$1._true;
      node.raw = this.type.keyword;
      this.next();
      return this.finishNode(node, "Literal");
    case types$1.parenL:
      var start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow, forInit);
      if (refDestructuringErrors) {
        if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr)) {
          refDestructuringErrors.parenthesizedAssign = start;
        }
        if (refDestructuringErrors.parenthesizedBind < 0) {
          refDestructuringErrors.parenthesizedBind = start;
        }
      }
      return expr;
    case types$1.bracketL:
      node = this.startNode();
      this.next();
      node.elements = this.parseExprList(types$1.bracketR, true, true, refDestructuringErrors);
      return this.finishNode(node, "ArrayExpression");
    case types$1.braceL:
      this.overrideContext(types.b_expr);
      return this.parseObj(false, refDestructuringErrors);
    case types$1._function:
      node = this.startNode();
      this.next();
      return this.parseFunction(node, 0);
    case types$1._class:
      return this.parseClass(this.startNode(), false);
    case types$1._new:
      return this.parseNew();
    case types$1.backQuote:
      return this.parseTemplate();
    case types$1._import:
      if (this.options.ecmaVersion >= 11) {
        return this.parseExprImport(forNew);
      } else {
        return this.unexpected();
      }
    default:
      return this.parseExprAtomDefault();
  }
};
pp$5.parseExprAtomDefault = function() {
  this.unexpected();
};
pp$5.parseExprImport = function(forNew) {
  var node = this.startNode();
  if (this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword import");
  }
  this.next();
  if (this.type === types$1.parenL && !forNew) {
    return this.parseDynamicImport(node);
  } else if (this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "import";
    node.meta = this.finishNode(meta, "Identifier");
    return this.parseImportMeta(node);
  } else {
    this.unexpected();
  }
};
pp$5.parseDynamicImport = function(node) {
  this.next();
  node.source = this.parseMaybeAssign();
  if (this.options.ecmaVersion >= 16) {
    if (!this.eat(types$1.parenR)) {
      this.expect(types$1.comma);
      if (!this.afterTrailingComma(types$1.parenR)) {
        node.options = this.parseMaybeAssign();
        if (!this.eat(types$1.parenR)) {
          this.expect(types$1.comma);
          if (!this.afterTrailingComma(types$1.parenR)) {
            this.unexpected();
          }
        }
      } else {
        node.options = null;
      }
    } else {
      node.options = null;
    }
  } else {
    if (!this.eat(types$1.parenR)) {
      var errorPos = this.start;
      if (this.eat(types$1.comma) && this.eat(types$1.parenR)) {
        this.raiseRecoverable(errorPos, "Trailing comma is not allowed in import()");
      } else {
        this.unexpected(errorPos);
      }
    }
  }
  return this.finishNode(node, "ImportExpression");
};
pp$5.parseImportMeta = function(node) {
  this.next();
  var containsEsc = this.containsEsc;
  node.property = this.parseIdent(true);
  if (node.property.name !== "meta") {
    this.raiseRecoverable(node.property.start, "The only valid meta property for import is 'import.meta'");
  }
  if (containsEsc) {
    this.raiseRecoverable(node.start, "'import.meta' must not contain escaped characters");
  }
  if (this.options.sourceType !== "module" && !this.options.allowImportExportEverywhere) {
    this.raiseRecoverable(node.start, "Cannot use 'import.meta' outside a module");
  }
  return this.finishNode(node, "MetaProperty");
};
pp$5.parseLiteral = function(value) {
  var node = this.startNode();
  node.value = value;
  node.raw = this.input.slice(this.start, this.end);
  if (node.raw.charCodeAt(node.raw.length - 1) === 110) {
    node.bigint = node.value != null ? node.value.toString() : node.raw.slice(0, -1).replace(/_/g, "");
  }
  this.next();
  return this.finishNode(node, "Literal");
};
pp$5.parseParenExpression = function() {
  this.expect(types$1.parenL);
  var val = this.parseExpression();
  this.expect(types$1.parenR);
  return val;
};
pp$5.shouldParseArrow = function(exprList) {
  return !this.canInsertSemicolon();
};
pp$5.parseParenAndDistinguishExpression = function(canBeArrow, forInit) {
  var startPos = this.start, startLoc = this.startLoc, val, allowTrailingComma = this.options.ecmaVersion >= 8;
  if (this.options.ecmaVersion >= 6) {
    this.next();
    var innerStartPos = this.start, innerStartLoc = this.startLoc;
    var exprList = [], first = true, lastIsComma = false;
    var refDestructuringErrors = new DestructuringErrors(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, spreadStart;
    this.yieldPos = 0;
    this.awaitPos = 0;
    while (this.type !== types$1.parenR) {
      first ? first = false : this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(types$1.parenR, true)) {
        lastIsComma = true;
        break;
      } else if (this.type === types$1.ellipsis) {
        spreadStart = this.start;
        exprList.push(this.parseParenItem(this.parseRestBinding()));
        if (this.type === types$1.comma) {
          this.raiseRecoverable(
            this.start,
            "Comma is not permitted after the rest element"
          );
        }
        break;
      } else {
        exprList.push(this.parseMaybeAssign(false, refDestructuringErrors, this.parseParenItem));
      }
    }
    var innerEndPos = this.lastTokEnd, innerEndLoc = this.lastTokEndLoc;
    this.expect(types$1.parenR);
    if (canBeArrow && this.shouldParseArrow(exprList) && this.eat(types$1.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      return this.parseParenArrowList(startPos, startLoc, exprList, forInit);
    }
    if (!exprList.length || lastIsComma) {
      this.unexpected(this.lastTokStart);
    }
    if (spreadStart) {
      this.unexpected(spreadStart);
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = this.parseParenExpression();
  }
  if (this.options.preserveParens) {
    var par = this.startNodeAt(startPos, startLoc);
    par.expression = val;
    return this.finishNode(par, "ParenthesizedExpression");
  } else {
    return val;
  }
};
pp$5.parseParenItem = function(item) {
  return item;
};
pp$5.parseParenArrowList = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, false, forInit);
};
var empty = [];
pp$5.parseNew = function() {
  if (this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword new");
  }
  var node = this.startNode();
  this.next();
  if (this.options.ecmaVersion >= 6 && this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "new";
    node.meta = this.finishNode(meta, "Identifier");
    this.next();
    var containsEsc = this.containsEsc;
    node.property = this.parseIdent(true);
    if (node.property.name !== "target") {
      this.raiseRecoverable(node.property.start, "The only valid meta property for new is 'new.target'");
    }
    if (containsEsc) {
      this.raiseRecoverable(node.start, "'new.target' must not contain escaped characters");
    }
    if (!this.allowNewDotTarget) {
      this.raiseRecoverable(node.start, "'new.target' can only be used in functions and class static block");
    }
    return this.finishNode(node, "MetaProperty");
  }
  var startPos = this.start, startLoc = this.startLoc;
  node.callee = this.parseSubscripts(this.parseExprAtom(null, false, true), startPos, startLoc, true, false);
  if (node.callee.type === "Super") {
    this.raiseRecoverable(startPos, "Invalid use of 'super'");
  }
  if (this.eat(types$1.parenL)) {
    node.arguments = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false);
  } else {
    node.arguments = empty;
  }
  return this.finishNode(node, "NewExpression");
};
pp$5.parseTemplateElement = function(ref2) {
  var isTagged = ref2.isTagged;
  var elem = this.startNode();
  if (this.type === types$1.invalidTemplate) {
    if (!isTagged) {
      this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal");
    }
    elem.value = {
      raw: this.value.replace(/\r\n?/g, "\n"),
      cooked: null
    };
  } else {
    elem.value = {
      raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"),
      cooked: this.value
    };
  }
  this.next();
  elem.tail = this.type === types$1.backQuote;
  return this.finishNode(elem, "TemplateElement");
};
pp$5.parseTemplate = function(ref2) {
  if (ref2 === void 0) ref2 = {};
  var isTagged = ref2.isTagged;
  if (isTagged === void 0) isTagged = false;
  var node = this.startNode();
  this.next();
  node.expressions = [];
  var curElt = this.parseTemplateElement({ isTagged });
  node.quasis = [curElt];
  while (!curElt.tail) {
    if (this.type === types$1.eof) {
      this.raise(this.pos, "Unterminated template literal");
    }
    this.expect(types$1.dollarBraceL);
    node.expressions.push(this.parseExpression());
    this.expect(types$1.braceR);
    node.quasis.push(curElt = this.parseTemplateElement({ isTagged }));
  }
  this.next();
  return this.finishNode(node, "TemplateLiteral");
};
pp$5.isAsyncProp = function(prop) {
  return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" && (this.type === types$1.name || this.type === types$1.num || this.type === types$1.string || this.type === types$1.bracketL || this.type.keyword || this.options.ecmaVersion >= 9 && this.type === types$1.star) && !lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};
pp$5.parseObj = function(isPattern, refDestructuringErrors) {
  var node = this.startNode(), first = true, propHash = {};
  node.properties = [];
  this.next();
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.options.ecmaVersion >= 5 && this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    var prop = this.parseProperty(isPattern, refDestructuringErrors);
    if (!isPattern) {
      this.checkPropClash(prop, propHash, refDestructuringErrors);
    }
    node.properties.push(prop);
  }
  return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
};
pp$5.parseProperty = function(isPattern, refDestructuringErrors) {
  var prop = this.startNode(), isGenerator, isAsync, startPos, startLoc;
  if (this.options.ecmaVersion >= 9 && this.eat(types$1.ellipsis)) {
    if (isPattern) {
      prop.argument = this.parseIdent(false);
      if (this.type === types$1.comma) {
        this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
      }
      return this.finishNode(prop, "RestElement");
    }
    prop.argument = this.parseMaybeAssign(false, refDestructuringErrors);
    if (this.type === types$1.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
      refDestructuringErrors.trailingComma = this.start;
    }
    return this.finishNode(prop, "SpreadElement");
  }
  if (this.options.ecmaVersion >= 6) {
    prop.method = false;
    prop.shorthand = false;
    if (isPattern || refDestructuringErrors) {
      startPos = this.start;
      startLoc = this.startLoc;
    }
    if (!isPattern) {
      isGenerator = this.eat(types$1.star);
    }
  }
  var containsEsc = this.containsEsc;
  this.parsePropertyName(prop);
  if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
    isAsync = true;
    isGenerator = this.options.ecmaVersion >= 9 && this.eat(types$1.star);
    this.parsePropertyName(prop);
  } else {
    isAsync = false;
  }
  this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc);
  return this.finishNode(prop, "Property");
};
pp$5.parseGetterSetter = function(prop) {
  var kind = prop.key.name;
  this.parsePropertyName(prop);
  prop.value = this.parseMethod(false);
  prop.kind = kind;
  var paramCount = prop.kind === "get" ? 0 : 1;
  if (prop.value.params.length !== paramCount) {
    var start = prop.value.start;
    if (prop.kind === "get") {
      this.raiseRecoverable(start, "getter should have no params");
    } else {
      this.raiseRecoverable(start, "setter should have exactly one param");
    }
  } else {
    if (prop.kind === "set" && prop.value.params[0].type === "RestElement") {
      this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params");
    }
  }
};
pp$5.parsePropertyValue = function(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
  if ((isGenerator || isAsync) && this.type === types$1.colon) {
    this.unexpected();
  }
  if (this.eat(types$1.colon)) {
    prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors);
    prop.kind = "init";
  } else if (this.options.ecmaVersion >= 6 && this.type === types$1.parenL) {
    if (isPattern) {
      this.unexpected();
    }
    prop.method = true;
    prop.value = this.parseMethod(isGenerator, isAsync);
    prop.kind = "init";
  } else if (!isPattern && !containsEsc && this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === "Identifier" && (prop.key.name === "get" || prop.key.name === "set") && (this.type !== types$1.comma && this.type !== types$1.braceR && this.type !== types$1.eq)) {
    if (isGenerator || isAsync) {
      this.unexpected();
    }
    this.parseGetterSetter(prop);
  } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) {
      this.unexpected();
    }
    this.checkUnreserved(prop.key);
    if (prop.key.name === "await" && !this.awaitIdentPos) {
      this.awaitIdentPos = startPos;
    }
    if (isPattern) {
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else if (this.type === types$1.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0) {
        refDestructuringErrors.shorthandAssign = this.start;
      }
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else {
      prop.value = this.copyNode(prop.key);
    }
    prop.kind = "init";
    prop.shorthand = true;
  } else {
    this.unexpected();
  }
};
pp$5.parsePropertyName = function(prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(types$1.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(types$1.bracketR);
      return prop.key;
    } else {
      prop.computed = false;
    }
  }
  return prop.key = this.type === types$1.num || this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
};
pp$5.initFunction = function(node) {
  node.id = null;
  if (this.options.ecmaVersion >= 6) {
    node.generator = node.expression = false;
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = false;
  }
};
pp$5.parseMethod = function(isGenerator, isAsync, allowDirectSuper) {
  var node = this.startNode(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.initFunction(node);
  if (this.options.ecmaVersion >= 6) {
    node.generator = isGenerator;
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(isAsync, node.generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));
  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
  this.parseFunctionBody(node, false, true, false);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "FunctionExpression");
};
pp$5.parseArrowExpression = function(node, params, isAsync, forInit) {
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW);
  this.initFunction(node);
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  node.params = this.toAssignableList(params, true);
  this.parseFunctionBody(node, true, false, forInit);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "ArrowFunctionExpression");
};
pp$5.parseFunctionBody = function(node, isArrowFunction, isMethod, forInit) {
  var isExpression = isArrowFunction && this.type !== types$1.braceL;
  var oldStrict = this.strict, useStrict = false;
  if (isExpression) {
    node.body = this.parseMaybeAssign(forInit);
    node.expression = true;
    this.checkParams(node, false);
  } else {
    var nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params);
    if (!oldStrict || nonSimple) {
      useStrict = this.strictDirective(this.end);
      if (useStrict && nonSimple) {
        this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list");
      }
    }
    var oldLabels = this.labels;
    this.labels = [];
    if (useStrict) {
      this.strict = true;
    }
    this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params));
    if (this.strict && node.id) {
      this.checkLValSimple(node.id, BIND_OUTSIDE);
    }
    node.body = this.parseBlock(false, void 0, useStrict && !oldStrict);
    node.expression = false;
    this.adaptDirectivePrologue(node.body.body);
    this.labels = oldLabels;
  }
  this.exitScope();
};
pp$5.isSimpleParamList = function(params) {
  for (var i = 0, list = params; i < list.length; i += 1) {
    var param = list[i];
    if (param.type !== "Identifier") {
      return false;
    }
  }
  return true;
};
pp$5.checkParams = function(node, allowDuplicates) {
  var nameHash = /* @__PURE__ */ Object.create(null);
  for (var i = 0, list = node.params; i < list.length; i += 1) {
    var param = list[i];
    this.checkLValInnerPattern(param, BIND_VAR, allowDuplicates ? null : nameHash);
  }
};
pp$5.parseExprList = function(close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (!first) {
      this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(close)) {
        break;
      }
    } else {
      first = false;
    }
    var elt = void 0;
    if (allowEmpty && this.type === types$1.comma) {
      elt = null;
    } else if (this.type === types$1.ellipsis) {
      elt = this.parseSpread(refDestructuringErrors);
      if (refDestructuringErrors && this.type === types$1.comma && refDestructuringErrors.trailingComma < 0) {
        refDestructuringErrors.trailingComma = this.start;
      }
    } else {
      elt = this.parseMaybeAssign(false, refDestructuringErrors);
    }
    elts.push(elt);
  }
  return elts;
};
pp$5.checkUnreserved = function(ref2) {
  var start = ref2.start;
  var end = ref2.end;
  var name = ref2.name;
  if (this.inGenerator && name === "yield") {
    this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator");
  }
  if (this.inAsync && name === "await") {
    this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function");
  }
  if (!(this.currentThisScope().flags & SCOPE_VAR) && name === "arguments") {
    this.raiseRecoverable(start, "Cannot use 'arguments' in class field initializer");
  }
  if (this.inClassStaticBlock && (name === "arguments" || name === "await")) {
    this.raise(start, "Cannot use " + name + " in class static initialization block");
  }
  if (this.keywords.test(name)) {
    this.raise(start, "Unexpected keyword '" + name + "'");
  }
  if (this.options.ecmaVersion < 6 && this.input.slice(start, end).indexOf("\\") !== -1) {
    return;
  }
  var re = this.strict ? this.reservedWordsStrict : this.reservedWords;
  if (re.test(name)) {
    if (!this.inAsync && name === "await") {
      this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function");
    }
    this.raiseRecoverable(start, "The keyword '" + name + "' is reserved");
  }
};
pp$5.parseIdent = function(liberal) {
  var node = this.parseIdentNode();
  this.next(!!liberal);
  this.finishNode(node, "Identifier");
  if (!liberal) {
    this.checkUnreserved(node);
    if (node.name === "await" && !this.awaitIdentPos) {
      this.awaitIdentPos = node.start;
    }
  }
  return node;
};
pp$5.parseIdentNode = function() {
  var node = this.startNode();
  if (this.type === types$1.name) {
    node.name = this.value;
  } else if (this.type.keyword) {
    node.name = this.type.keyword;
    if ((node.name === "class" || node.name === "function") && (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
      this.context.pop();
    }
    this.type = types$1.name;
  } else {
    this.unexpected();
  }
  return node;
};
pp$5.parsePrivateIdent = function() {
  var node = this.startNode();
  if (this.type === types$1.privateId) {
    node.name = this.value;
  } else {
    this.unexpected();
  }
  this.next();
  this.finishNode(node, "PrivateIdentifier");
  if (this.options.checkPrivateFields) {
    if (this.privateNameStack.length === 0) {
      this.raise(node.start, "Private field '#" + node.name + "' must be declared in an enclosing class");
    } else {
      this.privateNameStack[this.privateNameStack.length - 1].used.push(node);
    }
  }
  return node;
};
pp$5.parseYield = function(forInit) {
  if (!this.yieldPos) {
    this.yieldPos = this.start;
  }
  var node = this.startNode();
  this.next();
  if (this.type === types$1.semi || this.canInsertSemicolon() || this.type !== types$1.star && !this.type.startsExpr) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = this.eat(types$1.star);
    node.argument = this.parseMaybeAssign(forInit);
  }
  return this.finishNode(node, "YieldExpression");
};
pp$5.parseAwait = function(forInit) {
  if (!this.awaitPos) {
    this.awaitPos = this.start;
  }
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeUnary(null, true, false, forInit);
  return this.finishNode(node, "AwaitExpression");
};
var pp$4 = Parser.prototype;
pp$4.raise = function(pos, message) {
  var loc = getLineInfo(this.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  if (this.sourceFile) {
    message += " in " + this.sourceFile;
  }
  var err = new SyntaxError(message);
  err.pos = pos;
  err.loc = loc;
  err.raisedAt = this.pos;
  throw err;
};
pp$4.raiseRecoverable = pp$4.raise;
pp$4.curPosition = function() {
  if (this.options.locations) {
    return new Position(this.curLine, this.pos - this.lineStart);
  }
};
var pp$3 = Parser.prototype;
var Scope = function Scope2(flags) {
  this.flags = flags;
  this.var = [];
  this.lexical = [];
  this.functions = [];
};
pp$3.enterScope = function(flags) {
  this.scopeStack.push(new Scope(flags));
};
pp$3.exitScope = function() {
  this.scopeStack.pop();
};
pp$3.treatFunctionsAsVarInScope = function(scope) {
  return scope.flags & SCOPE_FUNCTION || !this.inModule && scope.flags & SCOPE_TOP;
};
pp$3.declareName = function(name, bindingType, pos) {
  var redeclared = false;
  if (bindingType === BIND_LEXICAL) {
    var scope = this.currentScope();
    redeclared = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.lexical.push(name);
    if (this.inModule && scope.flags & SCOPE_TOP) {
      delete this.undefinedExports[name];
    }
  } else if (bindingType === BIND_SIMPLE_CATCH) {
    var scope$1 = this.currentScope();
    scope$1.lexical.push(name);
  } else if (bindingType === BIND_FUNCTION) {
    var scope$2 = this.currentScope();
    if (this.treatFunctionsAsVar) {
      redeclared = scope$2.lexical.indexOf(name) > -1;
    } else {
      redeclared = scope$2.lexical.indexOf(name) > -1 || scope$2.var.indexOf(name) > -1;
    }
    scope$2.functions.push(name);
  } else {
    for (var i = this.scopeStack.length - 1; i >= 0; --i) {
      var scope$3 = this.scopeStack[i];
      if (scope$3.lexical.indexOf(name) > -1 && !(scope$3.flags & SCOPE_SIMPLE_CATCH && scope$3.lexical[0] === name) || !this.treatFunctionsAsVarInScope(scope$3) && scope$3.functions.indexOf(name) > -1) {
        redeclared = true;
        break;
      }
      scope$3.var.push(name);
      if (this.inModule && scope$3.flags & SCOPE_TOP) {
        delete this.undefinedExports[name];
      }
      if (scope$3.flags & SCOPE_VAR) {
        break;
      }
    }
  }
  if (redeclared) {
    this.raiseRecoverable(pos, "Identifier '" + name + "' has already been declared");
  }
};
pp$3.checkLocalExport = function(id2) {
  if (this.scopeStack[0].lexical.indexOf(id2.name) === -1 && this.scopeStack[0].var.indexOf(id2.name) === -1) {
    this.undefinedExports[id2.name] = id2;
  }
};
pp$3.currentScope = function() {
  return this.scopeStack[this.scopeStack.length - 1];
};
pp$3.currentVarScope = function() {
  for (var i = this.scopeStack.length - 1; ; i--) {
    var scope = this.scopeStack[i];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK)) {
      return scope;
    }
  }
};
pp$3.currentThisScope = function() {
  for (var i = this.scopeStack.length - 1; ; i--) {
    var scope = this.scopeStack[i];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK) && !(scope.flags & SCOPE_ARROW)) {
      return scope;
    }
  }
};
var Node = function Node2(parser, pos, loc) {
  this.type = "";
  this.start = pos;
  this.end = 0;
  if (parser.options.locations) {
    this.loc = new SourceLocation(parser, loc);
  }
  if (parser.options.directSourceFile) {
    this.sourceFile = parser.options.directSourceFile;
  }
  if (parser.options.ranges) {
    this.range = [pos, 0];
  }
};
var pp$2 = Parser.prototype;
pp$2.startNode = function() {
  return new Node(this, this.start, this.startLoc);
};
pp$2.startNodeAt = function(pos, loc) {
  return new Node(this, pos, loc);
};
function finishNodeAt(node, type, pos, loc) {
  node.type = type;
  node.end = pos;
  if (this.options.locations) {
    node.loc.end = loc;
  }
  if (this.options.ranges) {
    node.range[1] = pos;
  }
  return node;
}
pp$2.finishNode = function(node, type) {
  return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc);
};
pp$2.finishNodeAt = function(node, type, pos, loc) {
  return finishNodeAt.call(this, node, type, pos, loc);
};
pp$2.copyNode = function(node) {
  var newNode = new Node(this, node.start, this.startLoc);
  for (var prop in node) {
    newNode[prop] = node[prop];
  }
  return newNode;
};
var scriptValuesAddedInUnicode = "Berf Beria_Erfe Gara Garay Gukh Gurung_Khema Hrkt Katakana_Or_Hiragana Kawi Kirat_Rai Krai Nag_Mundari Nagm Ol_Onal Onao Sidetic Sidt Sunu Sunuwar Tai_Yo Tayo Todhri Todr Tolong_Siki Tols Tulu_Tigalari Tutg Unknown Zzzz";
var ecma9BinaryProperties = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS";
var ecma10BinaryProperties = ecma9BinaryProperties + " Extended_Pictographic";
var ecma11BinaryProperties = ecma10BinaryProperties;
var ecma12BinaryProperties = ecma11BinaryProperties + " EBase EComp EMod EPres ExtPict";
var ecma13BinaryProperties = ecma12BinaryProperties;
var ecma14BinaryProperties = ecma13BinaryProperties;
var unicodeBinaryProperties = {
  9: ecma9BinaryProperties,
  10: ecma10BinaryProperties,
  11: ecma11BinaryProperties,
  12: ecma12BinaryProperties,
  13: ecma13BinaryProperties,
  14: ecma14BinaryProperties
};
var ecma14BinaryPropertiesOfStrings = "Basic_Emoji Emoji_Keycap_Sequence RGI_Emoji_Modifier_Sequence RGI_Emoji_Flag_Sequence RGI_Emoji_Tag_Sequence RGI_Emoji_ZWJ_Sequence RGI_Emoji";
var unicodeBinaryPropertiesOfStrings = {
  9: "",
  10: "",
  11: "",
  12: "",
  13: "",
  14: ecma14BinaryPropertiesOfStrings
};
var unicodeGeneralCategoryValues = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu";
var ecma9ScriptValues = "Adlam Adlm Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb";
var ecma10ScriptValues = ecma9ScriptValues + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd";
var ecma11ScriptValues = ecma10ScriptValues + " Elymaic Elym Nandinagari Nand Nyiakeng_Puachue_Hmong Hmnp Wancho Wcho";
var ecma12ScriptValues = ecma11ScriptValues + " Chorasmian Chrs Diak Dives_Akuru Khitan_Small_Script Kits Yezi Yezidi";
var ecma13ScriptValues = ecma12ScriptValues + " Cypro_Minoan Cpmn Old_Uyghur Ougr Tangsa Tnsa Toto Vithkuqi Vith";
var ecma14ScriptValues = ecma13ScriptValues + " " + scriptValuesAddedInUnicode;
var unicodeScriptValues = {
  9: ecma9ScriptValues,
  10: ecma10ScriptValues,
  11: ecma11ScriptValues,
  12: ecma12ScriptValues,
  13: ecma13ScriptValues,
  14: ecma14ScriptValues
};
var data = {};
function buildUnicodeData(ecmaVersion) {
  var d = data[ecmaVersion] = {
    binary: wordsRegexp(unicodeBinaryProperties[ecmaVersion] + " " + unicodeGeneralCategoryValues),
    binaryOfStrings: wordsRegexp(unicodeBinaryPropertiesOfStrings[ecmaVersion]),
    nonBinary: {
      General_Category: wordsRegexp(unicodeGeneralCategoryValues),
      Script: wordsRegexp(unicodeScriptValues[ecmaVersion])
    }
  };
  d.nonBinary.Script_Extensions = d.nonBinary.Script;
  d.nonBinary.gc = d.nonBinary.General_Category;
  d.nonBinary.sc = d.nonBinary.Script;
  d.nonBinary.scx = d.nonBinary.Script_Extensions;
}
for (i = 0, list = [9, 10, 11, 12, 13, 14]; i < list.length; i += 1) {
  ecmaVersion = list[i];
  buildUnicodeData(ecmaVersion);
}
var ecmaVersion;
var i;
var list;
var pp$1 = Parser.prototype;
var BranchID = function BranchID2(parent, base) {
  this.parent = parent;
  this.base = base || this;
};
BranchID.prototype.separatedFrom = function separatedFrom(alt) {
  for (var self = this; self; self = self.parent) {
    for (var other = alt; other; other = other.parent) {
      if (self.base === other.base && self !== other) {
        return true;
      }
    }
  }
  return false;
};
BranchID.prototype.sibling = function sibling() {
  return new BranchID(this.parent, this.base);
};
var RegExpValidationState = function RegExpValidationState2(parser) {
  this.parser = parser;
  this.validFlags = "gim" + (parser.options.ecmaVersion >= 6 ? "uy" : "") + (parser.options.ecmaVersion >= 9 ? "s" : "") + (parser.options.ecmaVersion >= 13 ? "d" : "") + (parser.options.ecmaVersion >= 15 ? "v" : "");
  this.unicodeProperties = data[parser.options.ecmaVersion >= 14 ? 14 : parser.options.ecmaVersion];
  this.source = "";
  this.flags = "";
  this.start = 0;
  this.switchU = false;
  this.switchV = false;
  this.switchN = false;
  this.pos = 0;
  this.lastIntValue = 0;
  this.lastStringValue = "";
  this.lastAssertionIsQuantifiable = false;
  this.numCapturingParens = 0;
  this.maxBackReference = 0;
  this.groupNames = /* @__PURE__ */ Object.create(null);
  this.backReferenceNames = [];
  this.branchID = null;
};
RegExpValidationState.prototype.reset = function reset(start, pattern, flags) {
  var unicodeSets = flags.indexOf("v") !== -1;
  var unicode = flags.indexOf("u") !== -1;
  this.start = start | 0;
  this.source = pattern + "";
  this.flags = flags;
  if (unicodeSets && this.parser.options.ecmaVersion >= 15) {
    this.switchU = true;
    this.switchV = true;
    this.switchN = true;
  } else {
    this.switchU = unicode && this.parser.options.ecmaVersion >= 6;
    this.switchV = false;
    this.switchN = unicode && this.parser.options.ecmaVersion >= 9;
  }
};
RegExpValidationState.prototype.raise = function raise(message) {
  this.parser.raiseRecoverable(this.start, "Invalid regular expression: /" + this.source + "/: " + message);
};
RegExpValidationState.prototype.at = function at(i, forceU) {
  if (forceU === void 0) forceU = false;
  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return -1;
  }
  var c = s.charCodeAt(i);
  if (!(forceU || this.switchU) || c <= 55295 || c >= 57344 || i + 1 >= l) {
    return c;
  }
  var next = s.charCodeAt(i + 1);
  return next >= 56320 && next <= 57343 ? (c << 10) + next - 56613888 : c;
};
RegExpValidationState.prototype.nextIndex = function nextIndex(i, forceU) {
  if (forceU === void 0) forceU = false;
  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return l;
  }
  var c = s.charCodeAt(i), next;
  if (!(forceU || this.switchU) || c <= 55295 || c >= 57344 || i + 1 >= l || (next = s.charCodeAt(i + 1)) < 56320 || next > 57343) {
    return i + 1;
  }
  return i + 2;
};
RegExpValidationState.prototype.current = function current(forceU) {
  if (forceU === void 0) forceU = false;
  return this.at(this.pos, forceU);
};
RegExpValidationState.prototype.lookahead = function lookahead(forceU) {
  if (forceU === void 0) forceU = false;
  return this.at(this.nextIndex(this.pos, forceU), forceU);
};
RegExpValidationState.prototype.advance = function advance(forceU) {
  if (forceU === void 0) forceU = false;
  this.pos = this.nextIndex(this.pos, forceU);
};
RegExpValidationState.prototype.eat = function eat(ch, forceU) {
  if (forceU === void 0) forceU = false;
  if (this.current(forceU) === ch) {
    this.advance(forceU);
    return true;
  }
  return false;
};
RegExpValidationState.prototype.eatChars = function eatChars(chs, forceU) {
  if (forceU === void 0) forceU = false;
  var pos = this.pos;
  for (var i = 0, list = chs; i < list.length; i += 1) {
    var ch = list[i];
    var current2 = this.at(pos, forceU);
    if (current2 === -1 || current2 !== ch) {
      return false;
    }
    pos = this.nextIndex(pos, forceU);
  }
  this.pos = pos;
  return true;
};
pp$1.validateRegExpFlags = function(state) {
  var validFlags = state.validFlags;
  var flags = state.flags;
  var u = false;
  var v = false;
  for (var i = 0; i < flags.length; i++) {
    var flag = flags.charAt(i);
    if (validFlags.indexOf(flag) === -1) {
      this.raise(state.start, "Invalid regular expression flag");
    }
    if (flags.indexOf(flag, i + 1) > -1) {
      this.raise(state.start, "Duplicate regular expression flag");
    }
    if (flag === "u") {
      u = true;
    }
    if (flag === "v") {
      v = true;
    }
  }
  if (this.options.ecmaVersion >= 15 && u && v) {
    this.raise(state.start, "Invalid regular expression flag");
  }
};
function hasProp(obj) {
  for (var _ in obj) {
    return true;
  }
  return false;
}
pp$1.validateRegExpPattern = function(state) {
  this.regexp_pattern(state);
  if (!state.switchN && this.options.ecmaVersion >= 9 && hasProp(state.groupNames)) {
    state.switchN = true;
    this.regexp_pattern(state);
  }
};
pp$1.regexp_pattern = function(state) {
  state.pos = 0;
  state.lastIntValue = 0;
  state.lastStringValue = "";
  state.lastAssertionIsQuantifiable = false;
  state.numCapturingParens = 0;
  state.maxBackReference = 0;
  state.groupNames = /* @__PURE__ */ Object.create(null);
  state.backReferenceNames.length = 0;
  state.branchID = null;
  this.regexp_disjunction(state);
  if (state.pos !== state.source.length) {
    if (state.eat(
      41
      /* ) */
    )) {
      state.raise("Unmatched ')'");
    }
    if (state.eat(
      93
      /* ] */
    ) || state.eat(
      125
      /* } */
    )) {
      state.raise("Lone quantifier brackets");
    }
  }
  if (state.maxBackReference > state.numCapturingParens) {
    state.raise("Invalid escape");
  }
  for (var i = 0, list = state.backReferenceNames; i < list.length; i += 1) {
    var name = list[i];
    if (!state.groupNames[name]) {
      state.raise("Invalid named capture referenced");
    }
  }
};
pp$1.regexp_disjunction = function(state) {
  var trackDisjunction = this.options.ecmaVersion >= 16;
  if (trackDisjunction) {
    state.branchID = new BranchID(state.branchID, null);
  }
  this.regexp_alternative(state);
  while (state.eat(
    124
    /* | */
  )) {
    if (trackDisjunction) {
      state.branchID = state.branchID.sibling();
    }
    this.regexp_alternative(state);
  }
  if (trackDisjunction) {
    state.branchID = state.branchID.parent;
  }
  if (this.regexp_eatQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  if (state.eat(
    123
    /* { */
  )) {
    state.raise("Lone quantifier brackets");
  }
};
pp$1.regexp_alternative = function(state) {
  while (state.pos < state.source.length && this.regexp_eatTerm(state)) {
  }
};
pp$1.regexp_eatTerm = function(state) {
  if (this.regexp_eatAssertion(state)) {
    if (state.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(state)) {
      if (state.switchU) {
        state.raise("Invalid quantifier");
      }
    }
    return true;
  }
  if (state.switchU ? this.regexp_eatAtom(state) : this.regexp_eatExtendedAtom(state)) {
    this.regexp_eatQuantifier(state);
    return true;
  }
  return false;
};
pp$1.regexp_eatAssertion = function(state) {
  var start = state.pos;
  state.lastAssertionIsQuantifiable = false;
  if (state.eat(
    94
    /* ^ */
  ) || state.eat(
    36
    /* $ */
  )) {
    return true;
  }
  if (state.eat(
    92
    /* \ */
  )) {
    if (state.eat(
      66
      /* B */
    ) || state.eat(
      98
      /* b */
    )) {
      return true;
    }
    state.pos = start;
  }
  if (state.eat(
    40
    /* ( */
  ) && state.eat(
    63
    /* ? */
  )) {
    var lookbehind = false;
    if (this.options.ecmaVersion >= 9) {
      lookbehind = state.eat(
        60
        /* < */
      );
    }
    if (state.eat(
      61
      /* = */
    ) || state.eat(
      33
      /* ! */
    )) {
      this.regexp_disjunction(state);
      if (!state.eat(
        41
        /* ) */
      )) {
        state.raise("Unterminated group");
      }
      state.lastAssertionIsQuantifiable = !lookbehind;
      return true;
    }
  }
  state.pos = start;
  return false;
};
pp$1.regexp_eatQuantifier = function(state, noError) {
  if (noError === void 0) noError = false;
  if (this.regexp_eatQuantifierPrefix(state, noError)) {
    state.eat(
      63
      /* ? */
    );
    return true;
  }
  return false;
};
pp$1.regexp_eatQuantifierPrefix = function(state, noError) {
  return state.eat(
    42
    /* * */
  ) || state.eat(
    43
    /* + */
  ) || state.eat(
    63
    /* ? */
  ) || this.regexp_eatBracedQuantifier(state, noError);
};
pp$1.regexp_eatBracedQuantifier = function(state, noError) {
  var start = state.pos;
  if (state.eat(
    123
    /* { */
  )) {
    var min = 0, max = -1;
    if (this.regexp_eatDecimalDigits(state)) {
      min = state.lastIntValue;
      if (state.eat(
        44
        /* , */
      ) && this.regexp_eatDecimalDigits(state)) {
        max = state.lastIntValue;
      }
      if (state.eat(
        125
        /* } */
      )) {
        if (max !== -1 && max < min && !noError) {
          state.raise("numbers out of order in {} quantifier");
        }
        return true;
      }
    }
    if (state.switchU && !noError) {
      state.raise("Incomplete quantifier");
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatAtom = function(state) {
  return this.regexp_eatPatternCharacters(state) || state.eat(
    46
    /* . */
  ) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state);
};
pp$1.regexp_eatReverseSolidusAtomEscape = function(state) {
  var start = state.pos;
  if (state.eat(
    92
    /* \ */
  )) {
    if (this.regexp_eatAtomEscape(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatUncapturingGroup = function(state) {
  var start = state.pos;
  if (state.eat(
    40
    /* ( */
  )) {
    if (state.eat(
      63
      /* ? */
    )) {
      if (this.options.ecmaVersion >= 16) {
        var addModifiers = this.regexp_eatModifiers(state);
        var hasHyphen = state.eat(
          45
          /* - */
        );
        if (addModifiers || hasHyphen) {
          for (var i = 0; i < addModifiers.length; i++) {
            var modifier = addModifiers.charAt(i);
            if (addModifiers.indexOf(modifier, i + 1) > -1) {
              state.raise("Duplicate regular expression modifiers");
            }
          }
          if (hasHyphen) {
            var removeModifiers = this.regexp_eatModifiers(state);
            if (!addModifiers && !removeModifiers && state.current() === 58) {
              state.raise("Invalid regular expression modifiers");
            }
            for (var i$1 = 0; i$1 < removeModifiers.length; i$1++) {
              var modifier$1 = removeModifiers.charAt(i$1);
              if (removeModifiers.indexOf(modifier$1, i$1 + 1) > -1 || addModifiers.indexOf(modifier$1) > -1) {
                state.raise("Duplicate regular expression modifiers");
              }
            }
          }
        }
      }
      if (state.eat(
        58
        /* : */
      )) {
        this.regexp_disjunction(state);
        if (state.eat(
          41
          /* ) */
        )) {
          return true;
        }
        state.raise("Unterminated group");
      }
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatCapturingGroup = function(state) {
  if (state.eat(
    40
    /* ( */
  )) {
    if (this.options.ecmaVersion >= 9) {
      this.regexp_groupSpecifier(state);
    } else if (state.current() === 63) {
      state.raise("Invalid group");
    }
    this.regexp_disjunction(state);
    if (state.eat(
      41
      /* ) */
    )) {
      state.numCapturingParens += 1;
      return true;
    }
    state.raise("Unterminated group");
  }
  return false;
};
pp$1.regexp_eatModifiers = function(state) {
  var modifiers = "";
  var ch = 0;
  while ((ch = state.current()) !== -1 && isRegularExpressionModifier(ch)) {
    modifiers += codePointToString(ch);
    state.advance();
  }
  return modifiers;
};
function isRegularExpressionModifier(ch) {
  return ch === 105 || ch === 109 || ch === 115;
}
pp$1.regexp_eatExtendedAtom = function(state) {
  return state.eat(
    46
    /* . */
  ) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state) || this.regexp_eatInvalidBracedQuantifier(state) || this.regexp_eatExtendedPatternCharacter(state);
};
pp$1.regexp_eatInvalidBracedQuantifier = function(state) {
  if (this.regexp_eatBracedQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  return false;
};
pp$1.regexp_eatSyntaxCharacter = function(state) {
  var ch = state.current();
  if (isSyntaxCharacter(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
function isSyntaxCharacter(ch) {
  return ch === 36 || ch >= 40 && ch <= 43 || ch === 46 || ch === 63 || ch >= 91 && ch <= 94 || ch >= 123 && ch <= 125;
}
pp$1.regexp_eatPatternCharacters = function(state) {
  var start = state.pos;
  var ch = 0;
  while ((ch = state.current()) !== -1 && !isSyntaxCharacter(ch)) {
    state.advance();
  }
  return state.pos !== start;
};
pp$1.regexp_eatExtendedPatternCharacter = function(state) {
  var ch = state.current();
  if (ch !== -1 && ch !== 36 && !(ch >= 40 && ch <= 43) && ch !== 46 && ch !== 63 && ch !== 91 && ch !== 94 && ch !== 124) {
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_groupSpecifier = function(state) {
  if (state.eat(
    63
    /* ? */
  )) {
    if (!this.regexp_eatGroupName(state)) {
      state.raise("Invalid group");
    }
    var trackDisjunction = this.options.ecmaVersion >= 16;
    var known = state.groupNames[state.lastStringValue];
    if (known) {
      if (trackDisjunction) {
        for (var i = 0, list = known; i < list.length; i += 1) {
          var altID = list[i];
          if (!altID.separatedFrom(state.branchID)) {
            state.raise("Duplicate capture group name");
          }
        }
      } else {
        state.raise("Duplicate capture group name");
      }
    }
    if (trackDisjunction) {
      (known || (state.groupNames[state.lastStringValue] = [])).push(state.branchID);
    } else {
      state.groupNames[state.lastStringValue] = true;
    }
  }
};
pp$1.regexp_eatGroupName = function(state) {
  state.lastStringValue = "";
  if (state.eat(
    60
    /* < */
  )) {
    if (this.regexp_eatRegExpIdentifierName(state) && state.eat(
      62
      /* > */
    )) {
      return true;
    }
    state.raise("Invalid capture group name");
  }
  return false;
};
pp$1.regexp_eatRegExpIdentifierName = function(state) {
  state.lastStringValue = "";
  if (this.regexp_eatRegExpIdentifierStart(state)) {
    state.lastStringValue += codePointToString(state.lastIntValue);
    while (this.regexp_eatRegExpIdentifierPart(state)) {
      state.lastStringValue += codePointToString(state.lastIntValue);
    }
    return true;
  }
  return false;
};
pp$1.regexp_eatRegExpIdentifierStart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);
  if (ch === 92 && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierStart(ch)) {
    state.lastIntValue = ch;
    return true;
  }
  state.pos = start;
  return false;
};
function isRegExpIdentifierStart(ch) {
  return isIdentifierStart(ch, true) || ch === 36 || ch === 95;
}
pp$1.regexp_eatRegExpIdentifierPart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);
  if (ch === 92 && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierPart(ch)) {
    state.lastIntValue = ch;
    return true;
  }
  state.pos = start;
  return false;
};
function isRegExpIdentifierPart(ch) {
  return isIdentifierChar(ch, true) || ch === 36 || ch === 95 || ch === 8204 || ch === 8205;
}
pp$1.regexp_eatAtomEscape = function(state) {
  if (this.regexp_eatBackReference(state) || this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state) || state.switchN && this.regexp_eatKGroupName(state)) {
    return true;
  }
  if (state.switchU) {
    if (state.current() === 99) {
      state.raise("Invalid unicode escape");
    }
    state.raise("Invalid escape");
  }
  return false;
};
pp$1.regexp_eatBackReference = function(state) {
  var start = state.pos;
  if (this.regexp_eatDecimalEscape(state)) {
    var n = state.lastIntValue;
    if (state.switchU) {
      if (n > state.maxBackReference) {
        state.maxBackReference = n;
      }
      return true;
    }
    if (n <= state.numCapturingParens) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatKGroupName = function(state) {
  if (state.eat(
    107
    /* k */
  )) {
    if (this.regexp_eatGroupName(state)) {
      state.backReferenceNames.push(state.lastStringValue);
      return true;
    }
    state.raise("Invalid named reference");
  }
  return false;
};
pp$1.regexp_eatCharacterEscape = function(state) {
  return this.regexp_eatControlEscape(state) || this.regexp_eatCControlLetter(state) || this.regexp_eatZero(state) || this.regexp_eatHexEscapeSequence(state) || this.regexp_eatRegExpUnicodeEscapeSequence(state, false) || !state.switchU && this.regexp_eatLegacyOctalEscapeSequence(state) || this.regexp_eatIdentityEscape(state);
};
pp$1.regexp_eatCControlLetter = function(state) {
  var start = state.pos;
  if (state.eat(
    99
    /* c */
  )) {
    if (this.regexp_eatControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatZero = function(state) {
  if (state.current() === 48 && !isDecimalDigit(state.lookahead())) {
    state.lastIntValue = 0;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatControlEscape = function(state) {
  var ch = state.current();
  if (ch === 116) {
    state.lastIntValue = 9;
    state.advance();
    return true;
  }
  if (ch === 110) {
    state.lastIntValue = 10;
    state.advance();
    return true;
  }
  if (ch === 118) {
    state.lastIntValue = 11;
    state.advance();
    return true;
  }
  if (ch === 102) {
    state.lastIntValue = 12;
    state.advance();
    return true;
  }
  if (ch === 114) {
    state.lastIntValue = 13;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatControlLetter = function(state) {
  var ch = state.current();
  if (isControlLetter(ch)) {
    state.lastIntValue = ch % 32;
    state.advance();
    return true;
  }
  return false;
};
function isControlLetter(ch) {
  return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122;
}
pp$1.regexp_eatRegExpUnicodeEscapeSequence = function(state, forceU) {
  if (forceU === void 0) forceU = false;
  var start = state.pos;
  var switchU = forceU || state.switchU;
  if (state.eat(
    117
    /* u */
  )) {
    if (this.regexp_eatFixedHexDigits(state, 4)) {
      var lead = state.lastIntValue;
      if (switchU && lead >= 55296 && lead <= 56319) {
        var leadSurrogateEnd = state.pos;
        if (state.eat(
          92
          /* \ */
        ) && state.eat(
          117
          /* u */
        ) && this.regexp_eatFixedHexDigits(state, 4)) {
          var trail = state.lastIntValue;
          if (trail >= 56320 && trail <= 57343) {
            state.lastIntValue = (lead - 55296) * 1024 + (trail - 56320) + 65536;
            return true;
          }
        }
        state.pos = leadSurrogateEnd;
        state.lastIntValue = lead;
      }
      return true;
    }
    if (switchU && state.eat(
      123
      /* { */
    ) && this.regexp_eatHexDigits(state) && state.eat(
      125
      /* } */
    ) && isValidUnicode(state.lastIntValue)) {
      return true;
    }
    if (switchU) {
      state.raise("Invalid unicode escape");
    }
    state.pos = start;
  }
  return false;
};
function isValidUnicode(ch) {
  return ch >= 0 && ch <= 1114111;
}
pp$1.regexp_eatIdentityEscape = function(state) {
  if (state.switchU) {
    if (this.regexp_eatSyntaxCharacter(state)) {
      return true;
    }
    if (state.eat(
      47
      /* / */
    )) {
      state.lastIntValue = 47;
      return true;
    }
    return false;
  }
  var ch = state.current();
  if (ch !== 99 && (!state.switchN || ch !== 107)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatDecimalEscape = function(state) {
  state.lastIntValue = 0;
  var ch = state.current();
  if (ch >= 49 && ch <= 57) {
    do {
      state.lastIntValue = 10 * state.lastIntValue + (ch - 48);
      state.advance();
    } while ((ch = state.current()) >= 48 && ch <= 57);
    return true;
  }
  return false;
};
var CharSetNone = 0;
var CharSetOk = 1;
var CharSetString = 2;
pp$1.regexp_eatCharacterClassEscape = function(state) {
  var ch = state.current();
  if (isCharacterClassEscape(ch)) {
    state.lastIntValue = -1;
    state.advance();
    return CharSetOk;
  }
  var negate = false;
  if (state.switchU && this.options.ecmaVersion >= 9 && ((negate = ch === 80) || ch === 112)) {
    state.lastIntValue = -1;
    state.advance();
    var result;
    if (state.eat(
      123
      /* { */
    ) && (result = this.regexp_eatUnicodePropertyValueExpression(state)) && state.eat(
      125
      /* } */
    )) {
      if (negate && result === CharSetString) {
        state.raise("Invalid property name");
      }
      return result;
    }
    state.raise("Invalid property name");
  }
  return CharSetNone;
};
function isCharacterClassEscape(ch) {
  return ch === 100 || ch === 68 || ch === 115 || ch === 83 || ch === 119 || ch === 87;
}
pp$1.regexp_eatUnicodePropertyValueExpression = function(state) {
  var start = state.pos;
  if (this.regexp_eatUnicodePropertyName(state) && state.eat(
    61
    /* = */
  )) {
    var name = state.lastStringValue;
    if (this.regexp_eatUnicodePropertyValue(state)) {
      var value = state.lastStringValue;
      this.regexp_validateUnicodePropertyNameAndValue(state, name, value);
      return CharSetOk;
    }
  }
  state.pos = start;
  if (this.regexp_eatLoneUnicodePropertyNameOrValue(state)) {
    var nameOrValue = state.lastStringValue;
    return this.regexp_validateUnicodePropertyNameOrValue(state, nameOrValue);
  }
  return CharSetNone;
};
pp$1.regexp_validateUnicodePropertyNameAndValue = function(state, name, value) {
  if (!hasOwn(state.unicodeProperties.nonBinary, name)) {
    state.raise("Invalid property name");
  }
  if (!state.unicodeProperties.nonBinary[name].test(value)) {
    state.raise("Invalid property value");
  }
};
pp$1.regexp_validateUnicodePropertyNameOrValue = function(state, nameOrValue) {
  if (state.unicodeProperties.binary.test(nameOrValue)) {
    return CharSetOk;
  }
  if (state.switchV && state.unicodeProperties.binaryOfStrings.test(nameOrValue)) {
    return CharSetString;
  }
  state.raise("Invalid property name");
};
pp$1.regexp_eatUnicodePropertyName = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyNameCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyNameCharacter(ch) {
  return isControlLetter(ch) || ch === 95;
}
pp$1.regexp_eatUnicodePropertyValue = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyValueCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyValueCharacter(ch) {
  return isUnicodePropertyNameCharacter(ch) || isDecimalDigit(ch);
}
pp$1.regexp_eatLoneUnicodePropertyNameOrValue = function(state) {
  return this.regexp_eatUnicodePropertyValue(state);
};
pp$1.regexp_eatCharacterClass = function(state) {
  if (state.eat(
    91
    /* [ */
  )) {
    var negate = state.eat(
      94
      /* ^ */
    );
    var result = this.regexp_classContents(state);
    if (!state.eat(
      93
      /* ] */
    )) {
      state.raise("Unterminated character class");
    }
    if (negate && result === CharSetString) {
      state.raise("Negated character class may contain strings");
    }
    return true;
  }
  return false;
};
pp$1.regexp_classContents = function(state) {
  if (state.current() === 93) {
    return CharSetOk;
  }
  if (state.switchV) {
    return this.regexp_classSetExpression(state);
  }
  this.regexp_nonEmptyClassRanges(state);
  return CharSetOk;
};
pp$1.regexp_nonEmptyClassRanges = function(state) {
  while (this.regexp_eatClassAtom(state)) {
    var left = state.lastIntValue;
    if (state.eat(
      45
      /* - */
    ) && this.regexp_eatClassAtom(state)) {
      var right = state.lastIntValue;
      if (state.switchU && (left === -1 || right === -1)) {
        state.raise("Invalid character class");
      }
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
    }
  }
};
pp$1.regexp_eatClassAtom = function(state) {
  var start = state.pos;
  if (state.eat(
    92
    /* \ */
  )) {
    if (this.regexp_eatClassEscape(state)) {
      return true;
    }
    if (state.switchU) {
      var ch$1 = state.current();
      if (ch$1 === 99 || isOctalDigit(ch$1)) {
        state.raise("Invalid class escape");
      }
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  var ch = state.current();
  if (ch !== 93) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatClassEscape = function(state) {
  var start = state.pos;
  if (state.eat(
    98
    /* b */
  )) {
    state.lastIntValue = 8;
    return true;
  }
  if (state.switchU && state.eat(
    45
    /* - */
  )) {
    state.lastIntValue = 45;
    return true;
  }
  if (!state.switchU && state.eat(
    99
    /* c */
  )) {
    if (this.regexp_eatClassControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }
  return this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state);
};
pp$1.regexp_classSetExpression = function(state) {
  var result = CharSetOk, subResult;
  if (this.regexp_eatClassSetRange(state)) ;
  else if (subResult = this.regexp_eatClassSetOperand(state)) {
    if (subResult === CharSetString) {
      result = CharSetString;
    }
    var start = state.pos;
    while (state.eatChars(
      [38, 38]
      /* && */
    )) {
      if (state.current() !== 38 && (subResult = this.regexp_eatClassSetOperand(state))) {
        if (subResult !== CharSetString) {
          result = CharSetOk;
        }
        continue;
      }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) {
      return result;
    }
    while (state.eatChars(
      [45, 45]
      /* -- */
    )) {
      if (this.regexp_eatClassSetOperand(state)) {
        continue;
      }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) {
      return result;
    }
  } else {
    state.raise("Invalid character in character class");
  }
  for (; ; ) {
    if (this.regexp_eatClassSetRange(state)) {
      continue;
    }
    subResult = this.regexp_eatClassSetOperand(state);
    if (!subResult) {
      return result;
    }
    if (subResult === CharSetString) {
      result = CharSetString;
    }
  }
};
pp$1.regexp_eatClassSetRange = function(state) {
  var start = state.pos;
  if (this.regexp_eatClassSetCharacter(state)) {
    var left = state.lastIntValue;
    if (state.eat(
      45
      /* - */
    ) && this.regexp_eatClassSetCharacter(state)) {
      var right = state.lastIntValue;
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatClassSetOperand = function(state) {
  if (this.regexp_eatClassSetCharacter(state)) {
    return CharSetOk;
  }
  return this.regexp_eatClassStringDisjunction(state) || this.regexp_eatNestedClass(state);
};
pp$1.regexp_eatNestedClass = function(state) {
  var start = state.pos;
  if (state.eat(
    91
    /* [ */
  )) {
    var negate = state.eat(
      94
      /* ^ */
    );
    var result = this.regexp_classContents(state);
    if (state.eat(
      93
      /* ] */
    )) {
      if (negate && result === CharSetString) {
        state.raise("Negated character class may contain strings");
      }
      return result;
    }
    state.pos = start;
  }
  if (state.eat(
    92
    /* \ */
  )) {
    var result$1 = this.regexp_eatCharacterClassEscape(state);
    if (result$1) {
      return result$1;
    }
    state.pos = start;
  }
  return null;
};
pp$1.regexp_eatClassStringDisjunction = function(state) {
  var start = state.pos;
  if (state.eatChars(
    [92, 113]
    /* \q */
  )) {
    if (state.eat(
      123
      /* { */
    )) {
      var result = this.regexp_classStringDisjunctionContents(state);
      if (state.eat(
        125
        /* } */
      )) {
        return result;
      }
    } else {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return null;
};
pp$1.regexp_classStringDisjunctionContents = function(state) {
  var result = this.regexp_classString(state);
  while (state.eat(
    124
    /* | */
  )) {
    if (this.regexp_classString(state) === CharSetString) {
      result = CharSetString;
    }
  }
  return result;
};
pp$1.regexp_classString = function(state) {
  var count = 0;
  while (this.regexp_eatClassSetCharacter(state)) {
    count++;
  }
  return count === 1 ? CharSetOk : CharSetString;
};
pp$1.regexp_eatClassSetCharacter = function(state) {
  var start = state.pos;
  if (state.eat(
    92
    /* \ */
  )) {
    if (this.regexp_eatCharacterEscape(state) || this.regexp_eatClassSetReservedPunctuator(state)) {
      return true;
    }
    if (state.eat(
      98
      /* b */
    )) {
      state.lastIntValue = 8;
      return true;
    }
    state.pos = start;
    return false;
  }
  var ch = state.current();
  if (ch < 0 || ch === state.lookahead() && isClassSetReservedDoublePunctuatorCharacter(ch)) {
    return false;
  }
  if (isClassSetSyntaxCharacter(ch)) {
    return false;
  }
  state.advance();
  state.lastIntValue = ch;
  return true;
};
function isClassSetReservedDoublePunctuatorCharacter(ch) {
  return ch === 33 || ch >= 35 && ch <= 38 || ch >= 42 && ch <= 44 || ch === 46 || ch >= 58 && ch <= 64 || ch === 94 || ch === 96 || ch === 126;
}
function isClassSetSyntaxCharacter(ch) {
  return ch === 40 || ch === 41 || ch === 45 || ch === 47 || ch >= 91 && ch <= 93 || ch >= 123 && ch <= 125;
}
pp$1.regexp_eatClassSetReservedPunctuator = function(state) {
  var ch = state.current();
  if (isClassSetReservedPunctuator(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
function isClassSetReservedPunctuator(ch) {
  return ch === 33 || ch === 35 || ch === 37 || ch === 38 || ch === 44 || ch === 45 || ch >= 58 && ch <= 62 || ch === 64 || ch === 96 || ch === 126;
}
pp$1.regexp_eatClassControlLetter = function(state) {
  var ch = state.current();
  if (isDecimalDigit(ch) || ch === 95) {
    state.lastIntValue = ch % 32;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatHexEscapeSequence = function(state) {
  var start = state.pos;
  if (state.eat(
    120
    /* x */
  )) {
    if (this.regexp_eatFixedHexDigits(state, 2)) {
      return true;
    }
    if (state.switchU) {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatDecimalDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isDecimalDigit(ch = state.current())) {
    state.lastIntValue = 10 * state.lastIntValue + (ch - 48);
    state.advance();
  }
  return state.pos !== start;
};
function isDecimalDigit(ch) {
  return ch >= 48 && ch <= 57;
}
pp$1.regexp_eatHexDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isHexDigit(ch = state.current())) {
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return state.pos !== start;
};
function isHexDigit(ch) {
  return ch >= 48 && ch <= 57 || ch >= 65 && ch <= 70 || ch >= 97 && ch <= 102;
}
function hexToInt(ch) {
  if (ch >= 65 && ch <= 70) {
    return 10 + (ch - 65);
  }
  if (ch >= 97 && ch <= 102) {
    return 10 + (ch - 97);
  }
  return ch - 48;
}
pp$1.regexp_eatLegacyOctalEscapeSequence = function(state) {
  if (this.regexp_eatOctalDigit(state)) {
    var n1 = state.lastIntValue;
    if (this.regexp_eatOctalDigit(state)) {
      var n2 = state.lastIntValue;
      if (n1 <= 3 && this.regexp_eatOctalDigit(state)) {
        state.lastIntValue = n1 * 64 + n2 * 8 + state.lastIntValue;
      } else {
        state.lastIntValue = n1 * 8 + n2;
      }
    } else {
      state.lastIntValue = n1;
    }
    return true;
  }
  return false;
};
pp$1.regexp_eatOctalDigit = function(state) {
  var ch = state.current();
  if (isOctalDigit(ch)) {
    state.lastIntValue = ch - 48;
    state.advance();
    return true;
  }
  state.lastIntValue = 0;
  return false;
};
function isOctalDigit(ch) {
  return ch >= 48 && ch <= 55;
}
pp$1.regexp_eatFixedHexDigits = function(state, length) {
  var start = state.pos;
  state.lastIntValue = 0;
  for (var i = 0; i < length; ++i) {
    var ch = state.current();
    if (!isHexDigit(ch)) {
      state.pos = start;
      return false;
    }
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return true;
};
var Token = function Token2(p) {
  this.type = p.type;
  this.value = p.value;
  this.start = p.start;
  this.end = p.end;
  if (p.options.locations) {
    this.loc = new SourceLocation(p, p.startLoc, p.endLoc);
  }
  if (p.options.ranges) {
    this.range = [p.start, p.end];
  }
};
var pp = Parser.prototype;
pp.next = function(ignoreEscapeSequenceInKeyword) {
  if (!ignoreEscapeSequenceInKeyword && this.type.keyword && this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword " + this.type.keyword);
  }
  if (this.options.onToken) {
    this.options.onToken(new Token(this));
  }
  this.lastTokEnd = this.end;
  this.lastTokStart = this.start;
  this.lastTokEndLoc = this.endLoc;
  this.lastTokStartLoc = this.startLoc;
  this.nextToken();
};
pp.getToken = function() {
  this.next();
  return new Token(this);
};
if (typeof Symbol !== "undefined") {
  pp[Symbol.iterator] = function() {
    var this$1$1 = this;
    return {
      next: function() {
        var token = this$1$1.getToken();
        return {
          done: token.type === types$1.eof,
          value: token
        };
      }
    };
  };
}
pp.nextToken = function() {
  var curContext = this.curContext();
  if (!curContext || !curContext.preserveSpace) {
    this.skipSpace();
  }
  this.start = this.pos;
  if (this.options.locations) {
    this.startLoc = this.curPosition();
  }
  if (this.pos >= this.input.length) {
    return this.finishToken(types$1.eof);
  }
  if (curContext.override) {
    return curContext.override(this);
  } else {
    this.readToken(this.fullCharCodeAtPos());
  }
};
pp.readToken = function(code) {
  if (isIdentifierStart(code, this.options.ecmaVersion >= 6) || code === 92) {
    return this.readWord();
  }
  return this.getTokenFromCode(code);
};
pp.fullCharCodeAt = function(pos) {
  var code = this.input.charCodeAt(pos);
  if (code <= 55295 || code >= 56320) {
    return code;
  }
  var next = this.input.charCodeAt(pos + 1);
  return next <= 56319 || next >= 57344 ? code : (code << 10) + next - 56613888;
};
pp.fullCharCodeAtPos = function() {
  return this.fullCharCodeAt(this.pos);
};
pp.skipBlockComment = function() {
  var startLoc = this.options.onComment && this.curPosition();
  var start = this.pos, end = this.input.indexOf("*/", this.pos += 2);
  if (end === -1) {
    this.raise(this.pos - 2, "Unterminated comment");
  }
  this.pos = end + 2;
  if (this.options.locations) {
    for (var nextBreak = void 0, pos = start; (nextBreak = nextLineBreak(this.input, pos, this.pos)) > -1; ) {
      ++this.curLine;
      pos = this.lineStart = nextBreak;
    }
  }
  if (this.options.onComment) {
    this.options.onComment(
      true,
      this.input.slice(start + 2, end),
      start,
      this.pos,
      startLoc,
      this.curPosition()
    );
  }
};
pp.skipLineComment = function(startSkip) {
  var start = this.pos;
  var startLoc = this.options.onComment && this.curPosition();
  var ch = this.input.charCodeAt(this.pos += startSkip);
  while (this.pos < this.input.length && !isNewLine(ch)) {
    ch = this.input.charCodeAt(++this.pos);
  }
  if (this.options.onComment) {
    this.options.onComment(
      false,
      this.input.slice(start + startSkip, this.pos),
      start,
      this.pos,
      startLoc,
      this.curPosition()
    );
  }
};
pp.skipSpace = function() {
  loop: while (this.pos < this.input.length) {
    var ch = this.input.charCodeAt(this.pos);
    switch (ch) {
      case 32:
      case 160:
        ++this.pos;
        break;
      case 13:
        if (this.input.charCodeAt(this.pos + 1) === 10) {
          ++this.pos;
        }
      case 10:
      case 8232:
      case 8233:
        ++this.pos;
        if (this.options.locations) {
          ++this.curLine;
          this.lineStart = this.pos;
        }
        break;
      case 47:
        switch (this.input.charCodeAt(this.pos + 1)) {
          case 42:
            this.skipBlockComment();
            break;
          case 47:
            this.skipLineComment(2);
            break;
          default:
            break loop;
        }
        break;
      default:
        if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
          ++this.pos;
        } else {
          break loop;
        }
    }
  }
};
pp.finishToken = function(type, val) {
  this.end = this.pos;
  if (this.options.locations) {
    this.endLoc = this.curPosition();
  }
  var prevType = this.type;
  this.type = type;
  this.value = val;
  this.updateContext(prevType);
};
pp.readToken_dot = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next >= 48 && next <= 57) {
    return this.readNumber(true);
  }
  var next2 = this.input.charCodeAt(this.pos + 2);
  if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) {
    this.pos += 3;
    return this.finishToken(types$1.ellipsis);
  } else {
    ++this.pos;
    return this.finishToken(types$1.dot);
  }
};
pp.readToken_slash = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (this.exprAllowed) {
    ++this.pos;
    return this.readRegexp();
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.slash, 1);
};
pp.readToken_mult_modulo_exp = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  var tokentype = code === 42 ? types$1.star : types$1.modulo;
  if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
    ++size;
    tokentype = types$1.starstar;
    next = this.input.charCodeAt(this.pos + 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, size + 1);
  }
  return this.finishOp(tokentype, size);
};
pp.readToken_pipe_amp = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (this.options.ecmaVersion >= 12) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) {
        return this.finishOp(types$1.assign, 3);
      }
    }
    return this.finishOp(code === 124 ? types$1.logicalOR : types$1.logicalAND, 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(code === 124 ? types$1.bitwiseOR : types$1.bitwiseAND, 1);
};
pp.readToken_caret = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.bitwiseXOR, 1);
};
pp.readToken_plus_min = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 && (this.lastTokEnd === 0 || lineBreak.test(this.input.slice(this.lastTokEnd, this.pos)))) {
      this.skipLineComment(3);
      this.skipSpace();
      return this.nextToken();
    }
    return this.finishOp(types$1.incDec, 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.plusMin, 1);
};
pp.readToken_lt_gt = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  if (next === code) {
    size = code === 62 && this.input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
    if (this.input.charCodeAt(this.pos + size) === 61) {
      return this.finishOp(types$1.assign, size + 1);
    }
    return this.finishOp(types$1.bitShift, size);
  }
  if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 45 && this.input.charCodeAt(this.pos + 3) === 45) {
    this.skipLineComment(4);
    this.skipSpace();
    return this.nextToken();
  }
  if (next === 61) {
    size = 2;
  }
  return this.finishOp(types$1.relational, size);
};
pp.readToken_eq_excl = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) {
    return this.finishOp(types$1.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2);
  }
  if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) {
    this.pos += 2;
    return this.finishToken(types$1.arrow);
  }
  return this.finishOp(code === 61 ? types$1.eq : types$1.prefix, 1);
};
pp.readToken_question = function() {
  var ecmaVersion = this.options.ecmaVersion;
  if (ecmaVersion >= 11) {
    var next = this.input.charCodeAt(this.pos + 1);
    if (next === 46) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 < 48 || next2 > 57) {
        return this.finishOp(types$1.questionDot, 2);
      }
    }
    if (next === 63) {
      if (ecmaVersion >= 12) {
        var next2$1 = this.input.charCodeAt(this.pos + 2);
        if (next2$1 === 61) {
          return this.finishOp(types$1.assign, 3);
        }
      }
      return this.finishOp(types$1.coalesce, 2);
    }
  }
  return this.finishOp(types$1.question, 1);
};
pp.readToken_numberSign = function() {
  var ecmaVersion = this.options.ecmaVersion;
  var code = 35;
  if (ecmaVersion >= 13) {
    ++this.pos;
    code = this.fullCharCodeAtPos();
    if (isIdentifierStart(code, true) || code === 92) {
      return this.finishToken(types$1.privateId, this.readWord1());
    }
  }
  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};
pp.getTokenFromCode = function(code) {
  switch (code) {
    // The interpretation of a dot depends on whether it is followed
    // by a digit or another two dots.
    case 46:
      return this.readToken_dot();
    // Punctuation tokens.
    case 40:
      ++this.pos;
      return this.finishToken(types$1.parenL);
    case 41:
      ++this.pos;
      return this.finishToken(types$1.parenR);
    case 59:
      ++this.pos;
      return this.finishToken(types$1.semi);
    case 44:
      ++this.pos;
      return this.finishToken(types$1.comma);
    case 91:
      ++this.pos;
      return this.finishToken(types$1.bracketL);
    case 93:
      ++this.pos;
      return this.finishToken(types$1.bracketR);
    case 123:
      ++this.pos;
      return this.finishToken(types$1.braceL);
    case 125:
      ++this.pos;
      return this.finishToken(types$1.braceR);
    case 58:
      ++this.pos;
      return this.finishToken(types$1.colon);
    case 96:
      if (this.options.ecmaVersion < 6) {
        break;
      }
      ++this.pos;
      return this.finishToken(types$1.backQuote);
    case 48:
      var next = this.input.charCodeAt(this.pos + 1);
      if (next === 120 || next === 88) {
        return this.readRadixNumber(16);
      }
      if (this.options.ecmaVersion >= 6) {
        if (next === 111 || next === 79) {
          return this.readRadixNumber(8);
        }
        if (next === 98 || next === 66) {
          return this.readRadixNumber(2);
        }
      }
    // Anything else beginning with a digit is an integer, octal
    // number, or float.
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57:
      return this.readNumber(false);
    // Quotes produce strings.
    case 34:
    case 39:
      return this.readString(code);
    // Operators are parsed inline in tiny state machines. '=' (61) is
    // often referred to. `finishOp` simply skips the amount of
    // characters it is given as second argument, and returns a token
    // of the type given by its first argument.
    case 47:
      return this.readToken_slash();
    case 37:
    case 42:
      return this.readToken_mult_modulo_exp(code);
    case 124:
    case 38:
      return this.readToken_pipe_amp(code);
    case 94:
      return this.readToken_caret();
    case 43:
    case 45:
      return this.readToken_plus_min(code);
    case 60:
    case 62:
      return this.readToken_lt_gt(code);
    case 61:
    case 33:
      return this.readToken_eq_excl(code);
    case 63:
      return this.readToken_question();
    case 126:
      return this.finishOp(types$1.prefix, 1);
    case 35:
      return this.readToken_numberSign();
  }
  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};
pp.finishOp = function(type, size) {
  var str = this.input.slice(this.pos, this.pos + size);
  this.pos += size;
  return this.finishToken(type, str);
};
pp.readRegexp = function() {
  var escaped, inClass, start = this.pos;
  for (; ; ) {
    if (this.pos >= this.input.length) {
      this.raise(start, "Unterminated regular expression");
    }
    var ch = this.input.charAt(this.pos);
    if (lineBreak.test(ch)) {
      this.raise(start, "Unterminated regular expression");
    }
    if (!escaped) {
      if (ch === "[") {
        inClass = true;
      } else if (ch === "]" && inClass) {
        inClass = false;
      } else if (ch === "/" && !inClass) {
        break;
      }
      escaped = ch === "\\";
    } else {
      escaped = false;
    }
    ++this.pos;
  }
  var pattern = this.input.slice(start, this.pos);
  ++this.pos;
  var flagsStart = this.pos;
  var flags = this.readWord1();
  if (this.containsEsc) {
    this.unexpected(flagsStart);
  }
  var state = this.regexpState || (this.regexpState = new RegExpValidationState(this));
  state.reset(start, pattern, flags);
  this.validateRegExpFlags(state);
  this.validateRegExpPattern(state);
  var value = null;
  try {
    value = new RegExp(pattern, flags);
  } catch (e) {
  }
  return this.finishToken(types$1.regexp, { pattern, flags, value });
};
pp.readInt = function(radix, len, maybeLegacyOctalNumericLiteral) {
  var allowSeparators = this.options.ecmaVersion >= 12 && len === void 0;
  var isLegacyOctalNumericLiteral = maybeLegacyOctalNumericLiteral && this.input.charCodeAt(this.pos) === 48;
  var start = this.pos, total = 0, lastCode = 0;
  for (var i = 0, e = len == null ? Infinity : len; i < e; ++i, ++this.pos) {
    var code = this.input.charCodeAt(this.pos), val = void 0;
    if (allowSeparators && code === 95) {
      if (isLegacyOctalNumericLiteral) {
        this.raiseRecoverable(this.pos, "Numeric separator is not allowed in legacy octal numeric literals");
      }
      if (lastCode === 95) {
        this.raiseRecoverable(this.pos, "Numeric separator must be exactly one underscore");
      }
      if (i === 0) {
        this.raiseRecoverable(this.pos, "Numeric separator is not allowed at the first of digits");
      }
      lastCode = code;
      continue;
    }
    if (code >= 97) {
      val = code - 97 + 10;
    } else if (code >= 65) {
      val = code - 65 + 10;
    } else if (code >= 48 && code <= 57) {
      val = code - 48;
    } else {
      val = Infinity;
    }
    if (val >= radix) {
      break;
    }
    lastCode = code;
    total = total * radix + val;
  }
  if (allowSeparators && lastCode === 95) {
    this.raiseRecoverable(this.pos - 1, "Numeric separator is not allowed at the last of digits");
  }
  if (this.pos === start || len != null && this.pos - start !== len) {
    return null;
  }
  return total;
};
function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) {
    return parseInt(str, 8);
  }
  return parseFloat(str.replace(/_/g, ""));
}
function stringToBigInt(str) {
  if (typeof BigInt !== "function") {
    return null;
  }
  return BigInt(str.replace(/_/g, ""));
}
pp.readRadixNumber = function(radix) {
  var start = this.pos;
  this.pos += 2;
  var val = this.readInt(radix);
  if (val == null) {
    this.raise(this.start + 2, "Expected number in radix " + radix);
  }
  if (this.options.ecmaVersion >= 11 && this.input.charCodeAt(this.pos) === 110) {
    val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
  } else if (isIdentifierStart(this.fullCharCodeAtPos())) {
    this.raise(this.pos, "Identifier directly after number");
  }
  return this.finishToken(types$1.num, val);
};
pp.readNumber = function(startsWithDot) {
  var start = this.pos;
  if (!startsWithDot && this.readInt(10, void 0, true) === null) {
    this.raise(start, "Invalid number");
  }
  var octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
  if (octal && this.strict) {
    this.raise(start, "Invalid number");
  }
  var next = this.input.charCodeAt(this.pos);
  if (!octal && !startsWithDot && this.options.ecmaVersion >= 11 && next === 110) {
    var val$1 = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
    if (isIdentifierStart(this.fullCharCodeAtPos())) {
      this.raise(this.pos, "Identifier directly after number");
    }
    return this.finishToken(types$1.num, val$1);
  }
  if (octal && /[89]/.test(this.input.slice(start, this.pos))) {
    octal = false;
  }
  if (next === 46 && !octal) {
    ++this.pos;
    this.readInt(10);
    next = this.input.charCodeAt(this.pos);
  }
  if ((next === 69 || next === 101) && !octal) {
    next = this.input.charCodeAt(++this.pos);
    if (next === 43 || next === 45) {
      ++this.pos;
    }
    if (this.readInt(10) === null) {
      this.raise(start, "Invalid number");
    }
  }
  if (isIdentifierStart(this.fullCharCodeAtPos())) {
    this.raise(this.pos, "Identifier directly after number");
  }
  var val = stringToNumber(this.input.slice(start, this.pos), octal);
  return this.finishToken(types$1.num, val);
};
pp.readCodePoint = function() {
  var ch = this.input.charCodeAt(this.pos), code;
  if (ch === 123) {
    if (this.options.ecmaVersion < 6) {
      this.unexpected();
    }
    var codePos = ++this.pos;
    code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
    ++this.pos;
    if (code > 1114111) {
      this.invalidStringToken(codePos, "Code point out of bounds");
    }
  } else {
    code = this.readHexChar(4);
  }
  return code;
};
pp.readString = function(quote) {
  var out = "", chunkStart = ++this.pos;
  for (; ; ) {
    if (this.pos >= this.input.length) {
      this.raise(this.start, "Unterminated string constant");
    }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === quote) {
      break;
    }
    if (ch === 92) {
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(false);
      chunkStart = this.pos;
    } else if (ch === 8232 || ch === 8233) {
      if (this.options.ecmaVersion < 10) {
        this.raise(this.start, "Unterminated string constant");
      }
      ++this.pos;
      if (this.options.locations) {
        this.curLine++;
        this.lineStart = this.pos;
      }
    } else {
      if (isNewLine(ch)) {
        this.raise(this.start, "Unterminated string constant");
      }
      ++this.pos;
    }
  }
  out += this.input.slice(chunkStart, this.pos++);
  return this.finishToken(types$1.string, out);
};
var INVALID_TEMPLATE_ESCAPE_ERROR = {};
pp.tryReadTemplateToken = function() {
  this.inTemplateElement = true;
  try {
    this.readTmplToken();
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
      this.readInvalidTemplateToken();
    } else {
      throw err;
    }
  }
  this.inTemplateElement = false;
};
pp.invalidStringToken = function(position, message) {
  if (this.inTemplateElement && this.options.ecmaVersion >= 9) {
    throw INVALID_TEMPLATE_ESCAPE_ERROR;
  } else {
    this.raise(position, message);
  }
};
pp.readTmplToken = function() {
  var out = "", chunkStart = this.pos;
  for (; ; ) {
    if (this.pos >= this.input.length) {
      this.raise(this.start, "Unterminated template");
    }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === 96 || ch === 36 && this.input.charCodeAt(this.pos + 1) === 123) {
      if (this.pos === this.start && (this.type === types$1.template || this.type === types$1.invalidTemplate)) {
        if (ch === 36) {
          this.pos += 2;
          return this.finishToken(types$1.dollarBraceL);
        } else {
          ++this.pos;
          return this.finishToken(types$1.backQuote);
        }
      }
      out += this.input.slice(chunkStart, this.pos);
      return this.finishToken(types$1.template, out);
    }
    if (ch === 92) {
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(true);
      chunkStart = this.pos;
    } else if (isNewLine(ch)) {
      out += this.input.slice(chunkStart, this.pos);
      ++this.pos;
      switch (ch) {
        case 13:
          if (this.input.charCodeAt(this.pos) === 10) {
            ++this.pos;
          }
        case 10:
          out += "\n";
          break;
        default:
          out += String.fromCharCode(ch);
          break;
      }
      if (this.options.locations) {
        ++this.curLine;
        this.lineStart = this.pos;
      }
      chunkStart = this.pos;
    } else {
      ++this.pos;
    }
  }
};
pp.readInvalidTemplateToken = function() {
  for (; this.pos < this.input.length; this.pos++) {
    switch (this.input[this.pos]) {
      case "\\":
        ++this.pos;
        break;
      case "$":
        if (this.input[this.pos + 1] !== "{") {
          break;
        }
      // fall through
      case "`":
        return this.finishToken(types$1.invalidTemplate, this.input.slice(this.start, this.pos));
      case "\r":
        if (this.input[this.pos + 1] === "\n") {
          ++this.pos;
        }
      // fall through
      case "\n":
      case "\u2028":
      case "\u2029":
        ++this.curLine;
        this.lineStart = this.pos + 1;
        break;
    }
  }
  this.raise(this.start, "Unterminated template");
};
pp.readEscapedChar = function(inTemplate) {
  var ch = this.input.charCodeAt(++this.pos);
  ++this.pos;
  switch (ch) {
    case 110:
      return "\n";
    // 'n' -> '\n'
    case 114:
      return "\r";
    // 'r' -> '\r'
    case 120:
      return String.fromCharCode(this.readHexChar(2));
    // 'x'
    case 117:
      return codePointToString(this.readCodePoint());
    // 'u'
    case 116:
      return "	";
    // 't' -> '\t'
    case 98:
      return "\b";
    // 'b' -> '\b'
    case 118:
      return "\v";
    // 'v' -> '\u000b'
    case 102:
      return "\f";
    // 'f' -> '\f'
    case 13:
      if (this.input.charCodeAt(this.pos) === 10) {
        ++this.pos;
      }
    // '\r\n'
    case 10:
      if (this.options.locations) {
        this.lineStart = this.pos;
        ++this.curLine;
      }
      return "";
    case 56:
    case 57:
      if (this.strict) {
        this.invalidStringToken(
          this.pos - 1,
          "Invalid escape sequence"
        );
      }
      if (inTemplate) {
        var codePos = this.pos - 1;
        this.invalidStringToken(
          codePos,
          "Invalid escape sequence in template string"
        );
      }
    default:
      if (ch >= 48 && ch <= 55) {
        var octalStr = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
        var octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        this.pos += octalStr.length - 1;
        ch = this.input.charCodeAt(this.pos);
        if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) {
          this.invalidStringToken(
            this.pos - 1 - octalStr.length,
            inTemplate ? "Octal literal in template string" : "Octal literal in strict mode"
          );
        }
        return String.fromCharCode(octal);
      }
      if (isNewLine(ch)) {
        if (this.options.locations) {
          this.lineStart = this.pos;
          ++this.curLine;
        }
        return "";
      }
      return String.fromCharCode(ch);
  }
};
pp.readHexChar = function(len) {
  var codePos = this.pos;
  var n = this.readInt(16, len);
  if (n === null) {
    this.invalidStringToken(codePos, "Bad character escape sequence");
  }
  return n;
};
pp.readWord1 = function() {
  this.containsEsc = false;
  var word = "", first = true, chunkStart = this.pos;
  var astral = this.options.ecmaVersion >= 6;
  while (this.pos < this.input.length) {
    var ch = this.fullCharCodeAtPos();
    if (isIdentifierChar(ch, astral)) {
      this.pos += ch <= 65535 ? 1 : 2;
    } else if (ch === 92) {
      this.containsEsc = true;
      word += this.input.slice(chunkStart, this.pos);
      var escStart = this.pos;
      if (this.input.charCodeAt(++this.pos) !== 117) {
        this.invalidStringToken(this.pos, "Expecting Unicode escape sequence \\uXXXX");
      }
      ++this.pos;
      var esc = this.readCodePoint();
      if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral)) {
        this.invalidStringToken(escStart, "Invalid Unicode escape");
      }
      word += codePointToString(esc);
      chunkStart = this.pos;
    } else {
      break;
    }
    first = false;
  }
  return word + this.input.slice(chunkStart, this.pos);
};
pp.readWord = function() {
  var word = this.readWord1();
  var type = types$1.name;
  if (this.keywords.test(word)) {
    type = keywords[word];
  }
  return this.finishToken(type, word);
};
var version = "8.18.0";
Parser.acorn = {
  Parser,
  version,
  defaultOptions,
  Position,
  SourceLocation,
  getLineInfo,
  Node,
  TokenType,
  tokTypes: types$1,
  keywordTypes: keywords,
  TokContext,
  tokContexts: types,
  isIdentifierChar,
  isIdentifierStart,
  Token,
  isNewLine,
  lineBreak,
  lineBreakG,
  nonASCIIwhitespace
};
function parse3(input, options) {
  return Parser.parse(input, options);
}

// src/service/scriptAst.ts
var PREFIX = "(async function* () {\n";
var SUFFIX = "\n})";
var PATH_ARG_APIS = /* @__PURE__ */ new Set(["$getAll", "$resolve", "$trackDependency"]);
var UNTRACK_API = "$untrackDependency";
function collectGetterReads(body) {
  let program;
  try {
    program = parse3(PREFIX + body + SUFFIX, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return null;
  }
  const fn = unwrapWrapper(program);
  if (fn === null) return null;
  const out = [];
  const root = { thisIsState: true, aliases: /* @__PURE__ */ new Set() };
  visit(fn.body, enterFunction(fn, root, true), out);
  return out;
}
function unwrapWrapper(program) {
  if (program.type !== "Program" || program.body.length !== 1) return null;
  const statement = program.body[0];
  if (statement.type !== "ExpressionStatement") return null;
  const expression = statement.expression;
  if (expression.type !== "FunctionExpression") return null;
  return expression;
}
function isNode(value) {
  return typeof value === "object" && value !== null && typeof value.type === "string";
}
function forEachChild(node, fn) {
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) fn(item);
    } else if (isNode(value)) {
      fn(value);
    }
  }
}
function isFunctionNode(node) {
  return node.type === "FunctionExpression" || node.type === "FunctionDeclaration" || node.type === "ArrowFunctionExpression";
}
function isClassNode(node) {
  return node.type === "ClassExpression" || node.type === "ClassDeclaration";
}
function bindingNames(pattern, out) {
  switch (pattern.type) {
    case "Identifier":
      out.add(pattern.name);
      return;
    case "ObjectPattern":
      for (const p of pattern.properties) bindingNames(p.type === "RestElement" ? p.argument : p.value, out);
      return;
    case "ArrayPattern":
      for (const e of pattern.elements) if (e !== null) bindingNames(e, out);
      return;
    case "RestElement":
      bindingNames(pattern.argument, out);
      return;
    case "AssignmentPattern":
      bindingNames(pattern.left, out);
      return;
    default:
      return;
  }
}
function enterFunction(fn, outer, thisIsState) {
  const shadowed = /* @__PURE__ */ new Set();
  const aliasInits = [];
  for (const param of fn.params) bindingNames(param, shadowed);
  const scan = (node) => {
    if (isFunctionNode(node)) {
      if (node.type === "FunctionDeclaration" && node.id !== null) shadowed.add(node.id.name);
      return;
    }
    if (isClassNode(node)) {
      if (node.type === "ClassDeclaration" && node.id !== null) shadowed.add(node.id.name);
      return;
    }
    if (node.type === "VariableDeclarator") {
      if (node.id.type === "Identifier" && node.init !== null && node.init !== void 0 && isStateRootCandidate(node.init)) {
        aliasInits.push({ name: node.id.name, from: node.init.type === "Identifier" ? node.init.name : null });
      } else {
        bindingNames(node.id, shadowed);
      }
    } else if (node.type === "AssignmentExpression" && node.left.type === "Identifier") {
      if (node.operator === "=" && isStateRootCandidate(node.right)) aliasInits.push({ name: node.left.name, from: node.right.type === "Identifier" ? node.right.name : null });
      else shadowed.add(node.left.name);
    } else if (node.type === "CatchClause" && node.param !== null && node.param !== void 0) {
      bindingNames(node.param, shadowed);
    }
    forEachChild(node, scan);
  };
  const isStateRootCandidate = (node) => node.type === "ThisExpression" || node.type === "Identifier";
  scan(fn.body);
  for (const param of fn.params) if (param.type === "AssignmentPattern") scan(param.right);
  const aliases = /* @__PURE__ */ new Set();
  for (const name of outer.aliases) if (!shadowed.has(name)) aliases.add(name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, from } of aliasInits) {
      if (shadowed.has(name) || aliases.has(name)) continue;
      const ok = from === null ? thisIsState : aliases.has(from);
      if (ok) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  for (const { name, from } of aliasInits) {
    const ok = from === null ? thisIsState : aliases.has(from);
    if (!ok) aliases.delete(name);
  }
  return { thisIsState, aliases };
}
function isThisRoot(node, scope) {
  return node.type === "ThisExpression" && scope.thisIsState || node.type === "Identifier" && scope.aliases.has(node.name);
}
function literalString2(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}
function segmentOf(member) {
  const property = member.property;
  if (!member.computed) {
    return property.type === "Identifier" ? { text: property.name, dynamic: null } : { text: null, dynamic: null };
  }
  if (property.type === "Literal" && typeof property.value === "number") {
    return { text: String(property.value), dynamic: null };
  }
  const text = literalString2(property);
  if (text !== null) return { text, dynamic: null };
  return property.type === "PrivateIdentifier" ? { text: null, dynamic: null } : { text: null, dynamic: property };
}
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}
function resolveChain(node) {
  const segments = [];
  let current2 = unwrapChain(node);
  while (current2.type === "MemberExpression") {
    segments.unshift(segmentOf(current2));
    current2 = unwrapChain(current2.object);
  }
  return { segments, base: current2 };
}
function emit(out, segments, options, start, end) {
  if (segments.length === 0) return;
  const root = segments[0].text;
  if (root === null || root.length === 0 || root.startsWith("$")) return;
  let chain = [];
  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text;
    if (text === null || i > 0 && text.includes(".")) {
      chain = null;
      break;
    }
    chain.push(text);
  }
  out.push({
    path: root,
    chain,
    form: options.form,
    callee: options.callee,
    written: options.written,
    start: start - PREFIX.length,
    end: end - PREFIX.length
  });
}
function visit(node, scope, out) {
  if (isFunctionNode(node)) {
    const inner = enterFunction(node, scope, node.type === "ArrowFunctionExpression" ? scope.thisIsState : false);
    for (const param of node.params) if (param.type === "AssignmentPattern") visit(param.right, inner, out);
    visit(node.body, inner, out);
    return;
  }
  if (isClassNode(node)) {
    const inner = { thisIsState: false, aliases: scope.aliases };
    forEachChild(node, (child) => visit(child, inner, out));
    return;
  }
  switch (node.type) {
    case "ChainExpression":
      visit(node.expression, scope, out);
      return;
    case "MemberExpression":
      visitMember(node, scope, out, { form: "member", callee: false, written: false });
      return;
    case "CallExpression":
      visitCall(node, scope, out);
      return;
    case "AssignmentExpression":
      if (node.operator === "=") visitWriteTarget(node.left, scope, out);
      else visitReadWriteTarget(node.left, scope, out);
      visit(node.right, scope, out);
      return;
    case "UpdateExpression":
      visitReadWriteTarget(node.argument, scope, out);
      return;
    case "VariableDeclarator":
      visitDeclarator(node, scope, out);
      return;
    default:
      forEachChild(node, (child) => visit(child, scope, out));
  }
}
function visitMember(node, scope, out, options) {
  const { segments, base } = resolveChain(node);
  if (isThisRoot(base, scope)) {
    emit(out, segments, options, node.start, node.end);
  } else {
    visit(base, scope, out);
  }
  for (const segment of segments) {
    if (segment.dynamic !== null) visit(segment.dynamic, scope, out);
  }
}
function visitCall(node, scope, out) {
  const callee = unwrapChain(node.callee);
  if (callee.type === "MemberExpression") {
    const { segments, base } = resolveChain(callee);
    if (isThisRoot(base, scope) && segments.length === 1 && segments[0].text !== null) {
      const api = segments[0].text;
      if (api === UNTRACK_API) return;
      if (PATH_ARG_APIS.has(api)) {
        const first = node.arguments[0];
        const path = first !== void 0 && first.type !== "SpreadElement" ? literalString2(first) : null;
        if (path !== null && path.length > 0 && !path.startsWith("$")) {
          out.push({
            path,
            chain: null,
            form: api === "$trackDependency" ? "track" : "api",
            callee: false,
            written: false,
            start: node.start - PREFIX.length,
            end: node.end - PREFIX.length
          });
        }
        for (const argument of node.arguments) visit(argument, scope, out);
        return;
      }
    }
    visitMember(callee, scope, out, { form: "member", callee: true, written: false });
  } else {
    visit(callee, scope, out);
  }
  for (const argument of node.arguments) visit(argument, scope, out);
}
function visitWriteTarget(target, scope, out) {
  const unwrapped = unwrapChain(target);
  if (unwrapped.type !== "MemberExpression") {
    visit(unwrapped, scope, out);
    return;
  }
  const { segments, base } = resolveChain(unwrapped);
  if (!isThisRoot(base, scope)) visit(base, scope, out);
  for (const segment of segments) {
    if (segment.dynamic !== null) visit(segment.dynamic, scope, out);
  }
}
function visitReadWriteTarget(target, scope, out) {
  const unwrapped = unwrapChain(target);
  if (unwrapped.type !== "MemberExpression") {
    visit(unwrapped, scope, out);
    return;
  }
  visitMember(unwrapped, scope, out, { form: "member", callee: false, written: true });
}
function visitDeclarator(node, scope, out) {
  const init = node.init;
  if (init !== null && init !== void 0 && isThisRoot(init, scope)) {
    if (node.id.type === "ObjectPattern") visitDestructure(node.id, [], scope, out);
    return;
  }
  if (init !== null && init !== void 0 && node.id.type === "ObjectPattern") {
    const { segments, base } = resolveChain(init);
    if (segments.length > 0 && isThisRoot(base, scope)) {
      visitDestructure(node.id, segments, scope, out);
      for (const segment of segments) {
        if (segment.dynamic !== null) visit(segment.dynamic, scope, out);
      }
      return;
    }
  }
  visit(node.id, scope, out);
  if (init !== null && init !== void 0) visit(init, scope, out);
}
function visitDestructure(pattern, prefix, scope, out) {
  for (const property of pattern.properties) {
    if (property.type === "RestElement") continue;
    let key = null;
    if (!property.computed && property.key.type === "Identifier") key = property.key.name;
    else key = literalString2(property.key);
    let value = property.value;
    if (value.type === "AssignmentPattern") {
      visit(value.right, scope, out);
      value = value.left;
    }
    const segments = [...prefix, { text: key, dynamic: null }];
    if (value.type === "ObjectPattern" && value.properties.length > 0) {
      visitDestructure(value, segments, scope, out);
      continue;
    }
    emit(out, segments, { form: "destructure", callee: false, written: false }, property.start, property.end);
  }
}

// ../state/dist/parser.esm.js
var DELIMITER2 = ".";
var WILDCARD2 = "*";
var MAX_WILDCARD_DEPTH2 = 128;
var BINDING_SEPARATOR2 = ";";
var PROP_VALUE_SEPARATOR2 = ":";
var MODIFIER_SEPARATOR2 = "#";
var FILTER_SEPARATOR2 = "|";
var ELSE_KEYWORD2 = "else";
var SPREAD_PROP2 = "...";
var EVENT_PROP_PREFIX2 = "on";
var EVENT_TOKEN_NAMESPACE2 = "eventToken";
var INDEX_PARAM_PREFIX2 = "$";
var tmpIndexByIndexName2 = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH2; i++) {
  tmpIndexByIndexName2[`${INDEX_PARAM_PREFIX2}${i + 1}`] = i;
}
Object.freeze(tmpIndexByIndexName2);
var _cache = /* @__PURE__ */ new Map();
function clearPathInfoCacheForTooling() {
  _cache.clear();
}
var id = 0;
function getPathInfo(path) {
  let pathInfo = _cache.get(path);
  if (typeof pathInfo !== "undefined") {
    return pathInfo;
  }
  pathInfo = Object.freeze(new PathInfo(path));
  _cache.set(path, pathInfo);
  return pathInfo;
}
var PathInfo = class {
  id = ++id;
  path;
  segments;
  lastSegment;
  cumulativePaths;
  cumulativePathSet;
  cumulativePathInfos;
  cumulativePathInfoSet;
  parentPath;
  wildcardPaths;
  wildcardPathSet;
  indexByWildcardPath;
  wildcardPathInfos;
  wildcardPathInfoSet;
  wildcardParentPaths;
  wildcardParentPathSet;
  wildcardParentPathInfos;
  wildcardParentPathInfoSet;
  wildcardPositions;
  lastWildcardPath;
  lastWildcardInfo;
  wildcardCount;
  parentPathInfo;
  constructor(path) {
    const getPattern = (_path) => {
      return path === _path ? this : getPathInfo(_path);
    };
    const segments = path.split(".");
    const cumulativePaths = [];
    const cumulativePathInfos = [];
    const wildcardPaths = [];
    const indexByWildcardPath = {};
    const wildcardPathInfos = [];
    const wildcardParentPaths = [];
    const wildcardParentPathInfos = [];
    const wildcardPositions = [];
    let currentPatternPath = "", prevPatternPath = "";
    let wildcardCount = 0;
    for (let i = 0; i < segments.length; i++) {
      currentPatternPath += segments[i];
      if (segments[i] === WILDCARD2) {
        wildcardPaths.push(currentPatternPath);
        indexByWildcardPath[currentPatternPath] = wildcardCount;
        wildcardPathInfos.push(getPattern(currentPatternPath));
        wildcardParentPaths.push(prevPatternPath);
        wildcardParentPathInfos.push(getPattern(prevPatternPath));
        wildcardPositions.push(i);
        wildcardCount++;
      }
      cumulativePaths.push(currentPatternPath);
      cumulativePathInfos.push(getPattern(currentPatternPath));
      prevPatternPath = currentPatternPath;
      currentPatternPath += ".";
    }
    const lastWildcardPath = wildcardPaths.length > 0 ? wildcardPaths[wildcardPaths.length - 1] : null;
    const parentPath = cumulativePaths.length > 1 ? cumulativePaths[cumulativePaths.length - 2] : null;
    this.path = path;
    this.segments = segments;
    this.lastSegment = segments[segments.length - 1];
    this.cumulativePaths = cumulativePaths;
    this.cumulativePathSet = new Set(cumulativePaths);
    this.cumulativePathInfos = cumulativePathInfos;
    this.cumulativePathInfoSet = new Set(cumulativePathInfos);
    this.wildcardPaths = wildcardPaths;
    this.wildcardPathSet = new Set(wildcardPaths);
    this.indexByWildcardPath = indexByWildcardPath;
    this.wildcardPathInfos = wildcardPathInfos;
    this.wildcardPathInfoSet = new Set(wildcardPathInfos);
    this.wildcardParentPaths = wildcardParentPaths;
    this.wildcardParentPathSet = new Set(wildcardParentPaths);
    this.wildcardParentPathInfos = wildcardParentPathInfos;
    this.wildcardParentPathInfoSet = new Set(wildcardParentPathInfos);
    this.wildcardPositions = wildcardPositions;
    this.lastWildcardPath = lastWildcardPath;
    this.lastWildcardInfo = lastWildcardPath ? getPattern(lastWildcardPath) : null;
    this.parentPath = parentPath;
    this.parentPathInfo = parentPath ? getPattern(parentPath) : null;
    this.wildcardCount = wildcardCount;
  }
};
function editDistance2(a, b, max) {
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
    const distance = editDistance2(folded, candidate.toLowerCase(), 2);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null ? ` Did you mean "${best}"?` : "";
}
var LINT_HINT = " Validate statically: npx @wcstack/lint <file>.";
function raiseError2(message) {
  throw new Error(`[@wcstack/state] ${message}`);
}
var STRUCTURAL_BINDING_TYPE_SET2 = /* @__PURE__ */ new Set([
  "if",
  "elseif",
  "else",
  "for"
]);
var _config2 = {
  locale: "en"
};
var config2 = _config2;
function optionsRequired2(fnName) {
  raiseError2(`filter ${fnName} requires at least one option`);
}
function optionMustBeNumber2(fnName) {
  raiseError2(`filter ${fnName} requires a number as option`);
}
function valueMustBeNumber2(fnName) {
  raiseError2(`filter ${fnName} requires a number value`);
}
function valueMustBeBoolean2(fnName) {
  raiseError2(`filter ${fnName} requires a boolean value`);
}
function valueMustBeDate2(fnName) {
  raiseError2(`filter ${fnName} requires a date value`);
}
function valueMustBeArray2(fnName) {
  raiseError2(`filter ${fnName} requires an array value`);
}
function validateNumberString2(value) {
  if (!value || isNaN(Number(value))) {
    return false;
  }
  return true;
}
var eq2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("eq");
  return (value) => {
    if (typeof value === "number") {
      if (!validateNumberString2(opt)) {
        optionMustBeNumber2("eq");
      }
      return value === Number(opt);
    }
    if (typeof value === "string") {
      return value === opt;
    }
    return value === opt;
  };
};
var ne2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("ne");
  return (value) => {
    if (typeof value === "number") {
      if (!validateNumberString2(opt)) {
        optionMustBeNumber2("ne");
      }
      return value !== Number(opt);
    }
    if (typeof value === "string") {
      return value !== opt;
    }
    return value !== opt;
  };
};
var not2 = (_options) => {
  return (value) => {
    if (typeof value !== "boolean") {
      valueMustBeBoolean2("not");
    }
    return !value;
  };
};
var lt2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("lt");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("lt");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("lt");
    }
    return value < Number(opt);
  };
};
var le2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("le");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("le");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("le");
    }
    return value <= Number(opt);
  };
};
var gt2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("gt");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("gt");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("gt");
    }
    return value > Number(opt);
  };
};
var ge2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("ge");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("ge");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("ge");
    }
    return value >= Number(opt);
  };
};
var inc2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("inc");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("inc");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("inc");
    }
    return value + Number(opt);
  };
};
var dec2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("dec");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("dec");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("dec");
    }
    return value - Number(opt);
  };
};
var mul2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("mul");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("mul");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("mul");
    }
    return value * Number(opt);
  };
};
var div2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("div");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("div");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("div");
    }
    return value / Number(opt);
  };
};
var mod2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("mod");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("mod");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("mod");
    }
    return value % Number(opt);
  };
};
var abs2 = (_options) => {
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("abs");
    }
    return Math.abs(value);
  };
};
var clamp2 = (options) => {
  const opt1 = options?.[0] ?? optionsRequired2("clamp");
  if (!validateNumberString2(opt1)) {
    optionMustBeNumber2("clamp");
  }
  const opt2 = options?.[1] ?? optionsRequired2("clamp");
  if (!validateNumberString2(opt2)) {
    optionMustBeNumber2("clamp");
  }
  const min = Number(opt1);
  const max = Number(opt2);
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("clamp");
    }
    return Math.min(Math.max(value, min), max);
  };
};
var fix2 = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("fix");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("fix");
    }
    return value.toFixed(Number(opt));
  };
};
var locale2 = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("locale");
    }
    return value.toLocaleString(explicit ?? config2.locale);
  };
};
var uc2 = (_options) => {
  return (value) => {
    return String(value).toUpperCase();
  };
};
var lc2 = (_options) => {
  return (value) => {
    return String(value).toLowerCase();
  };
};
var cap2 = (_options) => {
  return (value) => {
    const v = String(value);
    if (v.length === 0) {
      return v;
    }
    if (v.length === 1) {
      return v.toUpperCase();
    }
    return v.charAt(0).toUpperCase() + v.slice(1);
  };
};
var trim2 = (_options) => {
  return (value) => {
    return String(value).trim();
  };
};
var slice2 = (options) => {
  const numberedOpts = [];
  const opt1 = options?.[0] ?? optionsRequired2("slice");
  if (!validateNumberString2(opt1)) {
    optionMustBeNumber2("slice");
  }
  numberedOpts.push(Number(opt1));
  const opt2 = options?.[1];
  if (typeof opt2 !== "undefined") {
    if (!validateNumberString2(opt2)) {
      optionMustBeNumber2("slice");
    }
    numberedOpts.push(Number(opt2));
  }
  return (value) => {
    return String(value).slice(...numberedOpts);
  };
};
var substr2 = (options) => {
  const opt1 = options?.[0] ?? optionsRequired2("substr");
  if (!validateNumberString2(opt1)) {
    optionMustBeNumber2("substr");
  }
  const opt2 = options?.[1] ?? optionsRequired2("substr");
  if (!validateNumberString2(opt2)) {
    optionMustBeNumber2("substr");
  }
  return (value) => {
    return String(value).substr(Number(opt1), Number(opt2));
  };
};
var pad2 = (options) => {
  const opt1 = options?.[0] ?? optionsRequired2("pad");
  if (!validateNumberString2(opt1)) {
    optionMustBeNumber2("pad");
  }
  const opt2 = options?.[1] ?? "0";
  return (value) => {
    return String(value).padStart(Number(opt1), opt2);
  };
};
var rep2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("rep");
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("rep");
  }
  return (value) => {
    return String(value).repeat(Number(opt));
  };
};
var rev2 = (_options) => {
  return (value) => {
    return String(value).split("").reverse().join("");
  };
};
var int2 = (_options) => {
  return (value) => {
    return parseInt(String(value), 10);
  };
};
var float2 = (_options) => {
  return (value) => {
    return parseFloat(String(value));
  };
};
var round2 = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("round");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("round");
    }
    const optValue = Math.pow(10, Number(opt));
    return Math.round(value * optValue) / optValue;
  };
};
var floor2 = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("floor");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("floor");
    }
    const optValue = Math.pow(10, Number(opt));
    return Math.floor(value * optValue) / optValue;
  };
};
var ceil2 = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("ceil");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("ceil");
    }
    const optValue = Math.pow(10, Number(opt));
    return Math.ceil(value * optValue) / optValue;
  };
};
var percent2 = (options) => {
  const opt = options?.[0] ?? "0";
  if (!validateNumberString2(opt)) {
    optionMustBeNumber2("percent");
  }
  return (value) => {
    if (typeof value !== "number") {
      valueMustBeNumber2("percent");
    }
    return `${(value * 100).toFixed(Number(opt))}%`;
  };
};
var unit2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("unit");
  return (value) => {
    if (value === null || typeof value === "undefined") {
      return value;
    }
    return String(value) + opt;
  };
};
var join2 = (options) => {
  const opt = options?.[0] ?? ", ";
  return (value) => {
    if (!Array.isArray(value)) {
      valueMustBeArray2("join");
    }
    return value.join(opt);
  };
};
var truncate2 = (options) => {
  const opt1 = options?.[0] ?? optionsRequired2("truncate");
  if (!validateNumberString2(opt1)) {
    optionMustBeNumber2("truncate");
  }
  const maxLength = Number(opt1);
  const suffix = options?.[1] ?? "\u2026";
  return (value) => {
    const v = String(value);
    if (v.length <= maxLength) {
      return v;
    }
    return v.slice(0, maxLength) + suffix;
  };
};
var date2 = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate2("date");
    }
    return value.toLocaleDateString(explicit ?? config2.locale);
  };
};
var time2 = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate2("time");
    }
    return value.toLocaleTimeString(explicit ?? config2.locale);
  };
};
var datetime2 = (options) => {
  const explicit = options?.[0];
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate2("datetime");
    }
    return value.toLocaleString(explicit ?? config2.locale);
  };
};
var ymd2 = (options) => {
  const opt = options?.[0] ?? "-";
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate2("ymd");
    }
    const year = value.getFullYear().toString();
    const month = (value.getMonth() + 1).toString().padStart(2, "0");
    const day = value.getDate().toString().padStart(2, "0");
    return `${year}${opt}${month}${opt}${day}`;
  };
};
var hms2 = (options) => {
  const opt = options?.[0] ?? ":";
  return (value) => {
    if (!(value instanceof Date)) {
      valueMustBeDate2("hms");
    }
    const hours = value.getHours().toString().padStart(2, "0");
    const minutes = value.getMinutes().toString().padStart(2, "0");
    const seconds = value.getSeconds().toString().padStart(2, "0");
    return `${hours}${opt}${minutes}${opt}${seconds}`;
  };
};
var falsy2 = (_options) => {
  return (value) => value === false || value === null || value === void 0 || value === 0 || value === "" || Number.isNaN(value);
};
var truthy2 = (_options) => {
  return (value) => value !== false && value !== null && value !== void 0 && value !== 0 && value !== "" && !Number.isNaN(value);
};
var defaults2 = (options) => {
  const opt = options?.[0] ?? optionsRequired2("defaults");
  return (value) => {
    if (value === false || value === null || value === void 0 || value === 0 || value === "" || Number.isNaN(value)) {
      return opt;
    }
    return value;
  };
};
var boolean2 = (_options) => {
  return (value) => {
    return Boolean(value);
  };
};
var number2 = (_options) => {
  return (value) => {
    return Number(value);
  };
};
var string2 = (_options) => {
  return (value) => {
    return String(value);
  };
};
var _null2 = (_options) => {
  return (value) => {
    return value === "" ? null : value;
  };
};
var builtinFilters2 = {
  "eq": eq2,
  "ne": ne2,
  "not": not2,
  "lt": lt2,
  "le": le2,
  "gt": gt2,
  "ge": ge2,
  "inc": inc2,
  "dec": dec2,
  "mul": mul2,
  "div": div2,
  "mod": mod2,
  "abs": abs2,
  "clamp": clamp2,
  "fix": fix2,
  "locale": locale2,
  "uc": uc2,
  "lc": lc2,
  "cap": cap2,
  "trim": trim2,
  "slice": slice2,
  "substr": substr2,
  "pad": pad2,
  "rep": rep2,
  "rev": rev2,
  "truncate": truncate2,
  "join": join2,
  "int": int2,
  "float": float2,
  "round": round2,
  "floor": floor2,
  "ceil": ceil2,
  "percent": percent2,
  "unit": unit2,
  "date": date2,
  "time": time2,
  "datetime": datetime2,
  "ymd": ymd2,
  "hms": hms2,
  "falsy": falsy2,
  "truthy": truthy2,
  "defaults": defaults2,
  "boolean": boolean2,
  "number": number2,
  "string": string2,
  "null": _null2
};
var outputBuiltinFilters2 = builtinFilters2;
var inputBuiltinFilters = builtinFilters2;
var builtinFiltersByFilterIOType = {
  "input": inputBuiltinFilters,
  "output": outputBuiltinFilters2
};
var builtinFilterFn = (name, options) => (filters) => {
  const filter = filters[name];
  if (!filter) {
    raiseError2(`[wcs/filter-unknown] filter not found: ${name}.${didYouMean(name, Object.keys(filters))}${LINT_HINT}`);
  }
  return filter(options);
};
function finalizeArg(text, firstQuoteStart, lastQuoteEnd) {
  const startLimit = firstQuoteStart === -1 ? text.length : firstQuoteStart;
  let start = 0;
  while (start < startLimit && /\s/.test(text[start])) {
    start++;
  }
  const endLimit = lastQuoteEnd === -1 ? 0 : lastQuoteEnd;
  let end = text.length;
  while (end > endLimit && /\s/.test(text[end - 1])) {
    end--;
  }
  return text.slice(start, end);
}
function parseFilterArgs(argsText) {
  const args = [];
  let current2 = "";
  let inQuote = null;
  let hasQuote = false;
  let firstQuoteStart = -1;
  let lastQuoteEnd = -1;
  const flush = () => {
    args.push(finalizeArg(current2, firstQuoteStart, lastQuoteEnd));
    current2 = "";
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
          firstQuoteStart = current2.length;
        }
        current2 += char;
        lastQuoteEnd = current2.length;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
      hasQuote = true;
    } else if (char === ",") {
      flush();
    } else {
      current2 += char;
    }
  }
  const last = finalizeArg(current2, firstQuoteStart, lastQuoteEnd);
  if (last || hasQuote) {
    args.push(last);
  }
  return args;
}
var filterFnByKey = /* @__PURE__ */ new Map();
function clearFilterFnCacheForTooling() {
  filterFnByKey.clear();
}
function parseFilters(filterTextList, filterIOType) {
  const builtinFilters3 = builtinFiltersByFilterIOType[filterIOType];
  const filters = filterTextList.map((filterText) => {
    const openParenIndex = filterText.indexOf("(");
    const closeParenIndex = filterText.lastIndexOf(")");
    if (openParenIndex !== -1 && closeParenIndex === -1) {
      raiseError2(`Invalid filter format: missing closing parenthesis in "${filterText}"`);
    }
    if (closeParenIndex !== -1 && openParenIndex === -1) {
      raiseError2(`Invalid filter format: missing opening parenthesis in "${filterText}"`);
    }
    if (openParenIndex === -1) {
      const filterName = filterText.trim();
      const filterKey = `${filterName}():${filterIOType}`;
      let filterFn = filterFnByKey.get(filterKey);
      if (typeof filterFn === "undefined") {
        filterFn = builtinFilterFn(filterName, [])(builtinFilters3);
        filterFnByKey.set(filterKey, filterFn);
      }
      return {
        filterName,
        args: [],
        filterFn
      };
    } else {
      const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
      const filterName = filterText.substring(0, openParenIndex).trim();
      const args = parseFilterArgs(argsText);
      const filterKey = `${filterName}(${args.join(",")}):${filterIOType}`;
      let filterFn = filterFnByKey.get(filterKey);
      if (typeof filterFn === "undefined") {
        filterFn = builtinFilterFn(filterName, args)(builtinFilters3);
        filterFnByKey.set(filterKey, filterFn);
      }
      return {
        filterName,
        args,
        filterFn
      };
    }
  });
  return filters;
}
var trimFn = (s) => s.trim();
var cacheFilterInfos$1 = /* @__PURE__ */ new Map();
function clearPropPartCacheForTooling() {
  cacheFilterInfos$1.clear();
}
function parsePropPart(propPart) {
  const pos = propPart.indexOf(FILTER_SEPARATOR2);
  let propText = "";
  let filterTexts = [];
  let filtersText = "";
  let filters = [];
  if (pos !== -1) {
    propText = propPart.slice(0, pos).trim();
    filtersText = propPart.slice(pos + 1).trim();
    if (cacheFilterInfos$1.has(filtersText)) {
      filters = cacheFilterInfos$1.get(filtersText);
    } else {
      filterTexts = filtersText.split(FILTER_SEPARATOR2).map(trimFn);
      filters = parseFilters(filterTexts, "input");
      cacheFilterInfos$1.set(filtersText, filters);
    }
  } else {
    propText = propPart.trim();
  }
  const [propName, propModifiersText] = propText.split(MODIFIER_SEPARATOR2).map(trimFn);
  const propSegments = propName.split(DELIMITER2).map(trimFn);
  const propModifiers = propModifiersText ? propModifiersText.split(",").map(trimFn) : [];
  return {
    propName,
    propSegments,
    propModifiers,
    inFilters: filters
  };
}
var cacheFilterInfos = /* @__PURE__ */ new Map();
function clearStatePartCacheForTooling() {
  cacheFilterInfos.clear();
}
function parseStatePart(statePart) {
  const pos = statePart.indexOf(FILTER_SEPARATOR2);
  let stateAndPath = "";
  let filterTexts = [];
  let filtersText = "";
  let filters = [];
  if (pos !== -1) {
    stateAndPath = statePart.slice(0, pos).trim();
    filtersText = statePart.slice(pos + 1).trim();
    if (cacheFilterInfos.has(filtersText)) {
      filters = cacheFilterInfos.get(filtersText);
    } else {
      filterTexts = filtersText.split(FILTER_SEPARATOR2).map(trimFn);
      filters = parseFilters(filterTexts, "output");
      cacheFilterInfos.set(filtersText, filters);
    }
  } else {
    stateAndPath = statePart.trim();
  }
  if (stateAndPath.indexOf("@") !== -1) {
    raiseError2(`"${stateAndPath}": the "@name" selector was removed in v2 \u2014 there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.`);
  }
  const statePathName = stateAndPath;
  const pathInfo = getPathInfo(statePathName);
  return {
    statePathName,
    statePathInfo: pathInfo,
    outFilters: filters
  };
}
function parseBindTextsForElement(bindText) {
  const [...bindTexts] = bindText.split(BINDING_SEPARATOR2).map(trimFn).filter((s) => s.length > 0);
  const results = bindTexts.map((bindText2) => {
    const separatorIndex = bindText2.indexOf(PROP_VALUE_SEPARATOR2);
    if (separatorIndex === -1) {
      raiseError2(`Invalid bindText: "${bindText2}". Missing ':' separator between propPart and statePart.`);
    }
    const propPart = bindText2.slice(0, separatorIndex).trim();
    const statePart = bindText2.slice(separatorIndex + 1).trim();
    if (propPart === ELSE_KEYWORD2) {
      const pathInfo = getPathInfo("#else");
      return {
        propName: ELSE_KEYWORD2,
        propSegments: [ELSE_KEYWORD2],
        propModifiers: [],
        statePathName: "#else",
        statePathInfo: pathInfo,
        inFilters: [],
        outFilters: [],
        bindingType: "else"
      };
    } else if (propPart === SPREAD_PROP2) {
      const stateResult = parseStatePart(statePart);
      if (stateResult.outFilters.length > 0) {
        raiseError2(`Invalid spread binding "${bindText2}": filters are not allowed on spread targets.`);
      }
      if (stateResult.statePathName.length === 0) {
        raiseError2(`Invalid spread binding "${bindText2}": spread target path is required.`);
      }
      return {
        propName: SPREAD_PROP2,
        propSegments: [SPREAD_PROP2],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: "spread"
      };
    } else if (propPart === "if" || propPart === "elseif" || propPart === "for" || propPart === "radio" || propPart === "checkbox") {
      const stateResult = parseStatePart(statePart);
      return {
        propName: propPart,
        propSegments: [propPart],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: propPart
      };
    } else {
      const stateResult = parseStatePart(statePart);
      const propResult = parsePropPart(propPart);
      if (propResult.propSegments[0] === EVENT_TOKEN_NAMESPACE2) {
        return {
          ...propResult,
          ...stateResult,
          bindingType: "event"
        };
      }
      if (propResult.propSegments[0].startsWith(EVENT_PROP_PREFIX2)) {
        return {
          ...propResult,
          ...stateResult,
          bindingType: "event"
        };
      } else {
        return {
          ...propResult,
          ...stateResult,
          bindingType: "prop"
        };
      }
    }
  });
  if (results.length > 1) {
    const isIncludeSingleBinding = results.some((r) => STRUCTURAL_BINDING_TYPE_SET2.has(r.bindingType));
    if (isIncludeSingleBinding) {
      raiseError2(`[wcs/template-syntax] Invalid bindText: "${bindText}". 'if', 'elseif', 'else', and 'for' bindings must be single binding. Put the structural binding alone in its own data-wcs (e.g. <template data-wcs="for: items">).${LINT_HINT}`);
    }
  }
  return results;
}
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
function clearParserCaches() {
  clearPathInfoCacheForTooling();
  clearPropPartCacheForTooling();
  clearStatePartCacheForTooling();
  clearFilterFnCacheForTooling();
}

// src/core/parser/positionalParser.ts
var { delimiters } = getWcsManifest().syntax;
function locate(haystack, needle, from, to) {
  if (needle.length === 0) return null;
  const index = haystack.indexOf(needle, from);
  if (index === -1 || index + needle.length > to) return null;
  return { start: index, end: index + needle.length };
}
function parseEmbeddedTextWithPositions(expression) {
  const exprRange = { start: 0, end: expression.length };
  let parsed = null;
  let error = null;
  try {
    parsed = parseBindTextForEmbeddedNode(expression);
  } catch (e) {
    error = e.message;
  }
  if (parsed === null) {
    return { exprRange, exprText: expression, parsed, error, propRange: null, pathRange: null };
  }
  const firstPipe = expression.indexOf(delimiters.filter);
  const pathScopeEnd = firstPipe === -1 ? expression.length : firstPipe;
  const pathLocal = locate(expression, parsed.statePathName, 0, pathScopeEnd);
  return {
    exprRange,
    exprText: expression,
    parsed,
    error,
    propRange: null,
    pathRange: pathLocal
  };
}
function parseBindTextWithPositions(bindText) {
  const results = [];
  const segments = bindText.split(delimiters.binding);
  let segmentStart = 0;
  for (const segment of segments) {
    const leading = segment.length - segment.trimStart().length;
    const expr = segment.trim();
    const exprStart = segmentStart + leading;
    segmentStart += segment.length + delimiters.binding.length;
    if (expr.length === 0) continue;
    const exprRange = { start: exprStart, end: exprStart + expr.length };
    let parsed = null;
    let error = null;
    try {
      parsed = parseBindTextsForElement(expr)[0] ?? null;
    } catch (e) {
      error = e.message;
    }
    if (parsed === null) {
      results.push({ exprRange, exprText: expr, parsed, error, propRange: null, pathRange: null });
      continue;
    }
    const colon = expr.indexOf(delimiters.propValue);
    const propEndLimit = colon === -1 ? expr.length : colon;
    const propLocal = locate(expr, parsed.propName, 0, propEndLimit);
    let pathLocal = null;
    if (colon !== -1) {
      const stateBase = colon + 1;
      const firstPipe = expr.indexOf(delimiters.filter, stateBase);
      const pathScopeEnd = firstPipe === -1 ? expr.length : firstPipe;
      pathLocal = locate(expr, parsed.statePathName, stateBase, pathScopeEnd);
    }
    const lift = (range) => range === null ? null : { start: exprStart + range.start, end: exprStart + range.end };
    results.push({
      exprRange,
      exprText: expr,
      parsed,
      error,
      propRange: lift(propLocal),
      pathRange: lift(pathLocal)
    });
  }
  return results;
}

// src/core/index/referenceIndex.ts
function buildReferenceIndex(html, options = {}) {
  clearParserCaches();
  const bindAttribute = options.bindAttribute ?? "data-wcs";
  const stateTagName = options.stateTagName ?? "wcs-state";
  const occurrences = [];
  const problems = [];
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    for (const binding of parseBindTextWithPositions(attr.value)) {
      const lift = (range) => ({ start: attr.valueStart + range.start, end: attr.valueStart + range.end });
      if (binding.parsed === null) {
        problems.push({ message: binding.error ?? "parse error", range: lift(binding.exprRange) });
        continue;
      }
      if (binding.pathRange === null) continue;
      occurrences.push({
        source: "attribute",
        kind: binding.parsed.propSegments[0] === "eventToken" ? "eventToken" : "path",
        path: binding.parsed.statePathName,
        pathRange: lift(binding.pathRange),
        exprRange: lift(binding.exprRange),
        propName: binding.parsed.propName,
        propRange: binding.propRange === null ? null : lift(binding.propRange),
        bindingType: binding.parsed.bindingType
      });
    }
  }
  const textMatches = [
    ...findAllMustacheSyntax(html),
    ...findAllCommentBindings(html)
  ];
  for (const match of textMatches) {
    const binding = parseEmbeddedTextWithPositions(match.expression);
    const shift = (range) => ({
      start: match.exprStart + range.start,
      end: match.exprStart + range.end
    });
    if (binding.parsed === null) {
      problems.push({ message: binding.error ?? "parse error", range: shift(binding.exprRange) });
      continue;
    }
    if (binding.pathRange === null) continue;
    occurrences.push({
      source: match.kind,
      kind: "path",
      path: binding.parsed.statePathName,
      pathRange: shift(binding.pathRange),
      exprRange: { start: match.exprStart, end: match.exprEnd },
      propName: null,
      propRange: null,
      bindingType: "text"
    });
  }
  const declarations = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    const prefix = block.mountPath === null ? "" : block.mountPath + ".";
    for (const span of analyzeDeclarationSpans(block.content)) {
      if (prefix !== "" && span.name.startsWith("$")) continue;
      declarations.push({
        name: prefix + span.name,
        kind: span.kind,
        range: { start: block.contentStart + span.start, end: block.contentStart + span.end }
      });
    }
  }
  const byPath = /* @__PURE__ */ new Map();
  for (const occurrence of occurrences) {
    if (occurrence.kind !== "path") continue;
    const key = occurrence.path;
    const list = byPath.get(key);
    if (list === void 0) {
      byPath.set(key, [occurrence]);
    } else {
      list.push(occurrence);
    }
  }
  const declarationByName = /* @__PURE__ */ new Map();
  for (const declaration of declarations) {
    const key = declaration.name;
    if (!declarationByName.has(key)) declarationByName.set(key, declaration);
  }
  return {
    occurrences,
    declarations,
    problems,
    referencesOf(path) {
      return (byPath.get(path) ?? []).slice();
    },
    declarationOf(path) {
      const exact = declarationByName.get(path);
      if (exact !== void 0) return exact;
      const firstSegment = path.split(".")[0];
      if (firstSegment === path) return null;
      return declarationByName.get(firstSegment) ?? null;
    },
    occurrenceAt(offset2) {
      for (const occurrence of occurrences) {
        if (offset2 >= occurrence.pathRange.start && offset2 < occurrence.pathRange.end) {
          return occurrence;
        }
      }
      return null;
    }
  };
}

// src/service/semanticValidator.ts
var STATE_UPDATED_CALLBACK = "$updatedCallback";
var API_CALL = /\.\s*\$(getAll|setAll|resolve)\s*\(/g;
function validateIndexArity(script, scriptStart, locale3) {
  const msgs = getMessages(locale3);
  const out = [];
  API_CALL.lastIndex = 0;
  let match;
  while ((match = API_CALL.exec(script)) !== null) {
    const api = `$${match[1]}`;
    const parsed = splitCallArgs(script, match.index + match[0].length);
    if (parsed === null) continue;
    API_CALL.lastIndex = parsed.end;
    if (parsed.args.length < 2) continue;
    const path = literalString(parsed.args[0]);
    if (path === null) continue;
    if (hasRecursionWildcard(path)) continue;
    const actual = literalArrayLength(parsed.args[1]);
    if (actual === null) continue;
    const wildcardCount = countWildcardSegments(path);
    const requirement = api === "$resolve" ? "exact" : "atMost";
    const mismatched = requirement === "exact" ? actual !== wildcardCount : actual > wildcardCount;
    if (!mismatched) continue;
    const argText = parsed.args[1];
    const leading = argText.length - argText.trimStart().length;
    out.push({
      code: WcsDiagnosticCode.IndexArity,
      start: scriptStart + parsed.starts[1] + leading,
      end: scriptStart + parsed.starts[1] + argText.trimEnd().length,
      message: msgs.indexArity(api, path, requirement, wildcardCount, actual),
      severity: "warning"
    });
  }
  return out;
}
function validateGetterCycles(script, scriptStart, locale3) {
  const msgs = getMessages(locale3);
  const getters = analyzeCallableBodies(script).filter((entry) => entry.kind === "getter");
  if (getters.length === 0) return [];
  const declared = new Set(getters.map((getter) => getter.name));
  const edges = /* @__PURE__ */ new Map();
  for (const getter of getters) {
    if (getter.accessor === "set") continue;
    const targets = /* @__PURE__ */ new Set();
    for (const read of collectGetterReads(getter.body) ?? []) {
      if (declared.has(read.path)) targets.add(read.path);
    }
    edges.set(getter.name, [...targets]);
  }
  const gray = /* @__PURE__ */ new Set();
  const black = /* @__PURE__ */ new Set();
  const stack = [];
  const cyclesByEntry = /* @__PURE__ */ new Map();
  const visit2 = (name) => {
    if (black.has(name)) return;
    if (gray.has(name)) {
      const from = stack.indexOf(name);
      const cycle = stack.slice(from).concat(name).join(" -> ");
      for (const member of stack.slice(from)) {
        if (!cyclesByEntry.has(member)) cyclesByEntry.set(member, cycle);
      }
      return;
    }
    gray.add(name);
    stack.push(name);
    for (const next of edges.get(name) ?? []) {
      visit2(next);
    }
    stack.pop();
    gray.delete(name);
    black.add(name);
  };
  for (const getter of getters) {
    visit2(getter.name);
  }
  if (cyclesByEntry.size === 0) return [];
  const out = [];
  for (const getter of getters) {
    if (getter.accessor === "set") continue;
    const cycle = cyclesByEntry.get(getter.name);
    if (cycle === void 0) continue;
    out.push({
      code: WcsDiagnosticCode.GetterCycle,
      start: scriptStart + getter.start,
      end: scriptStart + getter.end,
      message: msgs.getterCycle(cycle),
      severity: "warning"
    });
  }
  return out;
}
function validateGetterUntrackedReads(script, scriptStart, nestedWriteRoots, locale3) {
  const getters = analyzeCallableBodies(script).filter((entry) => entry.kind === "getter" && entry.accessor === "get");
  if (getters.length === 0) return [];
  const objectRoots = /* @__PURE__ */ new Set();
  for (const candidate of analyzeStatePaths(script)) {
    if (candidate.kind === "data" && candidate.rawInitial !== void 0 && isObjectLiteral(candidate.rawInitial)) {
      objectRoots.add(candidate.path);
    }
  }
  if (objectRoots.size === 0) return [];
  const msgs = getMessages(locale3);
  const out = [];
  for (const getter of getters) {
    for (const read of collectGetterReads(getter.body) ?? []) {
      if (read.form !== "member" && read.form !== "destructure" || read.chain === null) continue;
      if (read.written) continue;
      const segments = read.callee ? read.chain.slice(0, -1) : read.chain;
      if (segments.length < 2 || !objectRoots.has(segments[0])) continue;
      if (!nestedWriteRoots().has(segments[0])) continue;
      out.push({
        code: WcsDiagnosticCode.GetterUntrackedRead,
        start: scriptStart + getter.bodyStart + read.start,
        end: scriptStart + getter.bodyStart + read.end,
        message: msgs.getterUntrackedRead(segments[0], segments.join(".")),
        severity: "warning"
      });
    }
  }
  return out;
}
var TWO_WAY_PROPS = /* @__PURE__ */ new Set(["value", "checked"]);
var BRACKET_WRITE = new RegExp(`${ROOT_BRACKET}${ASSIGN_TAIL}`, "g");
var PRE_BRACKET_INCDEC = new RegExp(`${PRE_INCDEC}${ROOT_BRACKET}`, "g");
function collectNestedWriteRoots(html, stateTagName, bindAttrName, blocks) {
  const roots = /* @__PURE__ */ new Set();
  const addPrefixes = (path, inclusive) => {
    const segments = path.split(".");
    const last = inclusive ? segments.length : segments.length - 1;
    for (let i = 1; i <= last; i++) roots.add(segments.slice(0, i).join("."));
  };
  const tags = findBuiltinTagOccurrences(html).map((occ) => ({
    contract: BUILTIN_TAGS[occ.tagName],
    start: occ.tagStart,
    end: occ.attrsStart + occ.attrsText.length
  }));
  const index = buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName });
  for (const occ of index.occurrences) {
    if (occ.kind !== "path" || occ.path.startsWith(".") || occ.source !== "attribute") continue;
    if (occ.bindingType === "spread") {
      addPrefixes(occ.path, true);
      continue;
    }
    if (occ.bindingType === "radio" || occ.bindingType === "checkbox") {
      addPrefixes(occ.path, false);
      continue;
    }
    if (occ.bindingType !== "prop" || occ.propName === null) continue;
    if (TWO_WAY_PROPS.has(occ.propName)) {
      addPrefixes(occ.path, false);
      continue;
    }
    const at2 = occ.exprRange.start;
    const tag = tags.find((t) => t.start <= at2 && at2 <= t.end);
    if (tag?.contract?.hasWcBindable && tag.contract.properties.includes(occ.propName)) addPrefixes(occ.path, false);
  }
  for (const block of blocks) {
    if (block.mountPath !== null) addPrefixes(block.mountPath, true);
    const scan = blankComments(block.content);
    for (const regex of [BRACKET_WRITE, PRE_BRACKET_INCDEC]) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(scan)) !== null) addPrefixes(match[1], false);
    }
    API_CALL.lastIndex = 0;
    let call;
    while ((call = API_CALL.exec(scan)) !== null) {
      const api = call[1];
      if (api === "getAll") continue;
      const parsed = splitCallArgs(scan, call.index + call[0].length);
      if (parsed === null) continue;
      API_CALL.lastIndex = parsed.end;
      const path = parsed.args.length > 0 ? literalString(parsed.args[0]) : null;
      if (path === null) continue;
      if (api === "setAll" || parsed.args.length >= 3) addPrefixes(path, false);
    }
  }
  return roots;
}
var PATH_TEST_LITERAL = /(?:\.\s*(?:includes|indexOf)\s*\(\s*|[!=]==\s*)(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
function validateUpdatedCallbackDemand(html, stateTagName, bindAttrName, locale3) {
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  if (blocks.length === 0) return [];
  const hasCallback = blocks.some((block) => block.content.includes(STATE_UPDATED_CALLBACK));
  if (!hasCallback) return [];
  const msgs = getMessages(locale3);
  const boundPaths = collectBoundPaths(html, stateTagName, bindAttrName);
  const out = [];
  for (const block of blocks) {
    const callback = analyzeCallableBodies(block.content).find((entry) => entry.name === STATE_UPDATED_CALLBACK && entry.kind === "method");
    if (callback === void 0) continue;
    if (block.mountPath !== null) continue;
    const declared = new Set(analyzeStatePaths(block.content).map((p) => p.path));
    const bound = boundPaths;
    const body = blankComments(callback.body);
    PATH_TEST_LITERAL.lastIndex = 0;
    let match;
    const reported = /* @__PURE__ */ new Set();
    while ((match = PATH_TEST_LITERAL.exec(body)) !== null) {
      const path = match[2];
      if (path.length === 0 || !declared.has(path) || bound.has(path)) continue;
      if (reported.has(path)) continue;
      reported.add(path);
      const quoteAt = match.index + match[0].length - path.length - 1;
      out.push({
        code: WcsDiagnosticCode.UpdatedCallbackUnbound,
        start: block.contentStart + callback.bodyStart + quoteAt,
        end: block.contentStart + callback.bodyStart + quoteAt + path.length,
        message: msgs.updatedCallbackUnbound(path),
        severity: "warning"
      });
    }
  }
  return out;
}
function collectBoundPaths(html, stateTagName, bindAttrName) {
  const bound = /* @__PURE__ */ new Set();
  const index = buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName });
  for (const occurrence of index.occurrences) {
    bound.add(occurrence.path);
    if (!occurrence.path.startsWith(".")) continue;
    const forPath = getInnermostForPath(html, occurrence.pathRange.start, bindAttrName);
    if (forPath === null || forPath.startsWith(".")) continue;
    bound.add(
      occurrence.path === "." ? `${forPath}.*` : `${forPath}.*.${occurrence.path.slice(1)}`
    );
  }
  return bound;
}
function validateSemantics(html, stateTagName = "wcs-state", locale3, bindAttrName = "data-wcs") {
  const out = [];
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  let nestedWriteRoots = null;
  const getNestedWriteRoots = () => nestedWriteRoots ??= collectNestedWriteRoots(html, stateTagName, bindAttrName, blocks);
  for (const block of blocks) {
    out.push(...validateIndexArity(block.content, block.contentStart, locale3));
    out.push(...validateGetterCycles(block.content, block.contentStart, locale3));
    out.push(...validateGetterUntrackedReads(block.content, block.contentStart, getNestedWriteRoots, locale3));
  }
  out.push(...validateUpdatedCallbackDemand(html, stateTagName, bindAttrName, locale3));
  return out;
}

// src/core/sidecar/jsonSource.ts
var JsonReader = class {
  constructor(text) {
    this.text = text;
  }
  pos = 0;
  spans = /* @__PURE__ */ new Map();
  parse() {
    this.skipWs();
    const value = this.parseValue("", void 0);
    this.skipWs();
    if (this.pos < this.text.length) {
      throw this.fail(`Unexpected trailing content`);
    }
    return { value };
  }
  fail(message) {
    const err = new Error(message);
    err.offset = Math.min(this.pos, this.text.length);
    return err;
  }
  skipWs() {
    while (this.pos < this.text.length) {
      const c = this.text.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13) this.pos++;
      else break;
    }
  }
  parseValue(pointer2, keySpan) {
    this.skipWs();
    const start = this.pos;
    const c = this.text[this.pos];
    let value;
    if (c === "{") value = this.parseObject(pointer2);
    else if (c === "[") value = this.parseArray(pointer2);
    else if (c === '"') value = this.parseString();
    else if (c === "t" || c === "f") value = this.parseKeyword();
    else if (c === "n") value = this.parseNull();
    else if (c === "-" || c >= "0" && c <= "9") value = this.parseNumber();
    else throw this.fail(`Unexpected character`);
    const end = this.pos;
    this.spans.set(pointer2, keySpan === void 0 ? { start, end } : { start, end, ...keySpan });
    return value;
  }
  parseObject(pointer2) {
    this.pos++;
    const obj = {};
    this.skipWs();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return obj;
    }
    for (; ; ) {
      this.skipWs();
      if (this.text[this.pos] !== '"') throw this.fail(`Expected object key`);
      const keyStart = this.pos;
      const key = this.parseString();
      const keyEnd = this.pos;
      this.skipWs();
      if (this.text[this.pos] !== ":") throw this.fail(`Expected ':'`);
      this.pos++;
      const childPointer = `${pointer2}/${escapePointer(key)}`;
      obj[key] = this.parseValue(childPointer, { keyStart, keyEnd });
      this.skipWs();
      const sep = this.text[this.pos];
      if (sep === ",") {
        this.pos++;
        continue;
      }
      if (sep === "}") {
        this.pos++;
        return obj;
      }
      throw this.fail(`Expected ',' or '}'`);
    }
  }
  parseArray(pointer2) {
    this.pos++;
    const arr = [];
    this.skipWs();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return arr;
    }
    let index = 0;
    for (; ; ) {
      const childPointer = `${pointer2}/${index}`;
      arr.push(this.parseValue(childPointer, void 0));
      index++;
      this.skipWs();
      const sep = this.text[this.pos];
      if (sep === ",") {
        this.pos++;
        continue;
      }
      if (sep === "]") {
        this.pos++;
        return arr;
      }
      throw this.fail(`Expected ',' or ']'`);
    }
  }
  parseString() {
    this.pos++;
    let result = "";
    for (; ; ) {
      if (this.pos >= this.text.length) throw this.fail(`Unterminated string`);
      const ch = this.text[this.pos++];
      if (ch === '"') return result;
      if (ch === "\\") {
        const esc = this.text[this.pos++];
        if (esc === '"') result += '"';
        else if (esc === "\\") result += "\\";
        else if (esc === "/") result += "/";
        else if (esc === "b") result += "\b";
        else if (esc === "f") result += "\f";
        else if (esc === "n") result += "\n";
        else if (esc === "r") result += "\r";
        else if (esc === "t") result += "	";
        else if (esc === "u") {
          const hex = this.text.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.fail(`Invalid unicode escape`);
          result += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
        } else throw this.fail(`Invalid escape`);
      } else {
        result += ch;
      }
    }
  }
  parseKeyword() {
    if (this.text.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    throw this.fail(`Invalid literal`);
  }
  parseNull() {
    if (this.text.startsWith("null", this.pos)) {
      this.pos += 4;
      return null;
    }
    throw this.fail(`Invalid literal`);
  }
  parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
    if (match === null) throw this.fail(`Invalid number`);
    this.pos += match[0].length;
    return Number(match[0]);
  }
};
function escapePointer(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
function pointer(...segments) {
  return segments.map((s) => `/${escapePointer(String(s))}`).join("");
}
function parseJsonWithSpans(text) {
  const reader = new JsonReader(text);
  try {
    const { value } = reader.parse();
    return { value, spans: reader.spans, error: null };
  } catch (e) {
    const offset2 = e.offset ?? 0;
    return { value: void 0, spans: reader.spans, error: { offset: offset2, message: e.message } };
  }
}

// src/core/sidecar/types.ts
var SUPPORTED_SCHEMA_VERSION = 2;
var SUPPORTED_NAMESPACE_VERSION = 2;

// src/core/sidecar/loader.ts
var NAMESPACE_KEYS = ["wcstack.types", "wcstack.async", "wcstack.platformCapabilities", "wcstack.application"];
function loadManifest(artifact) {
  const parsed = parseJsonWithSpans(artifact.text);
  const ctx = new DiagnosticContext(parsed.spans);
  if (parsed.error !== null) {
    ctx.diagnostics.push({
      code: WcsDiagnosticCode.ManifestBroken,
      start: parsed.error.offset,
      end: Math.min(parsed.error.offset + 1, artifact.text.length),
      message: `Broken manifest JSON: ${parsed.error.message}.`,
      severity: "error"
    });
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  const root = parsed.value;
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    ctx.add(WcsDiagnosticCode.ManifestBroken, "", `Manifest root must be a JSON object.`, "error");
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  const obj = root;
  if (obj.schemaVersion === void 0) {
    ctx.add(WcsDiagnosticCode.ManifestSchemaVersion, "", `Manifest is missing an integer "schemaVersion".`, "error");
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (typeof obj.schemaVersion !== "number" || !Number.isInteger(obj.schemaVersion)) {
    ctx.add(
      WcsDiagnosticCode.ManifestSchemaVersion,
      pointer("schemaVersion"),
      `Manifest "schemaVersion" must be an integer.`,
      "error"
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (obj.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    const migration = obj.schemaVersion === 1 ? ` schemaVersion 1 (states[name]) predates v2's single state tree \u2014 regenerate with \`wcs-schema emit\`.` : "";
    ctx.add(
      WcsDiagnosticCode.ManifestSchemaVersion,
      pointer("schemaVersion"),
      `Unsupported schemaVersion ${obj.schemaVersion}; this reader supports ${SUPPORTED_SCHEMA_VERSION}.${migration}`,
      "error"
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (obj.kind !== "package" && obj.kind !== "application") {
    ctx.add(
      WcsDiagnosticCode.ManifestKindInvalid,
      obj.kind === void 0 ? "" : pointer("kind"),
      `Manifest "kind" must be "package" or "application".`,
      "error"
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  const extensions = obj.manifestExtensions;
  if (extensions !== null && typeof extensions === "object") {
    for (const ns of NAMESPACE_KEYS) {
      const nsObj = extensions[ns];
      if (nsObj !== null && typeof nsObj === "object") {
        const version2 = nsObj.version;
        if (typeof version2 === "number" && version2 !== SUPPORTED_NAMESPACE_VERSION) {
          ctx.add(
            WcsDiagnosticCode.ManifestNamespaceVersion,
            pointer("manifestExtensions", ns, "version"),
            `Namespace "${ns}" version ${version2} is unsupported (expected ${SUPPORTED_NAMESPACE_VERSION}).`,
            "warning"
          );
        }
      }
    }
  }
  return { artifact, manifest: obj, ctx, spans: parsed.spans };
}
function resolvePackageContracts(loaded) {
  const perSource = /* @__PURE__ */ new Map();
  const ctxBySource = /* @__PURE__ */ new Map();
  const ctxFor = (lm) => {
    let ctx = ctxBySource.get(lm.artifact.source);
    if (ctx === void 0) {
      ctx = new DiagnosticContext(lm.spans);
      ctxBySource.set(lm.artifact.source, ctx);
      perSource.set(lm.artifact.source, ctx.diagnostics);
    }
    return ctx;
  };
  const winners = /* @__PURE__ */ new Map();
  const collided = /* @__PURE__ */ new Set();
  const firstSource = /* @__PURE__ */ new Map();
  const filterOwner = /* @__PURE__ */ new Map();
  let schemaOwner;
  let schemaWinner;
  let hasApplicationArtifact = false;
  for (const lm of loaded) {
    if (lm.manifest === null) continue;
    if (lm.manifest.kind === "application") hasApplicationArtifact = true;
    const types2 = lm.manifest.manifestExtensions?.["wcstack.types"];
    if (lm.manifest.kind === "package" && types2 !== void 0) {
      for (const [tag, component] of Object.entries(types2.components ?? {})) {
        const ptr = pointer("manifestExtensions", "wcstack.types", "components", tag);
        if (!winners.has(tag) && !collided.has(tag)) {
          winners.set(tag, { tag, component, source: lm.artifact.source });
          firstSource.set(tag, lm.artifact.source);
          continue;
        }
        if (component.override === true) {
          ctxFor(lm).add(
            WcsDiagnosticCode.ManifestOverride,
            ptr,
            `Component "${tag}" explicitly overrides a prior package contract.`,
            "info",
            { tag },
            true
          );
          continue;
        }
        const priorSource = firstSource.get(tag) ?? "an earlier artifact";
        collided.add(tag);
        winners.delete(tag);
        ctxFor(lm).add(
          WcsDiagnosticCode.ManifestTagCollision,
          ptr,
          `Component tag "${tag}" is defined by multiple package artifacts (also in "${priorSource}"). Set "override": true to intentionally shadow.`,
          "error",
          { tag },
          true
        );
      }
    }
    const application = lm.manifest.manifestExtensions?.["wcstack.application"];
    if (lm.manifest.kind === "application" && application?.filters !== void 0) {
      for (const name of Object.keys(application.filters)) {
        const priorSource = filterOwner.get(name);
        if (priorSource === void 0) {
          filterOwner.set(name, lm.artifact.source);
          continue;
        }
        ctxFor(lm).add(
          WcsDiagnosticCode.ManifestFilterCollision,
          pointer("manifestExtensions", "wcstack.application", "filters", name),
          `Filter "${name}" is defined by multiple application artifacts (also in "${priorSource}").`,
          "error",
          { member: name },
          true
        );
      }
    }
    if (lm.manifest.kind === "application" && application?.stateSchema !== void 0) {
      const schema = application.stateSchema;
      if (schema !== null && typeof schema === "object" && !Array.isArray(schema)) {
        if (schemaOwner === void 0) {
          schemaOwner = lm.artifact.source;
          schemaWinner = schema;
        } else {
          schemaWinner = void 0;
          ctxFor(lm).add(
            WcsDiagnosticCode.ManifestStateCollision,
            pointer("manifestExtensions", "wcstack.application", "stateSchema"),
            `Multiple application artifacts declare a stateSchema (also in "${schemaOwner}"); neither is used.`,
            "error",
            void 0,
            true
          );
        }
      }
    }
  }
  const diagnosticsBySource = /* @__PURE__ */ new Map();
  for (const [source, diags] of perSource) {
    const kept = diags.filter((d) => !(d.code === WcsDiagnosticCode.ManifestOverride && d.tag !== void 0 && collided.has(d.tag)));
    if (kept.length > 0) diagnosticsBySource.set(source, kept);
  }
  return { tags: winners, applicationSchema: schemaWinner, hasApplicationArtifact, diagnosticsBySource };
}

// src/core/sidecar/discover.ts
var APPLICATION_MANIFEST_FILENAME = "wcstack.manifest.json";
var MAX_ASCEND = 16;
function discoverApplicationManifest(fileReader) {
  for (let up = 0; up <= MAX_ASCEND; up++) {
    const relativePath = `${"../".repeat(up)}${APPLICATION_MANIFEST_FILENAME}`;
    const text = fileReader(relativePath);
    if (text === void 0) continue;
    const loaded = loadManifest({ text, source: relativePath });
    return { relativePath, text, loaded, schema: applicationSchemaOf(loaded) };
  }
  return void 0;
}
function applicationSchemaOf(loaded) {
  const manifest = loaded.manifest;
  if (manifest === null || manifest.kind !== "application") return void 0;
  const application = manifest.manifestExtensions?.["wcstack.application"];
  const schema = application?.stateSchema;
  if (schema !== null && typeof schema === "object" && !Array.isArray(schema)) {
    return schema;
  }
  return void 0;
}
function joinRelativeSource(htmlSource, relativePath) {
  const sepIndex = Math.max(htmlSource.lastIndexOf("/"), htmlSource.lastIndexOf("\\"));
  const dirSegments = sepIndex === -1 ? [] : htmlSource.slice(0, sepIndex).split(/[\\/]/);
  for (const segment of relativePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (dirSegments.length > 0 && dirSegments[dirSegments.length - 1] !== "..") dirSegments.pop();
      else dirSegments.push("..");
      continue;
    }
    dirSegments.push(segment);
  }
  return dirSegments.join("/");
}

// src/core/validateDocument.ts
function validateDocument(text, options = {}) {
  const bindAttribute = options.bindAttribute ?? "data-wcs";
  const stateTagName = options.stateTagName ?? "wcs-state";
  const locale3 = options.locale;
  const fileReader = options.fileReader;
  const applicationSchema = options.applicationSchema ?? (fileReader !== void 0 ? discoverApplicationManifest(fileReader)?.schema : void 0);
  const out = [];
  out.push(...validateBindings(text, bindAttribute, stateTagName, locale3, fileReader, applicationSchema));
  out.push(...validateTemplateSyntax(text, stateTagName, bindAttribute, locale3, fileReader, applicationSchema));
  out.push(...validateIoNodes(text, bindAttribute, stateTagName, locale3, fileReader));
  out.push(...validateAriaAttributes(text, bindAttribute, locale3));
  out.push(...validateDocumentEnv(text, locale3));
  out.push(...validateSemantics(text, stateTagName, locale3, bindAttribute));
  out.push(...validateArrayMutations(text, stateTagName, locale3));
  out.push(...validateWatchDeclarations(text, stateTagName, locale3));
  out.push(...validateRecursion(text, stateTagName, locale3));
  out.push(...validateNamedState(text, bindAttribute, stateTagName, locale3));
  out.push(...validateMountAttributes(text, stateTagName, locale3));
  for (const d of validateStateTypes(text, stateTagName, locale3)) {
    out.push({ code: WcsDiagnosticCode.TypeAnnotation, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  for (const d of validateNestedAssigns(text, stateTagName, locale3)) {
    out.push({ code: WcsDiagnosticCode.NestedAssign, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  return sortDiagnostics(out);
}

// src/core/sidecar/drift.ts
function checkDrift(tag, component, live, ctx) {
  const liveProps = new Map(live.properties.map((p) => [p.name, p.event]));
  const liveInputs = new Set((live.inputs ?? []).map((i) => i.name));
  const liveCommands = new Set((live.commands ?? []).map((c) => c.name));
  for (const [name, observable] of Object.entries(component.observables ?? {})) {
    const memberPtr = pointer("manifestExtensions", "wcstack.types", "components", tag, "observables", name);
    if (!liveProps.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        memberPtr,
        `Sidecar declares observable "${name}" on <${tag}>, but the live wcBindable declaration has no such property.`,
        "error",
        { tag, member: name },
        true
      );
      continue;
    }
    const liveEvent = liveProps.get(name);
    if (observable.event !== liveEvent) {
      ctx.add(
        WcsDiagnosticCode.DriftEventMismatch,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "observables", name, "event"),
        `Sidecar observable "${name}" on <${tag}> declares event "${observable.event}", but the live declaration uses "${liveEvent}".`,
        "error",
        { tag, member: name }
      );
    }
  }
  for (const name of Object.keys(component.inputs ?? {})) {
    if (!liveInputs.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "inputs", name),
        `Sidecar declares input "${name}" on <${tag}>, but the live wcBindable declaration has no such input.`,
        "error",
        { tag, member: name },
        true
      );
    }
  }
  for (const name of Object.keys(component.commands ?? {})) {
    if (!liveCommands.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "commands", name),
        `Sidecar declares command "${name}" on <${tag}>, but the live wcBindable declaration has no such command.`,
        "error",
        { tag, member: name },
        true
      );
    }
  }
}

// src/core/sidecar/validate.ts
function validateManifestArtifact(artifact) {
  const loaded = loadManifest(artifact);
  validateLoadedSchemas(loaded);
  return sortDiagnostics(loaded.ctx.diagnostics);
}
function validateLoadedSchemas(loaded) {
  if (loaded.manifest === null) return;
  const types2 = loaded.manifest.manifestExtensions?.["wcstack.types"];
  for (const [tag, component] of Object.entries(types2?.components ?? {})) {
    validateComponentSchemas(tag, component, loaded.ctx);
  }
  const application = loaded.manifest.manifestExtensions?.["wcstack.application"];
  const stateSchema = application?.stateSchema;
  if (stateSchema !== void 0 && stateSchema !== null && typeof stateSchema === "object" && !Array.isArray(stateSchema)) {
    const ptr = pointer("manifestExtensions", "wcstack.application", "stateSchema");
    validateSchemaSubset(stateSchema, ptr, loaded.ctx, stateSchema.$defs ?? {});
  }
}
function validateComponentSchemas(tag, component, ctx) {
  const base = pointer("manifestExtensions", "wcstack.types", "components", tag);
  const walkSchema = (schema, ptr) => {
    if (schema === void 0) return;
    validateSchemaSubset(schema, ptr, ctx, schema.$defs ?? {});
  };
  for (const [name, observable] of Object.entries(component.observables ?? {})) {
    walkSchema(observable.schema, `${base}/observables/${escapePtr(name)}/schema`);
  }
  for (const [name, input] of Object.entries(component.inputs ?? {})) {
    walkSchema(input.schema, `${base}/inputs/${escapePtr(name)}/schema`);
  }
  for (const [name, command] of Object.entries(component.commands ?? {})) {
    walkSchema(command.args, `${base}/commands/${escapePtr(name)}/args`);
    walkSchema(command.result, `${base}/commands/${escapePtr(name)}/result`);
  }
}
function validateManifestSet(input) {
  const loadedList = input.artifacts.map(loadManifest);
  const byArtifact = /* @__PURE__ */ new Map();
  for (const loaded of loadedList) {
    validateLoadedSchemas(loaded);
    if (input.liveDeclarations !== void 0 && loaded.manifest?.kind === "package") {
      const types2 = loaded.manifest.manifestExtensions?.["wcstack.types"];
      for (const [tag, component] of Object.entries(types2?.components ?? {})) {
        const live = input.liveDeclarations.get(tag);
        if (live !== void 0) {
          checkDrift(tag, component, live, loaded.ctx);
        }
      }
    }
    const existing = byArtifact.get(loaded.artifact.source) ?? [];
    byArtifact.set(loaded.artifact.source, [...existing, ...loaded.ctx.diagnostics]);
  }
  const resolved = resolvePackageContracts(loadedList);
  for (const [source, diags] of resolved.diagnosticsBySource) {
    const existing = byArtifact.get(source) ?? [];
    byArtifact.set(source, [...existing, ...diags]);
  }
  const all = [];
  for (const diags of byArtifact.values()) all.push(...diags);
  const resolvedTags = /* @__PURE__ */ new Map();
  for (const [tag, contract] of resolved.tags) resolvedTags.set(tag, contract.source);
  const sortedByArtifact = /* @__PURE__ */ new Map();
  for (const [source, diags] of byArtifact) sortedByArtifact.set(source, sortDiagnostics(diags));
  return {
    diagnostics: sortDiagnostics(all),
    byArtifact: sortedByArtifact,
    resolvedTags,
    resolvedSchema: resolved.applicationSchema,
    hasApplicationArtifact: resolved.hasApplicationArtifact
  };
}
function escapePtr(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// src/core/cli/runValidation.ts
var severityLabel = { error: "error", warning: "warning", info: "info" };
function runValidation(inputs, options = {}) {
  const diagnosticsBySource = /* @__PURE__ */ new Map();
  const textBySource = new Map(inputs.map((i) => [i.source, i.text]));
  const manifestInputs = inputs.filter((i) => i.kind === "manifest");
  let explicitSchema;
  let haveExplicitApplication = false;
  if (manifestInputs.length > 0) {
    const result = validateManifestSet({
      artifacts: manifestInputs.map((m) => ({ text: m.text, source: m.source })),
      liveDeclarations: options.liveDeclarations
    });
    for (const input of manifestInputs) {
      diagnosticsBySource.set(input.source, result.byArtifact.get(input.source) ?? []);
    }
    if (result.hasApplicationArtifact) {
      haveExplicitApplication = true;
      explicitSchema = result.resolvedSchema;
    }
  }
  for (const input of inputs) {
    if (input.kind !== "html") continue;
    let applicationSchema = explicitSchema;
    if (!haveExplicitApplication && input.fileReader !== void 0) {
      const discovered = discoverApplicationManifest(input.fileReader);
      applicationSchema = discovered?.schema;
      if (discovered !== void 0) {
        const source = joinRelativeSource(input.source, discovered.relativePath);
        if (!diagnosticsBySource.has(source)) {
          textBySource.set(source, discovered.text);
          diagnosticsBySource.set(source, validateManifestArtifact({ text: discovered.text, source }));
        }
      }
    }
    const docOptions = {
      ...options,
      ...input.fileReader !== void 0 ? { fileReader: input.fileReader } : {},
      ...applicationSchema !== void 0 ? { applicationSchema } : {}
    };
    diagnosticsBySource.set(input.source, validateDocument(input.text, docOptions));
  }
  const lines = [];
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const source of [...diagnosticsBySource.keys()].sort()) {
    const diags = diagnosticsBySource.get(source);
    const mapper = createPositionMapper(textBySource.get(source) ?? "");
    for (const d of diags) {
      if (d.severity === "error") errorCount++;
      else if (d.severity === "warning") warningCount++;
      else infoCount++;
      if (options.errorsOnly && d.severity !== "error") continue;
      const pos = mapper(d.start);
      lines.push(`${source}:${pos.line}:${pos.column} ${severityLabel[d.severity]} ${d.code} ${d.message}`);
    }
  }
  return {
    lines,
    errorCount,
    warningCount,
    infoCount,
    exitCode: errorCount > 0 || options.strict === true && warningCount > 0 ? 1 : 0,
    diagnosticsBySource
  };
}

// src/cli.ts
function classify(path) {
  return path.endsWith(".manifest.json") ? "manifest" : "html";
}
function parseArgs(argv) {
  const options = {};
  const files = [];
  for (const arg of argv) {
    if (arg.startsWith("--attr=")) options.bindAttribute = arg.slice("--attr=".length);
    else if (arg.startsWith("--state-tag=")) options.stateTagName = arg.slice("--state-tag=".length);
    else if (arg.startsWith("--lang=")) options.locale = arg.slice("--lang=".length);
    else if (arg === "--errors-only" || arg === "--quiet") options.errorsOnly = true;
    else if (arg === "--strict") options.strict = true;
    else if (!arg.startsWith("-")) files.push(arg);
  }
  return { options, files };
}
function resolveCliLocale(explicit, env = process.env) {
  if (explicit) return explicit;
  const fromEnv = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (fromEnv) return fromEnv;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
function main(argv) {
  const { options, files } = parseArgs(argv);
  const locale3 = resolveCliLocale(options.locale);
  if (files.length === 0) {
    process.stderr.write("usage: wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--errors-only] [--strict] <file> [<file> ...]\n");
    return 2;
  }
  const inputs = [];
  for (const path of files) {
    let text;
    try {
      text = (0, import_node_fs2.readFileSync)(path, "utf8");
    } catch (e) {
      process.stderr.write(`cannot read ${path}: ${e.message}
`);
      return 2;
    }
    const kind = classify(path);
    inputs.push({ source: path, text, kind, fileReader: kind === "html" ? createFileReader(path) : void 0 });
  }
  const result = runValidation(inputs, { ...options, locale: locale3 });
  for (const line of result.lines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write(
    `
${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info${options.strict ? " (strict)" : ""}
`
  );
  return result.exitCode;
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createFileReader,
  main,
  parseArgs,
  resolveCliLocale
});
//# sourceMappingURL=cli.cjs.map
