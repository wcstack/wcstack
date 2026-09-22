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
 *
 * 「宣言が無い」と断定するのは、`export default { … }` のオブジェクトリテラルが読めて、
 * かつそこに `$recursion` が無いときだけ。識別子参照（`$recursion: REC`）や class 構文は
 * 宣言の中身が静的に読めないので黙る（`validateDeclaration` の「断定しない」と同じ側）。
 * ここを無条件に「未宣言」にすると、正当なコードで `wcs-validate` が exit 1 になる。
 */

import { parseWcsStateElements } from '../language/htmlParse.js';
import { ASSIGN_TAIL, PRE_INCDEC, ROOT_BRACKET } from './scriptPatterns.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import {
  analyzeCallableBodies,
  analyzeDeclarationSpans,
  analyzeListKeyEntries,
  analyzeRecursionDeclaration,
  hasDefaultExportObject,
  hasTopLevelSpread,
  maskCommentsAndStrings,
  type RecursionDeclarationInfo,
} from './stateAnalyzer.js';
import { blankComments, createApiCallRegex, literalArrayLength, literalString, splitCallArgs } from './scriptCallArgs.js';
import {
  checkNodePath,
  concreteExpansionSuffix,
  conflictingGetterSuffix,
  hasRecursionWildcard,
  foldSuffixIndexes,
  makeRecursionSpec,
  owningGetterSuffix,
  sameFamily,
  splitRecursivePath,
  structuralWriteTarget,
  type RecursionSpec,
} from './recursionPaths.js';

/**
 * パスを第 1 引数に取る API。`$getAll` / `$setAll` だけが `**` を解釈する。
 * `$resolve` / `$postUpdate` / `$trackDependency` は受け付けない ＝ 受け付けないことを報告する
 * （ランタイムは `getPathInfo` の不変条件で `wcs/recursion-unsupported`）。
 */
const RECURSION_APIS = ['getAll', 'setAll', 'resolve', 'postUpdate', 'trackDependency'] as const;

/** `**` を解釈しない API（`$getAll` / `$setAll` 以外）→ `recursionUnsupported` の site。 */
const UNSUPPORTED_API_SITE = {
  $resolve: 'resolve',
  $postUpdate: 'postUpdate',
  $trackDependency: 'trackDependency',
  $dependOn: 'trackDependency',
} as const;

/**
 * `this["<path>"] = …`（複合代入・`??=` 等を含む。`==` / `===` は除く）。
 * 代入は `**` を解釈しない（再帰 setter は初版に無く、set トラップは `getPathInfo` の不変条件で
 * throw する）。具体パス綴りの代入は `**` getter の展開形への書き込み検査（readonly）に使う。
 */
