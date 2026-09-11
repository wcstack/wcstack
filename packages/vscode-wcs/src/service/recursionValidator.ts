/**
 * recursionValidator.ts
 *
 * `<wcs-state>` スクリプト内の `$recursion` 宣言と `**` パスを検証する。
 *
 * ランタイム（`@wcstack/state` src/recursion/）は `**` を**オーサリング層だけの記号**として
 * 扱う。宣言に合致しない `**`、`**` を解釈しない場所の `**`、`**` に対して定義できない
 * 添字の形は、どれもページ初期化ごと止まる `raiseError` になる。ここはその**静的に決まる
 * 部分だけ**を、同じ診断 code で先に出す（IDE / CI / ランタイムの語彙を揃える）。
 *
 * 静的に出さないもの（意図的な穴。docs/state-recursive-path-impl-plan.md §7）:
 *
 *   - `wcs/recursion-context`（再帰文脈の外で `**` を添字省略で読んだ）… 深さは
 *     **評価時の呼び出し元**で決まる。`get "nodes.**.total"() { return this.sum(); }` の
 *     `sum()` は再帰文脈**を持つ**ので、宣言の形だけでは決められない。呼び出しグラフを
 *     追えば近似できるが、外した側が誤報になるので runtime 専用に倒す。
 *   - `wcs/recursion-shared-list` / `wcs/recursion-cycle` / `wcs/recursion-depth-exceeded`
 *     … 入力データの形（同じ配列インスタンスの共有・木の深さ）を見ないと決まらない。
 *
 * 正当な明示全体検索（`$getAll("nodes.**.value", [])`）は**一律に通す**。二重計上の
 * 一般的な静的判定は約束しない（設計書 §1-2）。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import {
  analyzeCallableBodies,
  analyzeDeclarationSpans,
  analyzeRecursionDeclaration,
  type RecursionDeclarationInfo,
} from './stateAnalyzer.js';
import { blankComments, createApiCallRegex, literalArrayLength, literalString, splitCallArgs } from './scriptCallArgs.js';
import {
  checkNodePath,
  conflictingGetterSuffix,
  hasRecursionWildcard,
  makeRecursionSpec,
  sameFamily,
  splitRecursivePath,
  structuralWriteTarget,
  type RecursionSpec,
} from './recursionPaths.js';

/** `**` を受け付ける API（`$resolve` は受け付けない ＝ 受け付けないことを報告する）。 */
const RECURSION_APIS = ['getAll', 'setAll', 'resolve'] as const;

/**
 * HTML 内の全 `<wcs-state>` について `$recursion` 宣言と `**` の使い方を検証する。
 */
export function validateRecursion(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];

  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    // `**` も `$recursion` も無いスクリプトは 1 回の indexOf で抜ける（ゼロコスト規約）
    if (!hasRecursionWildcard(block.content) && block.content.indexOf('$recursion') === -1) continue;
    const declaration = analyzeRecursionDeclaration(block.content);
    const spec = validateDeclaration(declaration, block.contentStart, msgs, out);
    const getterSuffixes = validateRecursiveGetters(block.content, block.contentStart, spec, declaration, msgs, out);
    validateApiCalls(block.content, block.contentStart, spec, getterSuffixes, msgs, out);
  }

  return out;
}

/**
 * severity の規約は既存 validator と同じ:
 * **error はランタイムが `raiseError` で落とす形**（ページ初期化ごと止まる）、
 * warning は「黙って効かない」形。`**` は PathInfo の不変条件なのでほぼ error だが、
 * 宣言の無い `**` **getter キー**だけは runtime が黙って無視する（レジストリに載らない）
 * ので warning に落とす。
 */
function push(
  out: WcsDiagnostic[],
  code: WcsDiagnostic['code'],
  start: number,
  end: number,
  message: string,
  severity: 'error' | 'warning' = 'error',
): void {
  out.push({ code, start, end, message, severity });
}

/**
 * `$recursion` 宣言そのものを検証し、形が完全に正しいときだけ仕様を返す。
 *
 * ランタイム（recursion/declaration.ts）は**初回マウントで**この検証に落ちるので、
 * 誤りはページごと止まる ＝ すべて error。
 */
