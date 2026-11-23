/**
 * core/validateDocument.ts
 *
 * HTML ドキュメント検証の単一入口(Phase 5a §7.1)。VS Code の provideDiagnostics と
 * CI CLI が **同じこの関数** を呼ぶことで、同一入力から同一の {code, range, severity}
 * が出ることを構造的に保証する(§8 完了条件「IDE と CI の diagnostic code / range が
 * 一致」)。
 *
 * pure(DOM / vscode 非依存)。呼び出し側(plugin / CLI)が offset → position を担う。
 */

import { WcsDiagnostic, WcsDiagnosticCode, sortDiagnostics } from "./diagnostics.js";
import { validateBindings } from "../service/bindingValidator.js";
import { validateStateTypes } from "../service/stateTypeValidator.js";
import { validateNestedAssigns } from "../service/nestedAssignValidator.js";
import { validateArrayMutations } from "../service/arrayMutationValidator.js";
import { validateTemplateSyntax } from "../service/templateSyntaxValidator.js";
import { validateBindingSyntax } from "../service/bindingSyntaxValidator.js";
import { validateIoNodes } from "../service/ioNodeValidator.js";
import { validateAriaAttributes } from "../service/ariaValidator.js";
import { validateLiveRegions } from "../service/liveRegionValidator.js";
import { validateFormInputs } from "../service/formInputValidator.js";
import { validateBindingHosts } from "../service/bindingHostValidator.js";
import { validateIoAttributes } from "../service/ioAttributeValidator.js";
import { validateCommandArguments } from "../service/commandArgumentValidator.js";
import { validateOutputPathWrites } from "../service/outputPathValidator.js";
import { validateDocumentEnv } from "../service/documentEnvValidator.js";
import { validatePackageLoads } from "../service/packageLoadValidator.js";
import { validateWatchDeclarations } from "../service/watchDeclarationValidator.js";
import { validateScanDeclarations } from "../service/scanDeclarationValidator.js";
import { validateRecursion } from "../service/recursionValidator.js";
import { validateConfigDeclarations } from "../service/configDeclarationValidator.js";
import { validateNamedState } from "../service/namedStateValidator.js";
import { validateMountAttributes } from "../service/mountAttrValidator.js";
import { validateScopeDeclarations } from "../service/scopeDeclarationValidator.js";
import { validateSemantics } from "../service/semanticValidator.js";
import { validateScriptStateUses } from "../service/scriptStateUseValidator.js";
import { validateScriptReads } from "../service/scriptReadValidator.js";
import { validateScriptWrites } from "../service/scriptWriteValidator.js";
import { validateAccessorLists } from "../service/accessorListValidator.js";
import { validateModuleTopReads } from "../service/moduleTopReadValidator.js";
import { validateStateAbsent, validateStateSchemaDrift, validateStateSources } from "../service/stateSourceValidator.js";
import { isMustacheDisabled } from "../service/stateBehavior.js";
import { findAllMustacheSyntax } from "../service/templateSyntax.js";
import type { FileReader } from "../service/statePathResolver.js";
import { discoverApplicationManifest, schemaAppliesToPage } from "./sidecar/discover.js";
import { findIgnoredRanges } from "../language/htmlParse.js";
import { inlineExternalStates, locateInlined } from "./externalState.js";
import { blankRanges, findDccDefinitions, keepOnly, registerScopeSource } from "../service/dccDefinitions.js";
import { validateDccAttributes, validateDccDeclarations } from "../service/dccDeclarationValidator.js";
import { validateClassPartScripts, validateClassPartTemplates } from "../service/componentPartValidator.js";
import type { JsonSchemaNode } from "./sidecar/types.js";

