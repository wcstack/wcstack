/**
 * scanDeclarationValidator.ts
 *
 * `<wcs-state>` スクリプト内の `$scan` 宣言を検証する（@wcstack/state docs/state-scan-design.md §1-2）。
 *
 * `$scan` の失敗は 2 通りに出る:
 * - **宣言の形が壊れている** — ランタイム（scan/processScanDeclaration.ts）が読み込み時に
 *   `raiseError` で落とす。静的に確実な形だけを error で拾う（code はランタイムと同語彙。
 *   `from` / `resetOn` の `**` はランタイムが PathInfo の不変条件で落とすので `wcs/recursion-unsupported`）。
 * - **パスが存在しない** — `from` / `resetOn` のタイプミスは黙って一度も畳まれない（reset されない）。
 *   `wcs/watch-path-missing` と同じ性質なので warning に揃える。
 *
 * 1 本のパスに複数の問題があるときは、ランタイムが先に落とす方を返す（形 → wildcard → getter →
 * 自分の from との関係 → scan 出力の読み → 存在）。
 *
 * ボリューム（`mount=`）の `$scan` はランタイムが接ぎ木の前に raise するので error、マウントされた
 * コンポーネント（`bind-component`）の `$scan` は warn して捨てるので warning にし、中身は検証しない
 * （`$recursion` の recursionValidator と同じ扱い）。
 *
 * `from` / `resetOn` の存在の照合は、`$recursion` の展開形（`nodes.*.children.*.value`）を宣言済みの
 * 候補へ畳めれば存在するとみなす（`$watch` の検証と同じ matchesRecursion）。
 *
 * 断定しないもの（誤検出を出さない側に倒す）:
 * - 値が識別子参照・計算キー・spread を含むエントリの中身。
 * - `$eventTokens` が配列リテラルでない（識別子参照・spread）ときの `on` の宣言有無。
 * - 出力名と、データプロパティの関数値の衝突（ランタイムは raise する。静的にはメソッド短縮記法だけを見る）。
 * - ワイルドカード段数の上限（128）。`$watch` と同じく、実コードで到達し得ずランタイムの防衛線で足りる。
 * - stream との前進ループ（`wcs/scan-feedback-loop`）。getter が何を読むかという依存グラフを要るので
 *   ランタイム専用。scan 同士の循環は出力名と `from` の根だけで決まるので、ここで拾う。
 */

