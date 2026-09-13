/**
 * scanDeclarationValidator.ts
 *
 * `<wcs-state>` スクリプト内の `$scan` 宣言を検証する（@wcstack/state docs/state-scan-design.md §1-2）。
 *
 * `$scan` の失敗は 2 通りに出る:
 * - **宣言の形が壊れている** — ランタイム（scan/processScanDeclaration.ts）が読み込み時に
 *   `raiseError` で落とす。静的に確実な形だけを error で拾う（code はランタイムと同語彙）。
 * - **パスが存在しない** — `from` / `resetOn` のタイプミスは黙って一度も畳まれない（reset されない）。
 *   `wcs/watch-path-missing` と同じ性質なので warning に揃える。
 *
 * 断定しないもの（誤検出を出さない側に倒す）:
 * - 値が識別子参照・計算キー・spread を含むエントリの中身。
 * - `$eventTokens` が配列リテラルでない（識別子参照・spread）ときの `on` の宣言有無。
 * - scan 同士の循環、stream との前進ループ（依存グラフを要る — ランタイムが raise する）。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';
import {
  analyzeScanEntries,
  analyzeStatePaths,
  findNonObjectScan,
  readEventTokenNames,
  type PathCandidate,
  type ScanEntryInfo,
  type ScanStringField,
} from './stateAnalyzer.js';

/**
 * HTML 内の全 `<wcs-state>` について `$scan` 宣言を検証する。
 */
export function validateScanDeclarations(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];

  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    const nonObject = findNonObjectScan(block.content);
    if (nonObject !== null) {
      out.push({
        code: WcsDiagnosticCode.ScanDeclarationInvalid,
        start: block.contentStart + nonObject.start,
        end: block.contentStart + nonObject.end,
        message: msgs.scanNotObject(),
        severity: 'error',
      });
    }

    const entries = analyzeScanEntries(block.content);
    if (entries.length === 0) continue;

    const context: IScanContext = {
      paths: analyzeStatePaths(block.content),
      tokens: readEventTokenNames(block.content),
      outputs: new Set(entries.map(entry => entry.name)),
      msgs,
    };
    for (const entry of entries) {
      for (const diagnostic of validateEntry(entry, context)) {
        out.push({
          code: diagnostic.code,
          start: block.contentStart + diagnostic.start,
          end: block.contentStart + diagnostic.end,
          message: diagnostic.message,
          severity: diagnostic.severity,
        });
      }
    }
  }

  return out;
}

interface IScanContext {
  readonly paths: readonly PathCandidate[];
  /** `$eventTokens` の宣言名。null は「断定しない」 */
  readonly tokens: ReadonlySet<string> | null;
  readonly outputs: ReadonlySet<string>;
  readonly msgs: WcsMessageCatalog;
}

interface IEntryDiagnostic {
  readonly code: WcsDiagnosticCodeValue;
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly start: number;
  readonly end: number;
}

/** 出力名の形・衝突・値の形。どれかに当たったら中身は見ない（直す順番を増やさない）。 */
function validateOutput(entry: ScanEntryInfo, context: IScanContext): IEntryDiagnostic | null {
  const { name } = entry;
  const invalid = (message: string): IEntryDiagnostic =>
    ({ code: WcsDiagnosticCode.ScanDeclarationInvalid, message, severity: 'error', start: entry.start, end: entry.end });
  if (name.startsWith('$') || name.includes('.') || name.includes('*')) {
    return invalid(context.msgs.scanOutputInvalid(name));
  }
  // ランタイムの assertOutputName と同じ判定（`name in Object.prototype`）
  if (name in Object.prototype) {
    return invalid(context.msgs.scanOutputReserved(name));
  }
  if (context.paths.some(p => p.path === name && p.kind === 'computed')) {
    return invalid(context.msgs.scanOutputConflict(name, 'getter'));
  }
  if (context.paths.some(p => p.path === `$streamStatus.${name}`)) {
    return invalid(context.msgs.scanOutputConflict(name, 'stream'));
  }
  if (entry.notObject) {
    return invalid(context.msgs.scanEntryNotObject(name));
  }
  return null;
}