function validateDeclaration(
  declaration: RecursionDeclarationInfo | null,
  offset: number,
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): RecursionSpec | null {
  if (declaration === null) return null;
  const code = WcsDiagnosticCode.RecursionDeclarationInvalid;
  if (declaration.notObject) {
    push(out, code, offset + declaration.start, offset + declaration.end, msgs.recursionNotObject());
    return null;
  }
  if (declaration.entries.length !== 1) {
    // 値がオブジェクトリテラルでない（識別子参照など・断定しない形）ときもエントリは
    // 0 件になる。`{}` と**書かれている**ときだけ「空」と報告する（黙る側に倒す）
    if (!declaration.objectLiteral) return null;
    push(out, code, offset + declaration.start, offset + declaration.end,
      msgs.recursionAnchorCount(declaration.entries.length));
    return null;
  }

  const entry = declaration.entries[0];
  const anchorProblem = checkNodePath(entry.anchor);
  if (anchorProblem !== null) {
    push(out, code, offset + entry.start, offset + entry.end,
      msgs.recursionNodePathInvalid('anchor', entry.anchor, anchorProblem));
    return null;
  }
  if (entry.repeat === null) {
    push(out, code, offset + entry.valueStart, offset + entry.valueEnd,
      msgs.recursionRepeatNotString(entry.anchor));
    return null;
  }
  const repeatProblem = checkNodePath(entry.repeat);
  if (repeatProblem !== null) {
    push(out, code, offset + entry.valueStart, offset + entry.valueEnd,
      msgs.recursionNodePathInvalid('repeat', entry.repeat, repeatProblem));
    return null;
  }
  return makeRecursionSpec(entry.anchor, entry.repeat);
}

/**
 * `**` を含む宣言キー（再帰 getter）を検証し、宣言済み getter の**接尾辞**を返す。
 * 接尾辞は `$setAll` の読み取り専用判定（`wcs/recursion-readonly`）が消費する。
 */
function validateRecursiveGetters(
  script: string,
  offset: number,
  spec: RecursionSpec | null,
  declaration: RecursionDeclarationInfo | null,
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): string[] {
  // get / set のペアは同じ名前で 2 件現れる。報告は名前ごとに 1 件に畳む
  // （ランタイムも宣言 1 本につき 1 回しか落ちない）。
  const seen = new Set<string>();
  const spans = analyzeDeclarationSpans(script)
    .filter(s => hasRecursionWildcard(s.name))
    .filter(s => (seen.has(s.name) ? false : (seen.add(s.name), true)));
  if (spans.length === 0) return [];
  // set アクセサの識別だけは本体付きの列挙が要る（analyzeDeclarationSpans は get/set を
  // どちらも 'getter' として返す）
  const setterNames = new Set(
    analyzeCallableBodies(script).filter(c => c.accessor === 'set').map(c => c.name),
  );

  const suffixes: string[] = [];
  const accepted: { name: string; suffix: string; start: number; end: number }[] = [];
  for (const span of spans) {
    const start = offset + span.start;
    const end = offset + span.end;
    if (spec === null) {
      // 宣言が無い（または宣言そのものが壊れている）。ランタイムはこの getter を
      // レジストリに載せないので、具体パスを読んでも**黙って** undefined になる ＝
      // 落ちないので warning（宣言が壊れている場合は上で error を出し済み）。
      if (declaration === null) {
        push(out, WcsDiagnosticCode.RecursionUnsupported, start, end,
          msgs.recursionUnsupported(span.name, 'undeclared'), 'warning');
      }
      continue;
    }
    if (span.kind !== 'getter') {
      push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, start, end,
        msgs.recursionGetterInvalid(span.name, 'notGetter', spec.recursiveAnchor));
      continue;
    }
    if (setterNames.has(span.name)) {
      push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, start, end,
        msgs.recursionGetterInvalid(span.name, 'setter', spec.recursiveAnchor));
      continue;
    }
    const suffix = splitRecursivePath(spec, span.name);
    if (suffix === null) {
      push(out, WcsDiagnosticCode.RecursionAnchor, start, end,
        msgs.recursionAnchorMismatch(span.name, spec.recursiveAnchor));
      continue;
    }
    if (suffix.length === 0) {
      push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, start, end,
        msgs.recursionGetterInvalid(span.name, 'nodeItself', spec.recursiveAnchor));
      continue;
    }
    // 既に受理した getter と同じ具体パス族へ展開しないか（RecursionRegistry の静的検査）
    const collision = accepted.find(other => sameFamily(spec, other.suffix, suffix));
    if (collision !== undefined) {
      push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, start, end,
        msgs.recursionGetterCollision(collision.name, span.name, spec.repeat));
      continue;
    }
    accepted.push({ name: span.name, suffix, start, end });
    suffixes.push(suffix);
  }
  return suffixes;
}

