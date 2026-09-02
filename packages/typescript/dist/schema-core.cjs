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

// src/schemaCore.ts
var schemaCore_exports = {};
__export(schemaCore_exports, {
  ALLOWED_SCHEMA_KEYWORDS: () => ALLOWED_SCHEMA_KEYWORDS,
  WcsDiagnosticCode: () => WcsDiagnosticCode,
  validateDocument: () => validateDocument,
  validateManifestArtifact: () => validateManifestArtifact
});
module.exports = __toCommonJS(schemaCore_exports);

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
  // --- <wcs-state> script: $watch declaration ---
  // ランタイム（watch/processWatchDeclaration.ts）が raiseError で落とす宣言。
  // 越境 `@` / `$` 始まり / 空キー・空セグメント / 明らかな非関数ハンドラ。
  WatchDeclarationInvalid: "wcs/watch-declaration-invalid",
  // `$watch` のキーが状態定義に存在しない。バインディング側と違い黙って発火しない
  // だけなので気づけない。severity は binding-path-missing に揃える（warning）。
  WatchPathMissing: "wcs/watch-path-missing",
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
  NamedStateDeprecated: "wcs/named-state-deprecated"
};
function sortDiagnostics(diagnostics) {
  const severityRank = { error: 0, warning: 1, info: 2 };
  return [...diagnostics].sort((a, b) => a.start - b.start || severityRank[a.severity] - severityRank[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
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
    const ref = node.$ref;
    if (!ref.startsWith("#/")) return;
    if (refStack.has(ref)) {
      ctx.add(WcsDiagnosticCode.ManifestRefCycle, `${ptr}/$ref`, `Cyclic $ref detected at "${ref}".`, "error");
      return;
    }
    if (safe.has(ref)) return;
    const target = resolveLocalRef(ref, rootDefs);
    if (target === void 0) return;
    refStack.add(ref);
    detectCycles(target, ptr, ctx, rootDefs, refStack, safe);
    refStack.delete(ref);
    safe.add(ref);
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
function resolveLocalRef(ref, rootDefs) {
  const match = /^#\/\$defs\/(.+)$/.exec(ref);
  if (match === null) return void 0;
  const name = match[1].replace(/~1/g, "/").replace(/~0/g, "~");
  return rootDefs[name];
}
function resolveSchemaPath(root, rootDefs, segments) {
  let current = root;
  for (let depth = 0; depth < segments.length; depth++) {
    const segment = segments[depth];
    const resolved = derefUnion(current, rootDefs);
    if (resolved.kind === "ref-error") return resolved;
    const candidates = resolved.nodes;
    if (segment === "*") {
      const items = firstDefined(candidates, (n) => isSchemaObject(n.items) ? n.items : void 0);
      if (items === void 0) {
        return { kind: "unknown" };
      }
      current = items;
      continue;
    }
    if (segment === "length" && candidates.some((n) => hasType(n, "array"))) {
      current = { type: "number" };
      continue;
    }
    const child = firstDefined(candidates, (n) => isSchemaMap(n.properties) ? n.properties[segment] : void 0);
    if (child !== void 0) {
      current = child;
      continue;
    }
    const anyObject = candidates.some((n) => hasType(n, "object") || isSchemaMap(n.properties));
    if (anyObject) {
      return { kind: "nonexistent", segment, depth };
    }
    return { kind: "unknown" };
  }
  const final = derefUnion(current, rootDefs);
  if (final.kind === "ref-error") return final;
  return { kind: "resolved", schema: final.nodes.length === 1 ? final.nodes[0] : current };
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
    const offset = e.offset ?? 0;
    return { value: void 0, spans: reader.spans, error: { offset, message: e.message } };
  }
}

// src/core/sidecar/types.ts
var SUPPORTED_SCHEMA_VERSION = 1;
var SUPPORTED_NAMESPACE_VERSION = 1;

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
    ctx.add(
      WcsDiagnosticCode.ManifestSchemaVersion,
      pointer("schemaVersion"),
      `Unsupported schemaVersion ${obj.schemaVersion}; this reader supports ${SUPPORTED_SCHEMA_VERSION}.`,
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
        const version = nsObj.version;
        if (typeof version === "number" && version !== SUPPORTED_NAMESPACE_VERSION) {
          ctx.add(
            WcsDiagnosticCode.ManifestNamespaceVersion,
            pointer("manifestExtensions", ns, "version"),
            `Namespace "${ns}" version ${version} is unsupported (expected ${SUPPORTED_NAMESPACE_VERSION}).`,
            "warning"
          );
        }
      }
    }
  }
  return { artifact, manifest: obj, ctx, spans: parsed.spans };
}