function validateEntry(entry: ScanEntryInfo, context: IScanContext): IEntryDiagnostic[] {
  const outputProblem = validateOutput(entry, context);
  if (outputProblem !== null) return [outputProblem];
  if (!entry.readable) return [];

  const { name } = entry;
  const { msgs } = context;
  const out: IEntryDiagnostic[] = [];
  const atName = (message: string): IEntryDiagnostic =>
    ({ code: WcsDiagnosticCode.ScanDeclarationInvalid, message, severity: 'error', start: entry.start, end: entry.end });
  const atField = (field: ScanStringField, code: WcsDiagnosticCodeValue, message: string, severity: 'error' | 'warning' = 'error'): IEntryDiagnostic =>
    ({ code, message, severity, start: field.start, end: field.end });

  if (entry.hasFrom === entry.hasOn) {
    out.push(atName(msgs.scanSourceCount(name)));
  }
  if (!entry.hasInitial) {
    out.push(atName(msgs.scanInitialMissing(name)));
  }
  if (entry.foldMissingOrNotFunction) {
    out.push(atName(msgs.scanFoldNotFunction(name)));
  }

  if (entry.on !== null && context.tokens !== null && !context.tokens.has(entry.on.value)) {
    out.push(atField(entry.on, WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanOnUndeclared(name, entry.on.value)));
  }

  const from = entry.from;
  if (from !== null) {
    const problem = checkPath(name, 'from', from, context);
    if (problem !== null) {
      out.push(problem);
    } else if (from.value === name || from.value.startsWith(`${name}.`)) {
      out.push(atField(from, WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanFromSelf(name, from.value)));
    }
  }

  if (entry.resetOnNotArray) {
    out.push(atName(msgs.scanResetNotArray(name)));
  }
  for (const reset of entry.resetOn ?? []) {
    if (reset.value.includes('*') && !reset.value.includes('**')) {
      out.push(atField(reset, WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanResetWildcard(name, reset.value)));
      continue;
    }
    if (from !== null && reset.value === from.value) {
      out.push(atField(reset, WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanResetIsFrom(name, reset.value)));
      continue;
    }
    // 子孫は from の書き込みで必ず同じバッチに載る（祖先は「親の差し替えで作り直す」として通す）
    if (from !== null && reset.value.startsWith(`${from.value}.`)) {
      out.push(atField(reset, WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanResetUnderFrom(name, reset.value, from.value)));
      continue;
    }
    const root = reset.value.split('.')[0];
    if (context.outputs.has(root)) {
      out.push(atField(reset, WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanResetReadsOutput(name, reset.value, root)));
      continue;
    }
    const problem = checkPath(name, 'resetOn', reset, context);
    if (problem !== null) out.push(problem);
  }
  return out;
}

/**
 * `from` / `resetOn` のパス 1 本の検査（形 → getter → 存在の順に最初の 1 件）。
 * 存在の照合は候補が 1 つも取れないスクリプトでは行わない（watch-path-missing と同じ誤警告回避）。
 */
function checkPath(
  name: string,
  field: 'from' | 'resetOn',
  target: ScanStringField,
  context: IScanContext,
): IEntryDiagnostic | null {
  const path = target.value;
  const { msgs, paths } = context;
  const at = (code: WcsDiagnosticCodeValue, message: string, severity: 'error' | 'warning'): IEntryDiagnostic =>
    ({ code, message, severity, start: target.start, end: target.end });

  const segments = path.split('.');
  if (
    path.length === 0 || path.startsWith('$') || path.includes('@') ||
    path.includes('**') || segments.some(segment => segment.length === 0)
  ) {
    return at(WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanPathInvalid(name, field, path), 'error');
  }
  if (path in Object.prototype) {
    return at(WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanPathReserved(name, field, path), 'error');
  }
  const computed = new Set(paths.filter(p => p.kind === 'computed').map(p => p.path));
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join('.');
    if (computed.has(prefix)) {
      return at(WcsDiagnosticCode.ScanSourceComputed, msgs.scanSourceComputed(name, field, path, prefix), 'error');
    }
  }
  if (paths.length > 0 && !paths.some(p => p.path === path)) {
    return at(WcsDiagnosticCode.ScanPathMissing, msgs.scanPathMissing(name, field, path), 'warning');
  }
  return null;
}