export interface ValidateDocumentOptions {
  /** バインド属性名(既定 data-wcs)。 */
  readonly bindAttribute?: string;
  /** state タグ名(既定 wcs-state)。 */
  readonly stateTagName?: string;
  /**
   * 診断メッセージのロケール('ja' / 'en'、'ja-JP' 等も可)。既定 ja。
   * 安定契約は {code, range, severity} — message はロケールで変わってよい。
   */
  readonly locale?: string;
  /**
   * `<wcs-state src=...>` の外部 state ファイル(.json / .js / .ts)を読むコールバック。
   * 未指定なら src 属性はスキップ(従来どおり候補ゼロ → パス検証は沈黙)。
   * CLI(cli.ts)と IDE(service/wcsCompletionPlugin.ts の provideDiagnostics)の
   * **両方**が `fileReader.ts` の同じ reader を渡す — 片方だけだと同じ validator core を
   * 呼んでいても診断が一致せず「CI で初めて落ちる」ずれになる
   * (static-wiring-dx-design.md §6-2 / ADR-09 §7.1 の IDE / CLI パリティ)。
   */
  readonly fileReader?: FileReader;
  /**
   * 単一ツリーの `stateSchema`(application manifest の `wcstack.application.stateSchema` — v2)。
   * 宣言されていれば、未存在パスが `wcs/binding-path-missing`(warning)ではなく
   * `wcs/path-nonexistent`(error)になる(docs/app-testing-and-typescript-impl-plan.md D6)。
   * 存在判定は sidecar/schemaSubset.ts の `resolveSchemaPath` の三値で行い、`unknown`
   * (素の `{}` の下・動的構造)は沈黙する。
   *
   * 未指定で `fileReader` があれば、HTML の位置から最近傍の `wcstack.manifest.json` を
   * 発見して使う(D8・sidecar/discover.ts)。CLI は明示引数に application manifest が
   * ある時だけここへ渡し(明示が発見を置き換える)、IDE は常に発見に任せる — どちらも
   * 同じ `discoverApplicationManifest` を同じ reader で通るので診断が一致する。
   */
  readonly applicationSchema?: JsonSchemaNode;
  /**
   * The state file `applicationSchema` was generated from (the manifest's `stateSource`), relative to the HTML file's
   * directory. When given, the schema is the contract of this page only if its root `<wcs-state src>` loads that file
   * (sidecar/discover.ts `schemaAppliesToPage`); otherwise the page is checked as if no manifest were there. A
   * discovered manifest's `stateSource` is read the same way.
   */
  readonly applicationStateSource?: string;
}

/**
 * HTML テキストを全 validator で検査し、code 付き診断を安定順で返す。
 */
export function validateDocument(text: string, options: ValidateDocumentOptions = {}): WcsDiagnostic[] {
  return validateScopes(text, options, text);
}

/**
 * A Declarative Custom Component's definition is a scope of its own: the markup in its template is bound by its own
 * `<wcs-state>`, never by the page's. So the page is checked without its definitions, and each definition's content
 * (with its `<template shadowrootmode>` tags) as a document of its own — the same text with the rest blanked, so
 * every offset stays where it is, and the content is in a template for the rules that ask, as it always was. Up to 4.28 the
 * definition's keys and the page's were one set: a page's binding passed on a key only a part had, and a part's on a
 * key only the page had (the garden-plots seam app).
 *
 * `env` is the text the page-level rules read (the scripts a page loads, its `<base>`, its outlets): the whole page
 * for the page, none for a definition.
 */
function validateScopes(text: string, options: ValidateDocumentOptions, env: string | null, inDefinition: boolean = false): WcsDiagnostic[] {
  const definitions = findDccDefinitions(text);
  if (definitions.length === 0) return validateScope(text, options, env, inDefinition);
  const stateTagName = options.stateTagName ?? "wcs-state";
  const page = blankRanges(text, definitions.map((d) => [d.hostStart, d.hostEnd] as const));
  registerScopeSource(page, text);
  const out = [...validateScope(page, options, env, inDefinition)];
  for (const definition of definitions) {
    const scope = keepOnly(text, definition.templateStart, definition.templateEnd);
    registerScopeSource(scope, text);
    out.push(...validateScopes(scope, options, null, true));
    out.push(...validateDccDeclarations(text, definition, stateTagName, options.locale, options.fileReader));
  }
  return sortDiagnostics(out);
}