/**
 * `$getAll` / `$setAll` / `$resolve` の第 1 引数が `**` を含む呼び出しを検証する。
 *
 * 報告は 1 呼び出しにつき**最初の 1 件**だけ（同じ呼び出しに複数の理由を並べても
 * 直す順番が増えるだけ）。判定順はランタイムに合わせる — アンカー照合 → 添字の形 →
 * 値の形 → 構造への書き込み → 読み取り専用。
 */
function validateApiCalls(
  script: string,
  offset: number,
  spec: RecursionSpec | null,
  getterSuffixes: readonly string[],
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): void {
  const scan = blankComments(script);
  const regex = createApiCallRegex(RECURSION_APIS);
  let match: RegExpExecArray | null;
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
    const start = offset + parsed.starts[0] + leading;
    const end = offset + parsed.starts[0] + pathArg.trimEnd().length;

    if (api === '$resolve') {
      push(out, WcsDiagnosticCode.RecursionUnsupported, start, end, msgs.recursionUnsupported(path, 'resolve'));
      continue;
    }
    if (spec === null) {
      push(out, WcsDiagnosticCode.RecursionUnsupported, start, end, msgs.recursionUnsupported(path, 'undeclared'));
      continue;
    }
    const suffix = splitRecursivePath(spec, path);
    if (suffix === null) {
      push(out, WcsDiagnosticCode.RecursionAnchor, start, end, msgs.recursionAnchorMismatch(path, spec.recursiveAnchor));
      continue;
    }
    if (api === '$getAll') {
      // 添字省略（＝評価深さへの束縛）と `[]`（＝全深さ）は正当。非空の接頭辞だけが不正。
      const indexes = parsed.args.length > 1 ? literalArrayLength(parsed.args[1]) : null;
      if (indexes !== null && indexes > 0) {
        push(out, WcsDiagnosticCode.RecursionGetAllForm, start, end, msgs.recursionGetAllForm(path));
      }
      continue;
    }
    validateSetAllForm(path, suffix, parsed.args, spec, getterSuffixes, start, end, msgs, out);
  }
}

/** `$setAll("…**…", indexes, value, options)` の形（ランタイムの判定順に並べる）。 */
function validateSetAllForm(
  path: string,
  suffix: string,
  args: readonly string[],
  spec: RecursionSpec,
  getterSuffixes: readonly string[],
  start: number,
  end: number,
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): void {
  const formCode = WcsDiagnosticCode.RecursionSetAllForm;
  const indexesArg = args.length > 1 ? args[1].trim() : '';
  // 添字は「明示的な空配列」だけが正。省略・`undefined`・`null` は runtime が落とす。
  if (args.length < 2 || indexesArg === 'undefined' || indexesArg === 'null') {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, 'noIndexes'));
    return;
  }
  const indexes = literalArrayLength(args[1]);
  if (indexes !== null && indexes > 0) {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, 'prefix'));
    return;
  }
  if (args.length > 2 && isFunctionLiteral(args[2])) {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, 'mapper'));
    return;
  }
  if (args.length > 3 && /\bspread\s*:\s*true\b/.test(args[3])) {
    push(out, formCode, start, end, msgs.recursionSetAllForm(path, 'spread'));
    return;
  }
  const structural = structuralWriteTarget(spec, suffix);
  if (structural !== null) {
    push(out, WcsDiagnosticCode.RecursionStructuralWrite, start, end,
      msgs.recursionStructuralWrite(path, structural, spec.repeatList));
    return;
  }
  const conflicting = conflictingGetterSuffix(spec, getterSuffixes, suffix);
  if (conflicting !== null) {
    push(out, WcsDiagnosticCode.RecursionReadonly, start, end,
      msgs.recursionReadonly(path, spec.recursiveAnchor + conflicting));
  }
}

/**
 * 実引数が「関数である」と静的に断定できる形か（mapper 判定）。
 * 識別子参照・呼び出し式は断定しない（黙る側に倒す）。
 */
function isFunctionLiteral(arg: string): boolean {
  const trimmed = arg.trim();
  if (trimmed.length === 0) return false;
  return (
    /^(?:async\s+)?function\b/.test(trimmed) ||
    /^(?:async\s+)?\([^()]*\)\s*=>/.test(trimmed) ||
    /^(?:async\s+)?[$\w]+\s*=>/.test(trimmed)
  );
}