const BRACKET_ASSIGNMENT = new RegExp(`${ROOT_BRACKET}${ASSIGN_TAIL}`, 'g');
/** `++this["<path>"]` / `--this["<path>"]`（前置）。後置は `ASSIGN_TAIL` が持つ。 */
const PRE_BRACKET_INCDEC = new RegExp(`${PRE_INCDEC}${ROOT_BRACKET}`, 'g');

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

  for (const element of parseWcsStateElements(html, stateTagName)) {
    // マウントされたコンポーネントの state（`bind-component`）は `$recursion` / `**` getter を実行しない。
    // 属性名で判定する（タグ全体への正規表現は属性値の中の "bind-component" にも当たる）
    const mounted = element.bindComponent;
    for (const block of element.scriptBlocks) {
    // `**` も `$recursion` も無いスクリプトは 1 回の indexOf で抜ける（ゼロコスト規約）
    if (!hasRecursionWildcard(block.content) && block.content.indexOf('$recursion') === -1) continue;
    const declaration = analyzeRecursionDeclaration(block.content);
    // ボリューム（`mount=`）とマウントされたコンポーネント（`bind-component`）は `$recursion` も
    // `**` getter も持てない（runtime は接ぎ木前に raise / warn して捨てる）。宣言に依存する
    // 検査（getter の形・`$getAll` / `$setAll` の形）はそこで終わるが、宣言に依存しない検査
    // — `**` を解釈しない消費者（代入・`$resolve` / `$postUpdate` / `$trackDependency`・
    // `$listKeys` キー）— は runtime が必ず throw するので、そのまま掛ける
    // （`spec = null`・`undeclared = false` で呼べば宣言依存の分岐は自然に黙る）。
    let spec: RecursionSpec | null = null;
    let undeclared = false;
    let getterSuffixes: readonly string[] = [];
    if (block.mountPath !== null) {
      validateVolumeBlock(block.content, block.contentStart, block.mountPath, declaration, msgs, out);
    } else if (mounted) {
      validateMountedComponentBlock(block.content, block.contentStart, declaration, msgs, out);
    } else {
      spec = validateDeclaration(declaration, block.contentStart, msgs, out);
      // 「宣言が無い」と断定できるのは、オブジェクトリテラルが読めて、spread（`...tree` — 宣言を
      // 持ち込みうるが中身は読めない）が無く、そこに `$recursion` が無いときだけ
      undeclared = declaration === null
        && hasDefaultExportObject(block.content)
        && !hasTopLevelSpread(block.content);
      getterSuffixes = validateRecursiveGetters(block.content, block.contentStart, spec, undeclared, msgs, out);
    }
    validateListKeys(block.content, block.contentStart, msgs, out);
    validateApiCalls(block.content, block.contentStart, spec, getterSuffixes, undeclared, msgs, out);
    validateAssignments(block.content, block.contentStart, spec, getterSuffixes, msgs, out);
    }
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
 * ボリューム（`mount=`）の state。`$recursion` 宣言と `**` getter を接ぎ木前の raise と
 * 同じ条件で error にする（runtime: webComponent/volume.ts validateVolumeDeclarations）。
 */
function validateVolumeBlock(
  script: string,
  offset: number,
  mountPath: string,
  declaration: RecursionDeclarationInfo | null,
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): void {
  if (declaration !== null) {
    push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, offset + declaration.start, offset + declaration.end,
      msgs.recursionInVolume('$recursion', mountPath));
  }
  const seen = new Set<string>();
  for (const span of analyzeDeclarationSpans(script)) {
    if (!hasRecursionWildcard(span.name) || seen.has(span.name)) continue;
    seen.add(span.name);
    push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, offset + span.start, offset + span.end,
      msgs.recursionInVolume(`"${span.name}"`, mountPath));
  }
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
    // 値が文字列でないと**断定できる**ときだけ error。識別子参照（`REPEAT`）や `${}` 付きの
    // テンプレートはランタイムでは正当なので黙る（spec は組めないので以降の検証も黙る）。
    if (entry.repeatDefinitelyNotString) {
      push(out, code, offset + entry.valueStart, offset + entry.valueEnd,
        msgs.recursionRepeatNotString(entry.anchor));
    }
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
  undeclared: boolean,
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
      // 宣言が無い（または宣言そのものが壊れている・読めない）。ランタイムはこの getter を
      // レジストリに載せないので、具体パスを読んでも**黙って** undefined になる ＝
      // 落ちないので warning。壊れている場合は上で error を出し済み、読めない場合は断定しない。
      if (undeclared) {
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
    // 接尾辞が再帰の構造そのもの（`nodes.**.children` / `.children.*` / `.children.length` /
    // 多段なら `.branch`）なら、生成 getter が実データの子リストを全深さで影にする。
    // 書き側が同じ形を `recursion-structural-write` で拒否するのと対称（runtime は構築時に raise）。
    // 添字綴り（`get "nodes.**.children.0"()`）も畳んでから掛ける（書き側・runtime と同じ）
    if (structuralWriteTarget(spec, foldSuffixIndexes(suffix)) !== null) {
      push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, start, end,
        msgs.recursionGetterInvalid(span.name, 'structural', spec.recursiveAnchor));
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
  // 作者が手で書いた具体パス（`get "nodes.*.children.*.total"()` / `"nodes.*.total": 0`）が
  // 受理した `**` getter の展開形と同名でないか（runtime は構築時に raise する — 以前は
  // その深さを最初に読んだときにしか落ちず、木が 1 段深くなった瞬間にバインディングが落ちていた）
  if (spec !== null && suffixes.length > 0) {
    const reported = new Set<string>();
    for (const span of analyzeDeclarationSpans(script)) {
      if (hasRecursionWildcard(span.name) || reported.has(span.name)) continue;
      const suffix = concreteExpansionSuffix(spec, suffixes, span.name);
      if (suffix === null) continue;
      reported.add(span.name);
      push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, offset + span.start, offset + span.end,
        msgs.recursionConcreteCollision(span.name, spec.recursiveAnchor + suffix));
    }
  }
  return suffixes;
}

/**
 * マウントされたコンポーネント（`<wcs-state bind-component>`）の state は `$recursion` も
 * `**` getter も実行しない（runtime は `wcs/mount-dollar-declaration` で warn して捨てる —
 * `markerizeAccessorPath` は `*` しか探さないので `**` キーは登録されない）。黙って効かない
 * 形なので warning。
 */