// src/core/sidecar/validate.ts
function validateManifestArtifact(artifact) {
  const loaded = loadManifest(artifact);
  validateLoadedSchemas(loaded);
  return sortDiagnostics(loaded.ctx.diagnostics);
}
function validateLoadedSchemas(loaded) {
  if (loaded.manifest === null) return;
  const types = loaded.manifest.manifestExtensions?.["wcstack.types"];
  for (const [tag, component] of Object.entries(types?.components ?? {})) {
    validateComponentSchemas(tag, component, loaded.ctx);
  }
  const application = loaded.manifest.manifestExtensions?.["wcstack.application"];
  for (const [name, entry] of Object.entries(application?.states ?? {})) {
    const schema = entry?.stateSchema;
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) continue;
    const ptr = `${pointer("manifestExtensions", "wcstack.application", "states", name)}/stateSchema`;
    validateSchemaSubset(schema, ptr, loaded.ctx, schema.$defs ?? {});
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
function escapePtr(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
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
var STATE_NAME_SEPARATOR = "@";
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
        stateName: STATE_NAME_SEPARATOR,
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

// src/service/stateAnalyzer.ts
var RESERVED_STREAMS_KEY = "$streams";
var RESERVED_COMMAND_TOKENS_KEY = "$commandTokens";
var RESERVED_EVENT_TOKENS_KEY = "$eventTokens";
var RESERVED_LIST_KEYS_KEY = "$listKeys";
var RESERVED_WATCH_KEY = "$watch";
function analyzeStatePaths(scriptContent, stateName = "default") {
  const objectContent = extractDefaultExportObject(scriptContent);
  if (!objectContent) return [];
  const paths = [];
  const topLevelProps = parseTopLevelProperties(objectContent);
  const pendingStreamValues = [];
  const pendingListKeys = [];
  for (const prop of topLevelProps) {
    if (prop.name.startsWith("$")) {
      collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys, stateName);
      continue;
    }
    if (prop.kind === "method") {
      paths.push({ path: prop.name, kind: "method", stateName });
      continue;
    }
    if (prop.kind === "getter") {
      if (!paths.some((p) => p.stateName === stateName && p.path === prop.name)) {
        paths.push({ path: prop.name, kind: "computed", stateName });
      }
      continue;
    }
    pushDataPropertyPaths(prop, paths, stateName);
  }
  for (const streamValue of pendingStreamValues) {
    if (paths.some((p) => p.stateName === stateName && p.path === streamValue.name)) continue;
    pushDataPropertyPaths(streamValue, paths, stateName);
  }
  for (const listKeyEntry of pendingListKeys) {
    pushListKeyPaths(listKeyEntry, paths, stateName);
  }
  return paths;
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
      bodyStart: root.start + (prop.valueStart ?? 0)
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
function collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys, stateName) {
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
      paths.push({ path: `$streamStatus.${entry.name}`, kind: "data", typeHint: "string", stateName });
      paths.push({ path: `$streamError.${entry.name}`, kind: "data", stateName });
    }
    return;
  }
  if (prop.name === RESERVED_COMMAND_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: `$command.${name}`, kind: "command", stateName });
    }
    return;
  }
  if (prop.name === RESERVED_EVENT_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: name, kind: "eventToken", stateName });
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
function pushListKeyPaths(entry, paths, stateName) {
  const listPath = entry.name;
  const segments = listPath.split(".");
  if (listPath.length === 0 || segments.some((s) => s.length === 0) || segments[segments.length - 1] === "*") {
    return;
  }
  const has = (path) => paths.some((p) => p.stateName === stateName && p.path === path);
  if (!has(listPath)) paths.push({ path: listPath, kind: "data", typeHint: "array", stateName });
  if (!has(`${listPath}.*`)) paths.push({ path: `${listPath}.*`, kind: "list", stateName });
  if (!has(`${listPath}.length`)) {
    paths.push({ path: `${listPath}.length`, kind: "data", typeHint: "number", stateName });
  }
  const keyField = extractStringLiteralValue(entry.value);
  if (keyField === null || keyField.includes(".") || keyField.includes("*")) return;
  if (!has(`${listPath}.*.${keyField}`)) {
    paths.push({ path: `${listPath}.*.${keyField}`, kind: "data", stateName });
  }
}
function extractStringLiteralValue(value) {
  if (!value) return null;
  const match = value.trim().match(/^["']([^"'\\]*)["']$/);
  return match && match[1].length > 0 ? match[1] : null;
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
function pushDataPropertyPaths(prop, paths, stateName) {
  pushDataPropertyPathsAt(prop.name, prop, paths, stateName, 0);
}
function pushDataPropertyPathsAt(path, prop, paths, stateName, depth) {
  paths.push({ path, kind: "data", typeHint: prop.typeHint, rawInitial: prop.value?.trim(), stateName });
  if (prop.value && isArrayLiteral(prop.value)) {
    paths.push({ path: `${path}.*`, kind: "list", stateName });
    paths.push({ path: `${path}.length`, kind: "data", typeHint: "number", stateName });
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    for (const childProp of extractArrayElementDataProperties(prop.value)) {
      pushDataPropertyPathsAt(`${path}.*.${childProp.name}`, childProp, paths, stateName, depth + 1);
    }
    return;
  }
  if (prop.value && isObjectLiteral(prop.value)) {
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const childProps = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const childProp of childProps) {
      if (childProp.kind !== "data") continue;
      pushDataPropertyPathsAt(`${path}.${childProp.name}`, childProp, paths, stateName, depth + 1);
    }
  }
}
function analyzeJsonPaths(jsonString, stateName = "default") {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return [];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const paths = [];
  collectJsonPaths(data, "", paths, stateName, 0);
  return paths;
}
function collectJsonPaths(obj, prefix, paths, stateName, depth) {
  if (depth >= MAX_OBJECT_NEST_DEPTH) return;
  for (const [key, value] of Object.entries(obj)) {
    if (prefix === "" && key.startsWith("$")) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    pushJsonValuePaths(path, value, paths, stateName, depth);
  }
}
function pushJsonValuePaths(path, value, paths, stateName, depth) {
  paths.push({ path, kind: "data", typeHint: inferJsonTypeHint(value), stateName });
  if (Array.isArray(value)) {
    paths.push({ path: `${path}.*`, kind: "list", stateName });
    paths.push({ path: `${path}.length`, kind: "data", typeHint: "number", stateName });
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null && !Array.isArray(value[0])) {
      const firstElement = value[0];
      for (const [childKey, childValue] of Object.entries(firstElement)) {
        pushJsonValuePaths(`${path}.*.${childKey}`, childValue, paths, stateName, depth + 1);
      }
    }
  } else if (typeof value === "object" && value !== null) {
    collectJsonPaths(value, path, paths, stateName, depth + 1);
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
      props.push({
        name: accessorName,
        kind: "getter",
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
  let depth = 0;
  let inString = null;
  for (let i = openBraceIndex; i < scan.length; i++) {
    const ch = scan[i];
    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(openBraceIndex + 1, i);
      }
    }
  }
  return text.slice(openBraceIndex + 1);
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
function analyzeSchemaPaths(schema, stateName = "default") {
  const paths = [];
  const defs = schema.$defs ?? {};
  collectSchemaObjectPaths(schema, "", paths, stateName, defs, 0);
  return paths;
}
function mergeSchemaCandidates(candidates, applicationStates) {
  if (applicationStates === void 0 || applicationStates.size === 0) return candidates;
  const schemaCandidates = [];
  const schemaKeys = /* @__PURE__ */ new Set();
  for (const [stateName, schema] of applicationStates) {
    for (const p of analyzeSchemaPaths(schema, stateName)) {
      schemaCandidates.push(p);
      schemaKeys.add(`${stateName} ${p.path}`);
    }
  }
  const kept = candidates.filter((p) => !schemaKeys.has(`${p.stateName} ${p.path}`));
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
    const types = typeof n.type === "string" ? [n.type] : Array.isArray(n.type) ? n.type : [];
    if (types.length > 0) {
      for (const t of types) {
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
function collectSchemaObjectPaths(node, prefix, paths, stateName, defs, depth) {
  if (depth >= MAX_OBJECT_NEST_DEPTH) return;
  const seen = /* @__PURE__ */ new Set();
  for (const n of derefSchemaNodes(node, defs)) {
    for (const [key, child] of Object.entries(n.properties ?? {})) {
      if (prefix === "" && key.startsWith("$")) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const path = prefix ? `${prefix}.${key}` : key;
      pushSchemaValuePaths(path, child, paths, stateName, defs, depth);
    }
  }
}
function pushSchemaValuePaths(path, node, paths, stateName, defs, depth) {
  const nodes = derefSchemaNodes(node, defs);
  const typeHint = schemaTypeHint(nodes);
  paths.push(withHint({ path, kind: "data", stateName, fromSchema: true }, typeHint));
  const items = nodes.map((n) => n.items).find((i) => i !== void 0 && i !== null && typeof i === "object");
  const isArray = items !== void 0 || (typeHint?.split("|").includes("array") ?? false);
  if (isArray) {
    const itemNodes = items !== void 0 ? derefSchemaNodes(items, defs) : [];
    paths.push(withHint({ path: `${path}.*`, kind: "list", stateName, fromSchema: true }, schemaTypeHint(itemNodes)));
    paths.push({ path: `${path}.length`, kind: "data", typeHint: "number", stateName, fromSchema: true });
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const seen = /* @__PURE__ */ new Set();
    for (const n of itemNodes) {
      for (const [childKey, childNode] of Object.entries(n.properties ?? {})) {
        if (seen.has(childKey)) continue;
        seen.add(childKey);
        pushSchemaValuePaths(`${path}.*.${childKey}`, childNode, paths, stateName, defs, depth + 1);
      }
    }
    return;
  }
  if (nodes.some((n) => n.properties !== void 0)) {
    collectSchemaObjectPaths(node, path, paths, stateName, defs, depth + 1);
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
    const stateName = extractAttribute(wcsMatch.tagContent, "name") ?? "default";
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
        stateName
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
    const stateName = extractAttribute(wcsMatch.tagContent, "name") ?? "default";
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
        stateName
      });
      pos = html.indexOf(">", scriptCloseIdx) + 1;
      if (pos === 0) break;
    }
    elements.push({ stateName, jsonAttr, stateAttr, srcAttr, scriptBlocks, tagStart, tagEnd });
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
  if (element.stateAttr) {
    const jsonContent = findScriptJsonById(html, element.stateAttr);
    if (jsonContent) {
      const paths = analyzeJsonPaths(jsonContent, element.stateName);
      if (paths.length > 0) return paths;
    }
  }
  if (element.srcAttr && fileReader) {
    const paths = resolveSrcAttribute(element.srcAttr, element.stateName, fileReader);
    if (paths.length > 0) return paths;
  }
  if (element.jsonAttr) {
    const paths = analyzeJsonPaths(element.jsonAttr, element.stateName);
    if (paths.length > 0) return paths;
  }
  if (element.scriptBlocks.length > 0) {
    return element.scriptBlocks.flatMap(
      (block) => analyzeStatePaths(block.content, block.stateName)
    );
  }
  return [];
}
function resolveSrcAttribute(srcPath, stateName, fileReader) {
  if (srcPath.endsWith(".json")) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeJsonPaths(content, stateName);
    }
    return [];
  }
  if (srcPath.endsWith(".js")) {
    const tsPath = srcPath.replace(/\.js$/, ".ts");
    const tsContent = fileReader(tsPath);
    if (tsContent) {
      return analyzeStatePaths(tsContent, stateName);
    }
    const jsContent = fileReader(srcPath);
    if (jsContent) {
      return analyzeStatePaths(jsContent, stateName);
    }
    return [];
  }
  if (srcPath.endsWith(".ts")) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeStatePaths(content, stateName);
    }
    return [];
  }
  return [];
}

