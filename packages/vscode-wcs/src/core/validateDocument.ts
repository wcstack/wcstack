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
import { validateIoNodes } from "../service/ioNodeValidator.js";
import { validateAriaAttributes } from "../service/ariaValidator.js";
import { validateDocumentEnv } from "../service/documentEnvValidator.js";
import { validateWatchDeclarations } from "../service/watchDeclarationValidator.js";
import { validateNamedState } from "../service/namedStateValidator.js";
import { validateMountAttributes } from "../service/mountAttrValidator.js";
import { validateSemantics } from "../service/semanticValidator.js";
import type { FileReader } from "../service/statePathResolver.js";
import { discoverApplicationManifest } from "./sidecar/discover.js";
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
}

/**
 * HTML テキストを全 validator で検査し、code 付き診断を安定順で返す。
 */
export function validateDocument(text: string, options: ValidateDocumentOptions = {}): WcsDiagnostic[] {
  const bindAttribute = options.bindAttribute ?? "data-wcs";
  const stateTagName = options.stateTagName ?? "wcs-state";
  const locale = options.locale;
  const fileReader = options.fileReader;
  const applicationSchema = options.applicationSchema
    ?? (fileReader !== undefined ? discoverApplicationManifest(fileReader)?.schema : undefined);

  const out: WcsDiagnostic[] = [];
  // bindingValidator / templateSyntaxValidator / ioNodeValidator / documentEnvValidator は既に code 付き。
  out.push(...validateBindings(text, bindAttribute, stateTagName, locale, fileReader, applicationSchema));
  out.push(...validateTemplateSyntax(text, stateTagName, bindAttribute, locale, fileReader, applicationSchema));
  out.push(...validateIoNodes(text, bindAttribute, stateTagName, locale, fileReader));
  out.push(...validateAriaAttributes(text, bindAttribute, locale));
  out.push(...validateDocumentEnv(text, locale));
  // arrayMutationValidator / watchDeclarationValidator は 2 コード持ちのため
  // validator 側で code を付与して返す。
  out.push(...validateSemantics(text, stateTagName, locale, bindAttribute));
  out.push(...validateArrayMutations(text, stateTagName, locale));
  out.push(...validateWatchDeclarations(text, stateTagName, locale));
  // 名前付き State の deprecation（v2 でマウントに置き換わる。docs/state-mount-design.md D16）
  out.push(...validateNamedState(text, bindAttribute, stateTagName, locale));
  // mount= の値検証（runtime の validateVolumeMountPath と同条件・同文言 — name= の鏡映と対称）
  out.push(...validateMountAttributes(text, stateTagName, locale));
  // 単一カテゴリの validator は集約時に code を付与する。
  for (const d of validateStateTypes(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.TypeAnnotation, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  for (const d of validateNestedAssigns(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.NestedAssign, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  return sortDiagnostics(out);
}