/** One scope: the page (or a fragment) without its definitions, or one definition's content. */
function validateScope(text: string, options: ValidateDocumentOptions, env: string | null, inDefinition: boolean): WcsDiagnostic[] {
  const stateTagName = options.stateTagName ?? "wcs-state";
  const fileReader = options.fileReader;
  // (an application's stateSchema describes the page's tree, not a part's)
  const applicationSchema = inDefinition ? undefined : applicationSchemaFor(text, stateTagName, options);
  // A `src` the reader cannot read: once, on the page (the second pass below would find it again). Bindings in a file
  // with no `<wcs-state>` (a fragment): their paths are not checked — said once (no state, so no second pass)
  const found = [
    ...validateText(text, options, applicationSchema, env),
    ...validateStateSources(text, stateTagName, options.locale, fileReader),
    ...validateStateAbsent(text, options.bindAttribute ?? "data-wcs", stateTagName, options.locale, applicationSchema),
    // a stateSchema whose top-level keys are not the root state script's: stale (once, on the page's `<wcs-state>`)
    ...validateStateSchemaDrift(text, stateTagName, options.locale, fileReader, applicationSchema),
  ];
  // A state in a file of its own (`src=`): the page again, with each such script inline (core/externalState.ts).
  // A finding in a file is shown on its `src` value and carries where it is in the file (`origin`); one in the
  // page is added when the page alone did not find it (the handler of an `onsubmit:` written in the file)
  const page = fileReader === undefined ? null : inlineExternalStates(text, stateTagName, fileReader);
  if (page === null) return sortDiagnostics(found);
  const key = (d: WcsDiagnostic): string => [d.code, d.start, d.end, d.message, d.origin?.path, d.origin?.start].join("\u0000");
  const seen = new Set(found.map(key));
  const out = [...found];
  // (the page-level rules read the inlined text too, as they always did — a state file's imports count among the page's;
  //  with definitions cut out of the page they were asked over the whole page in the first pass, and are not asked again)
  for (const d of validateText(page.text, options, applicationSchema, env === text ? page.text : null)) {
    const start = locateInlined(page, d.start);
    const end = locateInlined(page, d.end);
    let mapped: WcsDiagnostic;
    if (start.state !== undefined) {
      const state = start.state;
      const fileEnd = end.state === state ? Math.max(end.offset, start.offset) : start.offset;
      mapped = {
        ...d,
        start: state.valueStart,
        end: state.valueEnd,
        origin: {
          path: state.path,
          start: start.offset,
          end: fileEnd,
          startPosition: state.position(start.offset),
          endPosition: state.position(fileEnd),
        },
      };
    } else {
      mapped = { ...d, start: start.offset, end: end.state === undefined ? Math.max(end.offset, start.offset) : start.offset };
    }
    const k = key(mapped);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(mapped);
  }
  return sortDiagnostics(out);
}

/**
 * The stateSchema that is this page's contract: the one given, or the nearest manifest's (discovered with the reader) —
 * and not when the manifest names the state file it was generated from (`stateSource`) and the page's root state is
 * not that file (an inline state, another `src`): the schema describes another state, and its paths were reported
 * nonexistent on a page that has them (the lending-desk seam app).
 */
function applicationSchemaFor(text: string, stateTagName: string, options: ValidateDocumentOptions): JsonSchemaNode | undefined {
  let schema = options.applicationSchema;
  let stateSource = options.applicationStateSource;
  if (schema === undefined && options.fileReader !== undefined) {
    const discovered = discoverApplicationManifest(options.fileReader);
    schema = discovered?.schema;
    stateSource = discovered?.stateSource;
  }
  if (schema === undefined || stateSource === undefined) return schema;
  return schemaAppliesToPage(text, stateTagName, stateSource, options.fileReader) ? schema : undefined;
}

/**
 * Every validator over one text (a scope, or a scope with its external states inline). `env`: the text the
 * page-level rules read, or null when they are not asked (a definition; the second pass, which would say them twice).
 */