function validateMountedComponentBlock(
  script: string,
  offset: number,
  declaration: RecursionDeclarationInfo | null,
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): void {
  if (declaration !== null) {
    push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, offset + declaration.start, offset + declaration.end,
      msgs.recursionInMountedComponent('$recursion'), 'warning');
  }
  const seen = new Set<string>();
  for (const span of analyzeDeclarationSpans(script)) {
    if (!hasRecursionWildcard(span.name) || seen.has(span.name)) continue;
    seen.add(span.name);
    push(out, WcsDiagnosticCode.RecursionDeclarationInvalid, offset + span.start, offset + span.end,
      msgs.recursionInMountedComponent(`"${span.name}"`), 'warning');
  }
}

/**
 * `$listKeys` のキーに `**` があれば error（runtime は宣言の処理で `wcs/recursion-unsupported`）。
 * 宣言の有無に関わらず落ちる形なので、`$recursion` のゲートは掛けない。
 */
function validateListKeys(
  script: string,
  offset: number,
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): void {
  for (const entry of analyzeListKeyEntries(script)) {
    if (!hasRecursionWildcard(entry.key)) continue;
    push(out, WcsDiagnosticCode.RecursionUnsupported, offset + entry.start, offset + entry.end,
      msgs.recursionUnsupported(entry.key, 'listKeys'));
  }
}

/**
 * パスを第 1 引数に取る API 呼び出しを検証する。
 *
 * 報告は 1 呼び出しにつき**最初の 1 件**だけ（同じ呼び出しに複数の理由を並べても
 * 直す順番が増えるだけ）。判定順はランタイムに合わせる — アンカー照合 → 添字の形 →
 * 値の形 → 構造への書き込み → 読み取り専用。
 *
 * `**` を含まない具体パスも、`$setAll` / 値付き `$resolve` なら見る — 宣言済み `**` getter の
 * 展開形（`nodes.*.children.*.total`）やその値の内側への書き込みは、`**` を経なくても
 * ランタイムが `setByAddress` の入口で `wcs/recursion-readonly` にする。
 */