// src/service/forContext.ts
function isInsideForTemplate(html, offset, bindAttrName = "data-wcs") {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:`,
    "gi"
  );
  const closeRegex = /<\/template\s*>/gi;
  const opens = [];
  let match;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;
    opens.push(match.index);
  }
  if (opens.length === 0) return false;
  for (const openPos of opens) {
    const depth = getForTemplateDepthAt(html, openPos, offset, bindAttrName);
    if (depth > 0) return true;
  }
  return false;
}
function getInnermostForPath(html, offset, bindAttrName = "data-wcs") {
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
  return chain.length === 0 ? null : chain[chain.length - 1];
}
function getEnclosingForPaths(html, offset, bindAttrName = "data-wcs") {
  return getEnclosingFors(html, offset, bindAttrName).map((entry) => entry.path);
}
function getEnclosingFors(html, offset, bindAttrName = "data-wcs") {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:\\s*([^"']+?)\\s*["']`,
    "gi"
  );
  const enclosing = [];
  let match;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;
    const tagEnd = html.indexOf(">", match.index);
    if (tagEnd === -1 || tagEnd >= offset) continue;
    const depth = getForTemplateDepthAt(html, match.index, offset, bindAttrName);
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
  const at = path.indexOf("@");
  if (at !== -1) path = path.slice(0, at).trim();
  return path;
}
function getAvailableWildcardRank(html, offset, bindAttrName = "data-wcs") {
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
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
function getForTemplateDepthAt(html, openPos, offset, bindAttrName) {
  const tagEnd = html.indexOf(">", openPos);
  if (tagEnd === -1 || tagEnd >= offset) return 0;
  let depth = 1;
  let pos = tagEnd + 1;
  const templateOpenRegex = /<template[\s>]/gi;
  const templateCloseRegex = /<\/template\s*>/gi;
  while (pos < offset && depth > 0) {
    templateOpenRegex.lastIndex = pos;
    templateCloseRegex.lastIndex = pos;
    const nextOpen = templateOpenRegex.exec(html);
    const nextClose = templateCloseRegex.exec(html);
    const openIdx = nextOpen && nextOpen.index < offset ? nextOpen.index : Infinity;
    const closeIdx = nextClose && nextClose.index < offset ? nextClose.index : Infinity;
    if (openIdx === Infinity && closeIdx === Infinity) break;
    if (openIdx < closeIdx) {
      depth++;
      pos = openIdx + 1;
    } else {
      depth--;
      if (depth === 0 && closeIdx < offset) {
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
  namedStateAttrDeprecated: (name) => `<wcs-state name="${name}"> \u306F v2 \u3067\u5EC3\u6B62\u3055\u308C\u307E\u3059\u3002\u30EB\u30FC\u30C8\u30C4\u30EA\u30FC\u3078\u306E\u30DE\u30A6\u30F3\u30C8 <wcs-state mount="${name}"> \u306B\u7F6E\u304D\u63DB\u3048\u3001\u30D1\u30B9\u306F "${name}.<path>" \u3067\u53C2\u7167\u3057\u3066\u304F\u3060\u3055\u3044\uFF08docs/state-mount-design.md \xA79\uFF09`,
  namedStatePathDeprecated: (name) => name === "default" ? `"@default" \u306F\u4E0D\u8981\u3067\u3001v2 \u3067\u5EC3\u6B62\u3055\u308C\u307E\u3059\u3002"@default" \u3092\u5916\u3057\u3066\u304F\u3060\u3055\u3044\uFF08docs/state-mount-design.md \xA79\uFF09` : `"@${name}" \u306B\u3088\u308B state \u6307\u5B9A\u306F v2 \u3067\u5EC3\u6B62\u3055\u308C\u307E\u3059\u3002\u30DE\u30A6\u30F3\u30C8\u3057\u305F\u30C4\u30EA\u30FC\u3092 "${name}.<path>" \u3067\u53C2\u7167\u3057\u3066\u304F\u3060\u3055\u3044\uFF08docs/state-mount-design.md \xA79\uFF09`
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
  namedStateAttrDeprecated: (name) => `<wcs-state name="${name}"> is deprecated and will be removed in v2. Mount the state onto the root tree with <wcs-state mount="${name}"> and read it as "${name}.<path>" (docs/state-mount-design.md \xA79)`,
  namedStatePathDeprecated: (name) => name === "default" ? `The "@default" selector is redundant and will be removed in v2; drop it (docs/state-mount-design.md \xA79)` : `The "@${name}" state selector is deprecated and will be removed in v2. Read the mounted tree as "${name}.<path>" instead (docs/state-mount-design.md \xA79)`
};
var CATALOGS = { ja, en };
function getMessages(locale3) {
  return CATALOGS[resolveLocale(locale3)];
}

// src/service/bindingValidator.ts
var filterMap = new Map(BUILTIN_FILTERS.map((f) => [f.name, f]));
function validateBindings(html, attrName, stateTagName = "wcs-state", locale3, fileReader, applicationStates) {
  const diagnostics = [];
  const msgs = getMessages(locale3);
  const statePaths = mergeSchemaCandidates(getStatePathsFromHtml(html, stateTagName, fileReader), applicationStates);
  const pathsByState = /* @__PURE__ */ new Map();
  for (const p of statePaths) {
    const list = pathsByState.get(p.stateName) ?? [];
    list.push(p);
    pathsByState.set(p.stateName, list);
  }
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
      const scopedPaths = pathsByState.get(parsed.targetState) ?? [];
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
            const schema = applicationStates?.get(parsed.targetState);
            const verdict = schema !== void 0 ? validateSchemaPathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames, schema, msgs) : toMissingVerdict(validatePathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames, msgs));
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
        if (pathTrimmed && !prop.startsWith("on")) {
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
              const schemaDefinite = typeReq.expected === "array" && parsed.filters.length === 0 && applicationStates?.has(parsed.targetState) === true && scopedPaths.some((p) => p.path === pathTrimmed && p.fromSchema === true);
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
  let current = "";
  let parenDepth = 0;
  for (const ch of value) {
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === ";" && parenDepth === 0) {
      result.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}
function parseBindingExpression(expr) {
  const colonIndex = expr.indexOf(":");
  if (colonIndex === -1) {
    return { property: expr.trim(), path: null, targetState: "default", filters: [], inputFilters: [] };
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
  const targetState = atIndex !== -1 ? pathSegment.slice(atIndex + 1).trim() || "default" : "default";
  const filters = parseFilterSegments(expr, filterSegments, colonIndex + 1 + pathSegment.length + 1);
  return { property, path: path.trim() || null, targetState, filters, inputFilters };
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
  let current = "";
  let parenDepth = 0;
  for (const ch of value) {
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "|" && parenDepth === 0) {
      result.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current);
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
  if (!scopedPathSet.has(checkPath)) {
    return msgs.pathMissing(displayPath);
  }
  return null;
}
function toMissingVerdict(message) {
  return message ? { code: WcsDiagnosticCode.BindingPathMissing, message, severity: "warning" } : null;
}
function validateSchemaPathExistence(checkPath, displayPath, scopedPaths, scopedPathSet, commandNames, schema, msgs) {
  if (checkPath.startsWith("$")) {
    return toMissingVerdict(validatePathExistence(checkPath, displayPath, scopedPaths, scopedPathSet, commandNames, msgs));
  }
  if (scopedPathSet.has(checkPath)) return null;
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
function isInsideTag(html, offset, tagName) {
  const tagRegex = new RegExp(`<(/?)${tagName}[\\s>]`, "gi");
  let depth = 0;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > offset) break;
    if (match[1]) {
      depth = Math.max(0, depth - 1);
    } else {
      depth++;
    }
  }
  return depth > 0;
}

// src/service/templateSyntaxValidator.ts
function validateTemplateSyntax(html, stateTagName, bindAttrName = "data-wcs", locale3, fileReader, applicationStates) {
  const diagnostics = [];
  const msgs = getMessages(locale3);
  const allPaths = mergeSchemaCandidates(getStatePathsFromHtml(html, stateTagName, fileReader), applicationStates);
  const defaultSchema = applicationStates?.get("default");
  const missingVerdict = (path, displayPath, pathSet2, scoped) => {
    if (isValidTemplatePath(path, pathSet2, scoped)) return null;
    if (defaultSchema !== void 0 && !path.startsWith("$")) {
      const resolution = resolveSchemaPath(defaultSchema, defaultSchema.$defs ?? {}, path.split("."));
      return resolution.kind === "nonexistent" ? { code: WcsDiagnosticCode.PathNonexistent, severity: "error", message: msgs.pathNonexistent(displayPath) } : null;
    }
    return { code: WcsDiagnosticCode.BindingPathMissing, severity: "warning", message: msgs.pathMissing(displayPath) };
  };
  if (allPaths.length === 0) return diagnostics;
  const defaultPaths = allPaths.filter((p) => p.stateName === "default");
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
    let pathPart = (parts[0] || "").trim();
    const atIdx = pathPart.indexOf("@");
    if (atIdx !== -1) pathPart = pathPart.slice(0, atIdx).trim();
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
      if (insideFor && !pathPart.startsWith(".") && !pathPart.includes("@")) {
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
  return pathSet.has(path);
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
    const cand = findDataSlot(getPaths(), parsed.path, parsed.targetState);
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
    const cand = findDataSlot(getPaths(), parsed.path, parsed.targetState);
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
function findDataSlot(paths, path, stateName) {
  return paths.find((c) => c.kind === "data" && c.path === path && c.stateName === stateName);
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
var STATE_NAME_SEPARATOR2 = "@";
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
    const paths = analyzeStatePaths(block.content, block.stateName);
    const pathSet = new Set(paths.map((p) => p.path));
    for (const entry of entries) {
      const diagnostic = validateEntry(entry, pathSet, msgs);
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
function validateEntry(entry, pathSet, msgs) {
  const { key } = entry;
  const invalid = (message) => ({ code: WcsDiagnosticCode.WatchDeclarationInvalid, message, severity: "error" });
  if (key.includes(STATE_NAME_SEPARATOR2)) {
    return invalid(msgs.watchKeyCrossState(key));
  }
  if (key.startsWith("$")) {
    return invalid(msgs.watchKeyReserved(key));
  }
  if (key.split(".").some((segment) => segment.length === 0)) {
    return invalid(msgs.watchKeyEmptySegment(key));
  }
  if (entry.definitelyNotFunction) {
    return invalid(msgs.watchHandlerNotFunction(key));
  }
  if (pathSet.size > 0 && !pathSet.has(key)) {
    return {
      code: WcsDiagnosticCode.WatchPathMissing,
      message: msgs.watchPathMissing(key),
      severity: "warning"
    };
  }
  return null;
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
  const at = expr.indexOf("@", from);
  if (at === -1 || at >= end) return null;
  const raw = expr.slice(at + 1, end);
  const name = raw.trim();
  const nameStart = at + 1 + (raw.length - raw.trimStart().length);
  return { start: at, end: name.length === 0 ? at + 1 : nameStart + name.length, name: name.length === 0 ? "default" : name };
}
function validateNamedState(html, attrName, stateTagName = "wcs-state", locale3) {
  const msgs = getMessages(locale3);
  const diagnostics = [];
  for (const element of parseWcsStateElements(html, stateTagName)) {
    const tagText = html.slice(element.tagStart, element.tagEnd);
    if (/\sbind-component(?=[\s=>/])/i.test(tagText)) continue;
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
      severity: "warning"
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
          severity: "warning"
        });
      }
      pos += expr.length + 1;
    }
  }
  for (const mustache of findAllMustacheSyntax(html)) {
    const selector = findStateSelector(mustache.expression, true);
    if (selector !== null) {
      diagnostics.push({
        code: WcsDiagnosticCode.NamedStateDeprecated,
        start: mustache.exprStart + selector.start,
        end: mustache.exprStart + selector.end,
        message: msgs.namedStatePathDeprecated(selector.name),
        severity: "warning"
      });
    }
  }
  return diagnostics;
}

// ../state/dist/parser.esm.js
var DELIMITER2 = ".";
var WILDCARD2 = "*";
var MAX_WILDCARD_DEPTH2 = 128;
var BINDING_SEPARATOR2 = ";";
var PROP_VALUE_SEPARATOR2 = ":";
var MODIFIER_SEPARATOR2 = "#";
var STATE_NAME_SEPARATOR3 = "@";
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
  let current = "";
  let inQuote = null;
  let hasQuote = false;
  let firstQuoteStart = -1;
  let lastQuoteEnd = -1;
  const flush = () => {
    args.push(finalizeArg(current, firstQuoteStart, lastQuoteEnd));
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
  const last = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
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
  if (stateAndPath.indexOf(STATE_NAME_SEPARATOR3) !== -1) ;
  const [statePathName, stateName = "default"] = stateAndPath.split(STATE_NAME_SEPARATOR3).map(trimFn);
  const pathInfo = getPathInfo(statePathName);
  return {
    stateName,
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
        stateName: "",
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
    return { exprRange, exprText: expression, parsed, error, propRange: null, pathRange: null, stateNameRange: null };
  }
  const firstPipe = expression.indexOf(delimiters.filter);
  const pathScopeEnd = firstPipe === -1 ? expression.length : firstPipe;
  const pathLocal = locate(expression, parsed.statePathName, 0, pathScopeEnd);
  let stateNameLocal = null;
  const at = expression.indexOf(delimiters.stateName);
  if (at !== -1 && at < pathScopeEnd) {
    stateNameLocal = locate(expression, parsed.stateName, at + 1, pathScopeEnd);
  }
  return {
    exprRange,
    exprText: expression,
    parsed,
    error,
    propRange: null,
    pathRange: pathLocal,
    stateNameRange: stateNameLocal
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
      results.push({ exprRange, exprText: expr, parsed, error, propRange: null, pathRange: null, stateNameRange: null });
      continue;
    }
    const colon = expr.indexOf(delimiters.propValue);
    const propEndLimit = colon === -1 ? expr.length : colon;
    const propLocal = locate(expr, parsed.propName, 0, propEndLimit);
    let pathLocal = null;
    let stateNameLocal = null;
    if (colon !== -1) {
      const stateBase = colon + 1;
      const firstPipe = expr.indexOf(delimiters.filter, stateBase);
      const pathScopeEnd = firstPipe === -1 ? expr.length : firstPipe;
      pathLocal = locate(expr, parsed.statePathName, stateBase, pathScopeEnd);
      const at = expr.indexOf(delimiters.stateName, stateBase);
      if (at !== -1 && at < pathScopeEnd) {
        stateNameLocal = locate(expr, parsed.stateName, at + 1, pathScopeEnd);
      }
    }
    const lift = (range) => range === null ? null : { start: exprStart + range.start, end: exprStart + range.end };
    results.push({
      exprRange,
      exprText: expr,
      parsed,
      error,
      propRange: lift(propLocal),
      pathRange: lift(pathLocal),
      stateNameRange: lift(stateNameLocal)
    });
  }
  return results;
}

// src/core/index/referenceIndex.ts
function keyOf(stateName, path) {
  return `${stateName}\0${path}`;
}
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
        stateName: binding.parsed.stateName,
        path: binding.parsed.statePathName,
        pathRange: lift(binding.pathRange),
        exprRange: lift(binding.exprRange),
        propName: binding.parsed.propName,
        propRange: binding.propRange === null ? null : lift(binding.propRange),
        stateNameRange: binding.stateNameRange === null ? null : lift(binding.stateNameRange),
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
      stateName: binding.parsed.stateName,
      path: binding.parsed.statePathName,
      pathRange: shift(binding.pathRange),
      exprRange: { start: match.exprStart, end: match.exprEnd },
      propName: null,
      propRange: null,
      stateNameRange: binding.stateNameRange === null ? null : shift(binding.stateNameRange),
      bindingType: "text"
    });
  }
  const declarations = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    for (const span of analyzeDeclarationSpans(block.content)) {
      declarations.push({
        stateName: block.stateName,
        name: span.name,
        kind: span.kind,
        range: { start: block.contentStart + span.start, end: block.contentStart + span.end }
      });
    }
  }
  const byPath = /* @__PURE__ */ new Map();
  for (const occurrence of occurrences) {
    if (occurrence.kind !== "path") continue;
    const key = keyOf(occurrence.stateName, occurrence.path);
    const list = byPath.get(key);
    if (list === void 0) {
      byPath.set(key, [occurrence]);
    } else {
      list.push(occurrence);
    }
  }
  const declarationByName = /* @__PURE__ */ new Map();
  for (const declaration of declarations) {
    const key = keyOf(declaration.stateName, declaration.name);
    if (!declarationByName.has(key)) declarationByName.set(key, declaration);
  }
  return {
    occurrences,
    declarations,
    problems,
    referencesOf(stateName, path) {
      return (byPath.get(keyOf(stateName, path)) ?? []).slice();
    },
    declarationOf(stateName, path) {
      const exact = declarationByName.get(keyOf(stateName, path));
      if (exact !== void 0) return exact;
      const firstSegment = path.split(".")[0];
      if (firstSegment === path) return null;
      return declarationByName.get(keyOf(stateName, firstSegment)) ?? null;
    },
    occurrenceAt(offset) {
      for (const occurrence of occurrences) {
        if (offset >= occurrence.pathRange.start && offset < occurrence.pathRange.end) {
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
var READ_BRACKET = /\bthis\s*\??\.\s*\[\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*\]|\bthis\s*\??\[\s*(["'])((?:\\.|(?!\3)[^\\])*)\3\s*\]/g;
var READ_DOT = /\bthis\s*\??\.\s*([A-Za-z_]\w*)/g;
var READ_API = /\bthis\s*\??\.\s*\$(?:getAll|resolve)\s*\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
function collectReadPaths(body) {
  const paths = /* @__PURE__ */ new Set();
  for (const [regex, groups] of [
    [READ_BRACKET, [2, 4]],
    [READ_API, [2]],
    [READ_DOT, [1]]
  ]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(body)) !== null) {
      for (const group of groups) {
        const value = match[group];
        if (value !== void 0 && value.length > 0 && !value.startsWith("$")) {
          paths.add(value);
        }
      }
    }
  }
  return paths;
}
function validateGetterCycles(script, scriptStart, locale3) {
  const msgs = getMessages(locale3);
  const getters = analyzeCallableBodies(script).filter((entry) => entry.kind === "getter");
  if (getters.length === 0) return [];
  const declared = new Set(getters.map((getter) => getter.name));
  const edges = /* @__PURE__ */ new Map();
  for (const getter of getters) {
    const targets = [];
    for (const read of collectReadPaths(getter.body)) {
      if (declared.has(read)) targets.push(read);
    }
    edges.set(getter.name, targets);
  }
  const gray = /* @__PURE__ */ new Set();
  const black = /* @__PURE__ */ new Set();
  const stack = [];
  const cyclesByEntry = /* @__PURE__ */ new Map();
  const visit = (name) => {
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
      visit(next);
    }
    stack.pop();
    gray.delete(name);
    black.add(name);
  };
  for (const getter of getters) {
    visit(getter.name);
  }
  if (cyclesByEntry.size === 0) return [];
  const out = [];
  for (const getter of getters) {
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
    const declared = new Set(analyzeStatePaths(block.content, block.stateName).map((p) => p.path));
    const bound = boundPaths.get(block.stateName) ?? /* @__PURE__ */ new Set();
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
  const byState = /* @__PURE__ */ new Map();
  const add = (stateName, path) => {
    let set = byState.get(stateName);
    if (set === void 0) {
      set = /* @__PURE__ */ new Set();
      byState.set(stateName, set);
    }
    set.add(path);
  };
  const index = buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName });
  for (const occurrence of index.occurrences) {
    add(occurrence.stateName, occurrence.path);
    if (!occurrence.path.startsWith(".")) continue;
    const forPath = getInnermostForPath(html, occurrence.pathRange.start, bindAttrName);
    if (forPath === null || forPath.startsWith(".")) continue;
    add(
      occurrence.stateName,
      occurrence.path === "." ? `${forPath}.*` : `${forPath}.*.${occurrence.path.slice(1)}`
    );
  }
  return byState;
}
function validateSemantics(html, stateTagName = "wcs-state", locale3, bindAttrName = "data-wcs") {
  const out = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    out.push(...validateIndexArity(block.content, block.contentStart, locale3));
    out.push(...validateGetterCycles(block.content, block.contentStart, locale3));
  }
  out.push(...validateUpdatedCallbackDemand(html, stateTagName, bindAttrName, locale3));
  return out;
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
    return { relativePath, text, loaded, states: applicationStatesOf(loaded) };
  }
  return void 0;
}
function applicationStatesOf(loaded) {
  const states = /* @__PURE__ */ new Map();
  const manifest = loaded.manifest;
  if (manifest === null || manifest.kind !== "application") return states;
  const application = manifest.manifestExtensions?.["wcstack.application"];
  for (const [name, entry] of Object.entries(application?.states ?? {})) {
    const schema = entry?.stateSchema;
    if (schema !== null && typeof schema === "object" && !Array.isArray(schema)) {
      states.set(name, schema);
    }
  }
  return states;
}

// src/core/validateDocument.ts
function validateDocument(text, options = {}) {
  const bindAttribute = options.bindAttribute ?? "data-wcs";
  const stateTagName = options.stateTagName ?? "wcs-state";
  const locale3 = options.locale;
  const fileReader = options.fileReader;
  const applicationStates = options.applicationStates ?? (fileReader !== void 0 ? discoverApplicationManifest(fileReader)?.states : void 0);
  const out = [];
  out.push(...validateBindings(text, bindAttribute, stateTagName, locale3, fileReader, applicationStates));
  out.push(...validateTemplateSyntax(text, stateTagName, bindAttribute, locale3, fileReader, applicationStates));
  out.push(...validateIoNodes(text, bindAttribute, stateTagName, locale3, fileReader));
  out.push(...validateAriaAttributes(text, bindAttribute, locale3));
  out.push(...validateDocumentEnv(text, locale3));
  out.push(...validateSemantics(text, stateTagName, locale3, bindAttribute));
  out.push(...validateArrayMutations(text, stateTagName, locale3));
  out.push(...validateWatchDeclarations(text, stateTagName, locale3));
  out.push(...validateNamedState(text, bindAttribute, stateTagName, locale3));
  for (const d of validateStateTypes(text, stateTagName, locale3)) {
    out.push({ code: WcsDiagnosticCode.TypeAnnotation, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  for (const d of validateNestedAssigns(text, stateTagName, locale3)) {
    out.push({ code: WcsDiagnosticCode.NestedAssign, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  return sortDiagnostics(out);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALLOWED_SCHEMA_KEYWORDS,
  WcsDiagnosticCode,
  validateDocument,
  validateManifestArtifact
});
//# sourceMappingURL=schema-core.cjs.map