function validateText(text: string, options: ValidateDocumentOptions, applicationSchema: JsonSchemaNode | undefined, env: string | null): WcsDiagnostic[] {
  const bindAttribute = options.bindAttribute ?? "data-wcs";
  const stateTagName = options.stateTagName ?? "wcs-state";
  const locale = options.locale;
  const fileReader = options.fileReader;

  const out: WcsDiagnostic[] = [];
  // bindingValidator / templateSyntaxValidator / ioNodeValidator / documentEnvValidator は既に code 付き。
  out.push(...validateBindings(text, bindAttribute, stateTagName, locale, fileReader, applicationSchema));
  out.push(...validateTemplateSyntax(text, stateTagName, bindAttribute, locale, fileReader, applicationSchema));
  out.push(...validateBindingSyntax(text, bindAttribute, locale));
  out.push(...validateIoNodes(text, bindAttribute, stateTagName, locale, fileReader));
  out.push(...validateAriaAttributes(text, bindAttribute, locale));
  // a live region inserted with its text by a for / if template or a route (never announced)
  out.push(...validateLiveRegions(text, bindAttribute, stateTagName, locale));
  // what a form control's bindings do with what the user enters: a radio name every row shares, a string written
  // into a number, an output filter on a two-way value
  out.push(...validateFormInputs(text, bindAttribute, stateTagName, locale, fileReader, applicationSchema));
  // bindings on an element where they never take effect: on <body> / <html> (the state binds what is inside <body>),
  // an event handler on a <wcs-link> (its host is display: none)
  out.push(...validateBindingHosts(text, bindAttribute, stateTagName, locale));
  // a literal attribute of a built-in tag that does not mean what was written: a root-margin without px or %, a
  // sensor's frequency that is not a positive number, a target that names an id as a tag
  out.push(...validateIoAttributes(text, bindAttribute, locale));
  // `on*: $command.x` wired straight to a command that takes data: the event lands in the data's place
  out.push(...validateCommandArguments(text, bindAttribute, locale));
  if (env !== null) {
    out.push(...validateDocumentEnv(env, locale));
    // a wcstack package's tags with no script of it; a page pinning a newer minor than the lint's rules
    out.push(...validatePackageLoads(env, locale, fileReader));
    // the state of each class part the page mounts, under the script rules of a page's state (once for the page)
    out.push(...validateClassPartScripts(env, locale, fileReader));
  }
  // an instance of a DCC that carries one of the part's inputs as an attribute
  out.push(...validateDccAttributes(text, stateTagName, locale, fileReader));
  // the templates of the class parts this scope mounts: a path whose first key nothing gives
  out.push(...validateClassPartTemplates(text, bindAttribute, stateTagName, locale, fileReader, applicationSchema));
  // arrayMutationValidator / watchDeclarationValidator は 2 コード持ちのため
  // validator 側で code を付与して返す。
  out.push(...validateSemantics(text, stateTagName, locale, bindAttribute));
  // what a state's script uses of itself: undeclared and unbound command tokens, a write of a key it does not declare
  out.push(...validateScriptStateUses(text, stateTagName, locale, bindAttribute));
  // the paths its getters and methods read, checked as the bindings' are; a spread or a key's value the lint cannot read (info)
  out.push(...validateScriptReads(text, stateTagName, locale, fileReader, applicationSchema, bindAttribute));
  // what its getters, setters and methods write: a getter that writes, a getter without a setter written, setters that
  // write each other, a setter whose writes its getter does not read (docs/script-write-checks.md)
  out.push(...validateScriptWrites(text, stateTagName, locale));
  // a script that writes `true` to a path only an element's output is bound to: the write does not reach the element
  out.push(...validateOutputPathWrites(text, bindAttribute, stateTagName, locale, fileReader));
  // 4.22's script syntaxes: a malformed key listing several accessor paths, a full path of one list's rows in an
  // accessor declared for several, a path relative to the row where there is none
  out.push(...validateAccessorLists(text, stateTagName, locale));
  out.push(...validateArrayMutations(text, stateTagName, locale));
  // a session read at the top level of a module evaluated once: a guard's (error), a state's (warning)
  out.push(...validateModuleTopReads(text, stateTagName, locale));
  // A root `$watch` key can name a path under a volume: the volumes' `src=` is read with the bindings' reader
  out.push(...validateWatchDeclarations(text, stateTagName, locale, fileReader, bindAttribute, applicationSchema));
  // `$scan` 宣言（runtime の scan/processScanDeclaration.ts と同じ診断 code。3 コード持ち）
  out.push(...validateScanDeclarations(text, stateTagName, locale));
  // `$recursion` 宣言と `**` の使い方（runtime の recursion/ と同じ診断 code）。
  out.push(...validateRecursion(text, stateTagName, locale));
  // 4.0 の設定の宣言（`$behavior` / `$features` / root の `features=`）
  out.push(...validateConfigDeclarations(text, stateTagName, locale));
  // 名前付き State の deprecation（v2 でマウントに置き換わる。docs/state-mount-design.md D16）
  out.push(...validateNamedState(text, bindAttribute, stateTagName, locale));
  // mount= の値検証（runtime の validateVolumeMountPath と同条件・同文言 — name= の鏡映と対称）
  out.push(...validateMountAttributes(text, stateTagName, locale));
  // ボリュームが受け付けない宣言・bind-component と併記した読み込み（4.0 の scopes/volume.ts・component.ts と同条件）
  out.push(...validateScopeDeclarations(text, stateTagName, locale));
  // 単一カテゴリの validator は集約時に code を付与する。
  for (const d of validateStateTypes(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.TypeAnnotation, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  for (const d of validateNestedAssigns(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.NestedAssign, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  // `data-wcs-ignore`: the runtime reads nothing in such an element as bindings, so nothing in it is reported.
  // `$behavior: { enableMustache: false }` on the page's root state: no `{{ }}` is a binding — a CMS's or a server
  // template's braces beside an island (the community-hall seam app) — so nothing is said about one (comment bindings
  // are still bound, and checked). Read only when the state can be read: otherwise `{{ }}` is checked as before
  const ignored: Array<readonly [number, number]> = [
    ...findIgnoredRanges(text, bindAttribute),
    ...(text.includes("{{") && isMustacheDisabled(text, stateTagName, fileReader)
      ? findAllMustacheSyntax(text).map((m) => [m.matchStart, m.matchEnd] as const)
      : []),
  ];
  const kept = ignored.length === 0 ? out : out.filter((d) => !ignored.some(([start, end]) => d.start >= start && d.start < end));
  return sortDiagnostics(kept);
}