function validateApiCalls(
  script: string,
  offset: number,
  spec: RecursionSpec | null,
  getterSuffixes: readonly string[],
  undeclared: boolean,
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
    if (path === null) continue;

    const leading = pathArg.length - pathArg.trimStart().length;
    const start = offset + parsed.starts[0] + leading;
    const end = offset + parsed.starts[0] + pathArg.trimEnd().length;

    if (!hasRecursionWildcard(path)) {
      // 具体パス綴りでの再帰 getter への書き込み（`$setAll(path, …)` / `$resolve(path, idx, value)`）
      const writes = api === '$setAll' || (api === '$resolve' && parsed.args.length >= 3);
      if (writes && spec !== null) {
        const owning = owningGetterSuffix(spec, getterSuffixes, path);
        if (owning !== null) {
          push(out, WcsDiagnosticCode.RecursionReadonly, start, end,
            msgs.recursionReadonly(`${api}("${path}")`, spec.recursiveAnchor + owning));
        }
      }
      continue;
    }

    if (api in UNSUPPORTED_API_SITE) {
      push(out, WcsDiagnosticCode.RecursionUnsupported, start, end,
        msgs.recursionUnsupported(path, UNSUPPORTED_API_SITE[api as keyof typeof UNSUPPORTED_API_SITE]));
      continue;
    }
    if (spec === null) {
      if (undeclared) {
        push(out, WcsDiagnosticCode.RecursionUnsupported, start, end, msgs.recursionUnsupported(path, 'undeclared'));
      }
      continue;
    }
    const suffix = splitRecursivePath(spec, path);
    if (suffix === null) {
      push(out, WcsDiagnosticCode.RecursionAnchor, start, end, msgs.recursionAnchorMismatch(path, spec.recursiveAnchor));
      continue;
    }
    if (api === '$getAll') {
      // 添字省略（＝評価深さへの束縛。`undefined` リテラルも同じ）と `[]`（＝全深さ）は正当。
      // 非空の接頭辞と、配列でないと断定できる値（`null` / 文字列・数値・真偽値・オブジェクト
      // リテラル）が不正 — runtime はどちらも `wcs/recursion-getall-form` で throw する。
      if (parsed.args.length > 1) {
        const indexesArg = parsed.args[1];
        const indexes = literalArrayLength(indexesArg);
        if (indexes !== null && indexes > 0) {
          push(out, WcsDiagnosticCode.RecursionGetAllForm, start, end, msgs.recursionGetAllForm(path, 'prefix'));
        } else if (indexes === null && isDefiniteNonArrayLiteral(indexesArg)) {
          push(out, WcsDiagnosticCode.RecursionGetAllForm, start, end, msgs.recursionGetAllForm(path, 'notArray'));
        }
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
  // 接尾辞の添字綴り（`nodes.**.children.0` / `.children.0.children` / `.children.0.total`）は
  // 畳んでから構造・読み取り専用の検査に掛ける（runtime の setAllRecursive と同じ）。
  // 接尾辞は `.` で始まる（先頭の空セグメントは区切りの都合）ので、区切りの後ろだけを畳む
  const checkedSuffix = foldSuffixIndexes(suffix);
  const structural = structuralWriteTarget(spec, checkedSuffix);
  if (structural !== null) {
    push(out, WcsDiagnosticCode.RecursionStructuralWrite, start, end,
      msgs.recursionStructuralWrite(path, structural, spec.repeatList));
    return;
  }
  const conflicting = conflictingGetterSuffix(spec, getterSuffixes, checkedSuffix);
  if (conflicting !== null) {
    push(out, WcsDiagnosticCode.RecursionReadonly, start, end,
      msgs.recursionReadonly(`$setAll("${path}")`, spec.recursiveAnchor + conflicting));
  }
}

/**
 * `this["<path>"] = …` の代入。`**` を含めば `wcs/recursion-unsupported`（宣言の有無に関わらず
 * runtime が throw する）。具体パス綴りで宣言済み `**` getter の展開形（またはその値の内側）へ
 * 書けば `wcs/recursion-readonly`。
 */
function validateAssignments(
  script: string,
  offset: number,
  spec: RecursionSpec | null,
  getterSuffixes: readonly string[],
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): void {
  // 文字列・テンプレートリテラルの**中身**まで潰した鏡像で探す（`'this["…"] = 1'` という
  // 文字列を代入と誤認しない）。鏡像は長さを保つので、パスは同じ位置を原文から切り出す
  // （キーの引用符は残るのでパターンは鏡像でも噛み合う — 中身は空白なので `[^"']+` に一致する）。
  // 形は semanticValidator と同じ部品（scriptPatterns）: `=` / 複合代入 / 後置 `++` `--` と前置 `++` `--`。
  const masked = maskCommentsAndStrings(script);
  const found: { pathStart: number; length: number }[] = [];
  for (const source of [BRACKET_ASSIGNMENT, PRE_BRACKET_INCDEC]) {
    const regex = new RegExp(source.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(masked)) !== null) {
      // 引用符の中身の位置（開き引用符の次）
      const pathStart = match.index + match[0].search(/["']/) + 1;
      found.push({ pathStart, length: match[1].length });
    }
  }
  found.sort((a, b) => a.pathStart - b.pathStart);
  let last = -1;
  for (const { pathStart, length } of found) {
    if (pathStart === last) continue;   // 同じ位置を 2 つの形が拾った（`++this["x"]++` は無いが保険）
    last = pathStart;
    const path = script.slice(pathStart, pathStart + length);
    const start = offset + pathStart;
    const end = start + path.length;
    if (hasRecursionWildcard(path)) {
      push(out, WcsDiagnosticCode.RecursionUnsupported, start, end, msgs.recursionUnsupported(path, 'assignment'));
      continue;
    }
    if (spec === null) continue;
    const owning = owningGetterSuffix(spec, getterSuffixes, path);
    if (owning !== null) {
      push(out, WcsDiagnosticCode.RecursionReadonly, start, end,
        msgs.recursionReadonly(`this["${path}"] = …`, spec.recursiveAnchor + owning));
    }
  }
}

/**
 * `$getAll` の添字が「配列ではない」と静的に断定できる形か（`null` / 文字列・数値・真偽値・
 * オブジェクトリテラル）。`undefined` は添字省略と同じ束縛形なので正当、識別子参照・
 * 呼び出し式は断定しない（黙る側に倒す）。
 */
function isDefiniteNonArrayLiteral(arg: string): boolean {
  const trimmed = arg.trim();
  return (
    trimmed === 'null' ||
    /^["'`]/.test(trimmed) ||
    /^-?\d/.test(trimmed) ||
    /^(?:true|false)$/.test(trimmed) ||
    trimmed.startsWith('{')
  );
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