import { parseWcsStateElements } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';
import { collectRecursionSpecs, hasRecursionWildcard, matchesRecursion, type RecursionSpec } from './recursionPaths.js';
import {
  analyzeDeclarationSpans,
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

  for (const element of parseWcsStateElements(html, stateTagName)) {
    // 属性名で判定する（タグ全体への正規表現は属性値の中の "bind-component" にも当たる）
    const mounted = element.bindComponent;
    for (const block of element.scriptBlocks) {
    if (block.mountPath !== null || mounted) {
      // ランタイムは宣言を処理しない（ボリュームは raise・マウントされたコンポーネントは warn して捨てる）
      const declaration = analyzeDeclarationSpans(block.content).find(span => span.name === '$scan');
      if (declaration !== undefined) {
        out.push({
          code: WcsDiagnosticCode.ScanDeclarationInvalid,
          start: block.contentStart + declaration.start,
          end: block.contentStart + declaration.end,
          message: block.mountPath !== null ? msgs.scanInVolume(block.mountPath) : msgs.scanInMountedComponent(),
          severity: block.mountPath !== null ? 'error' : 'warning',
        });
      }
      continue;
    }

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

    const paths = analyzeStatePaths(block.content);
    const context: IScanContext = {
      paths,
      pathSet: new Set(paths.map(p => p.path)),
      recursionSpecs: collectRecursionSpecs(paths),
      tokens: readEventTokenNames(block.content),
      outputs: new Set(entries.map(entry => entry.name)),
      msgs,
    };
    const diagnostics = [
      ...entries.flatMap(entry => validateEntry(entry, context)),
      ...findOutputCycles(entries, context),
    ];
    for (const diagnostic of diagnostics) {
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
  readonly pathSet: ReadonlySet<string>;
  /** 候補に載った `$recursion` 宣言（展開形のパスを存在するとみなす照合に使う） */
  readonly recursionSpecs: readonly RecursionSpec[];
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

type ScanPathField = 'from' | 'resetOn';

/** 出力名の形・衝突・値の形。どれかに当たったら中身は見ない（直す順番を増やさない）。 */
function validateOutput(entry: ScanEntryInfo, context: IScanContext): IEntryDiagnostic | null {
  const { name } = entry;
  const invalid = (message: string): IEntryDiagnostic =>
    ({ code: WcsDiagnosticCode.ScanDeclarationInvalid, message, severity: 'error', start: entry.start, end: entry.end });
  if (name.length === 0) {
    // 名前の範囲は引用符の内側で幅 0 になるので、引用符ごと指す
    return { ...invalid(context.msgs.scanOutputEmpty()), start: entry.start - 1, end: entry.end + 1 };
  }
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
  if (context.paths.some(p => p.path === name && p.kind === 'method')) {
    return invalid(context.msgs.scanOutputConflict(name, 'method'));
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
  const atField = (field: ScanStringField, message: string): IEntryDiagnostic =>
    ({ code: WcsDiagnosticCode.ScanDeclarationInvalid, message, severity: 'error', start: field.start, end: field.end });

  if (entry.hasFrom === entry.hasOn) {
    out.push(atName(msgs.scanSourceCount(name)));
  }
  if (entry.onNotString) {
    out.push(atName(msgs.scanOnNotString(name)));
  }
  if (entry.fromNotString) {
    out.push(atName(msgs.scanFromNotString(name)));
  }
  if (!entry.hasInitial) {
    out.push(atName(msgs.scanInitialMissing(name)));
  }
  if (entry.foldMissingOrNotFunction) {
    out.push(atName(msgs.scanFoldNotFunction(name)));
  }

  if (entry.on !== null && context.tokens !== null && !context.tokens.has(entry.on.value)) {
    out.push(atField(entry.on, msgs.scanOnUndeclared(name, entry.on.value)));
  }

  const from = entry.from;
  if (from !== null) {
    const problem = checkPathForm(name, 'from', from, msgs)
      ?? checkPathComputed(name, 'from', from, context)
      ?? checkFromWriteOnly(name, from, context)
      ?? (from.value === name || from.value.startsWith(`${name}.`) ? atField(from, msgs.scanFromSelf(name, from.value)) : null)
      ?? checkPathMissing(name, 'from', from, context);
    if (problem !== null) out.push(problem);
  }

  if (entry.resetOnNotArray) {
    out.push(atName(msgs.scanResetNotArray(name)));
  }
  if (entry.resetOnHasNonString) {
    out.push(atName(msgs.scanResetNotString(name)));
  }
  for (const reset of entry.resetOn ?? []) {
    const root = reset.value.split('.')[0];
    const problem = checkPathForm(name, 'resetOn', reset, msgs)
      ?? (reset.value.includes('*') ? atField(reset, msgs.scanResetWildcard(name, reset.value)) : null)
      ?? checkPathComputed(name, 'resetOn', reset, context)
      ?? (from !== null && reset.value === from.value ? atField(reset, msgs.scanResetIsFrom(name, reset.value)) : null)
      // 子孫は from の書き込みで必ず同じバッチに載る（祖先は「親の差し替えで作り直す」として通す）
      ?? (from !== null && reset.value.startsWith(`${from.value}.`)
        ? atField(reset, msgs.scanResetUnderFrom(name, reset.value, from.value))
        : null)
      ?? (context.outputs.has(root) ? atField(reset, msgs.scanResetReadsOutput(name, reset.value, root)) : null)
      ?? checkPathMissing(name, 'resetOn', reset, context);
    if (problem !== null) out.push(problem);
  }
  return out;
}

/**
 * `from` / `resetOn` のパスの形（ランタイムの assertValidScanPath と同じ順: 空・`$`・`@` →
 * `Object.prototype` の継承名 → `**` → 空セグメント）。
 */
function checkPathForm(
  name: string,
  field: ScanPathField,
  target: ScanStringField,
  msgs: WcsMessageCatalog,
): IEntryDiagnostic | null {
  const path = target.value;
  const at = (code: WcsDiagnosticCodeValue, message: string): IEntryDiagnostic =>
    ({ code, message, severity: 'error', start: target.start, end: target.end });
  if (path.length === 0 || path.startsWith('$') || path.includes('@')) {
    return at(WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanPathInvalid(name, field, path));
  }
  if (path in Object.prototype) {
    return at(WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanPathReserved(name, field, path));
  }
  if (hasRecursionWildcard(path)) {
    return at(WcsDiagnosticCode.RecursionUnsupported, msgs.recursionUnsupported(path, 'scan'));
  }
  if (path.split('.').some(segment => segment.length === 0)) {
    return at(WcsDiagnosticCode.ScanDeclarationInvalid, msgs.scanPathInvalid(name, field, path));
  }
  return null;
}

/**
 * getter（その配下を含む）を指すか。`$recursion` の `**` getter の展開形（`nodes.*.total`）とその値の内側
 * （`nodes.*.stats.count`）も getter とみなす（ランタイムの recursiveGetterOwning と同じ判定）。
 */
function checkPathComputed(
  name: string,
  field: ScanPathField,
  target: ScanStringField,
  context: IScanContext,
): IEntryDiagnostic | null {
  const segments = target.value.split('.');
  // getter の無い setter は getter ではない（from は checkFromWriteOnly が拾い、resetOn の引き金には使える）
  const computed = new Set(context.paths.filter(p => p.kind === 'computed' && p.writeOnly !== true).map(p => p.path));
  const at = (getter: string): IEntryDiagnostic => ({
    code: WcsDiagnosticCode.ScanSourceComputed,
    message: context.msgs.scanSourceComputed(name, field, target.value, getter),
    severity: 'error',
    start: target.start,
    end: target.end,
  });
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join('.');
    if (computed.has(prefix)) {
      return at(prefix);
    }
  }
  // 深さを畳んで `**` getter の候補（kind: 'recursive'）に当てる（照合は scan-path-missing と同じ
  // matchesRecursion）。当たった候補を getter 名として報告する
  const recursive = new Set(context.paths.filter(p => p.kind === 'recursive').map(p => p.path));
  const found: { getter: string | null } = { getter: null };
  matchesRecursion(context.recursionSpecs, target.value, candidate => {
    if (!recursive.has(candidate)) return false;
    found.getter = candidate;
    return true;
  });
  return found.getter === null ? null : at(found.getter);
}

/**
 * `from` が getter の無い setter（その配下を含む）を指すか。読むと常に undefined なので、ランタイムは
 * `wcs/scan-declaration-invalid` で raise する。`resetOn` は値を読まない引き金なので見ない。
 */
function checkFromWriteOnly(name: string, target: ScanStringField, context: IScanContext): IEntryDiagnostic | null {
  const writeOnly = new Set(context.paths.filter(p => p.writeOnly === true).map(p => p.path));
  const segments = target.value.split('.');
  for (let i = 1; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join('.');
    if (writeOnly.has(prefix)) {
      return {
        code: WcsDiagnosticCode.ScanDeclarationInvalid,
        message: context.msgs.scanFromWriteOnly(name, target.value, prefix),
        severity: 'error',
        start: target.start,
        end: target.end,
      };
    }
  }
  return null;
}

/** 状態定義に無いパス。候補が 1 つも取れないスクリプトでは照合しない（watch-path-missing と同じ誤警告回避）。 */
function checkPathMissing(
  name: string,
  field: ScanPathField,
  target: ScanStringField,
  context: IScanContext,
): IEntryDiagnostic | null {
  const { paths, pathSet, recursionSpecs } = context;
  if (
    paths.length > 0 &&
    !pathSet.has(target.value) &&
    // `$recursion` の展開形は、宣言済みの候補へ畳めれば存在する（`$watch` と同じ照合）
    !matchesRecursion(recursionSpecs, target.value, candidate => pathSet.has(candidate))
  ) {
    return {
      code: WcsDiagnosticCode.ScanPathMissing,
      message: context.msgs.scanPathMissing(name, field, target.value),
      severity: 'warning',
      start: target.start,
      end: target.end,
    };
  }
  return null;
}

/**
 * scan 同士が `from` の根を辿って循環する形（ランタイムの assertNoOutputReferences と同じ判定）。
 * 各 scan の `from` は 1 本なので辿る先は高々 1 つ。循環に乗っているエントリそれぞれの `from` に報告する。
 * 自分の出力を根にする `from` は scanFromSelf が報告済みなので辿らない。
 */
function findOutputCycles(entries: readonly ScanEntryInfo[], context: IScanContext): IEntryDiagnostic[] {
  const fromByName = new Map<string, ScanStringField>();
  const next = new Map<string, string>();
  for (const entry of entries) {
    if (entry.from === null) continue;
    const root = entry.from.value.split('.')[0];
    if (root !== entry.name && context.outputs.has(root)) {
      fromByName.set(entry.name, entry.from);
      next.set(entry.name, root);
    }
  }
  const out: IEntryDiagnostic[] = [];
  for (const [start, from] of fromByName) {
    const chain = [start];
    let current = next.get(start);
    while (current !== undefined && current !== start && chain.length <= next.size) {
      chain.push(current);
      current = next.get(current);
    }
    if (current === start) {
      out.push({
        code: WcsDiagnosticCode.ScanDeclarationInvalid,
        message: context.msgs.scanOutputCycle([...chain, start]),
        severity: 'error',
        start: from.start,
        end: from.end,
      });
    }
  }
  return out;
}
