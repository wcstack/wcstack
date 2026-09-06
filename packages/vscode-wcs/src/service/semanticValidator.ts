/**
 * semanticValidator.ts
 *
 * `<wcs-state>` スクリプト内の**意味論的な**取り違えを検出する。既存の validator は
 * 「構文が正しいか」「そのパスが宣言されているか」までしか見ておらず、
 * **パス文字列から機械的に決まるはずの整合**は誰も検査していなかった。
 *
 *   wcs/index-arity              — `$getAll` / `$setAll` / `$resolve` の添字の本数 vs パス中の `*` の本数
 *   wcs/getter-cycle             — パス getter どうしの循環参照
 *   wcs/updated-callback-unbound — `$updatedCallback` が未バインドのパスを判定に使っている
 *
 * （もう 1 つの意味論検査 `wcs/wildcard-rank` は HTML 側の for スコープが要るため
 *   bindingValidator / templateSyntaxValidator に同居している。）
 *
 * ランタイム側の対応（同じ診断 code で raiseError する）:
 *   - 添字の超過は以前**黙って無視**され、取り違えたまま「もっともらしい値」を返していた
 *     （`packages/state/src/proxy/apis/{resolve,getAll}.ts`）
 *   - getter の循環はアドレススタック上限まで再帰してから落ちる
 *     （`packages/state/src/proxy/StateHandler.ts`）
 *
 * 精度方針は既存 validator と同じ**軽量正規表現 + 断定できるときだけ報告**。
 * 添字がリテラル配列でない・パスが文字列リテラルでない場合は黙る（偽陽性ゼロ優先）。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { analyzeCallableBodies, analyzeStatePaths } from './stateAnalyzer.js';
import { countWildcardSegments, getInnermostForPath } from './forContext.js';
import { buildReferenceIndex } from '../core/index/referenceIndex.js';

/** ランタイム予約キー（@wcstack/state の define.ts が正本）。 */
const STATE_UPDATED_CALLBACK = '$updatedCallback';

/** `this.$getAll(` / `this.$setAll(` / `this.$resolve(` の呼び出し開始。`?.` 経由も拾う。 */
const API_CALL = /\.\s*\$(getAll|setAll|resolve)\s*\(/g;

/** 文字列リテラル 1 個ぶん（エスケープ対応）。テンプレートリテラルは対象外。 */
const STRING_LITERAL = /^\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*$/;

interface ICallArgs {
  /** 実引数の生テキスト（トップレベルのカンマで分割済み） */
  readonly args: readonly string[];
  /** 各実引数の開始オフセット（source 内の絶対位置） */
  readonly starts: readonly number[];
  /** 閉じ括弧の次の位置。走査継続に使う */
  readonly end: number;
}

/**
 * `open`（`(` の次の位置）から実引数をトップレベルのカンマで切り出す。
 * 括弧・角括弧・波括弧の入れ子と、文字列・テンプレート・正規表現もどきを飛ばす。
 * 閉じ括弧が見つからなければ null（不完全な編集中テキスト）。
 */
function splitCallArgs(source: string, open: number): ICallArgs | null {
  const args: string[] = [];
  const starts: number[] = [];
  let depth = 0;
  let argStart = open;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; i++; continue; }
    if (ch === ')' && depth === 0) {
      args.push(source.slice(argStart, i));
      starts.push(argStart);
      return { args, starts, end: i + 1 };
    }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; i++; continue; }
    if (ch === ',' && depth === 0) {
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

/** 実引数が単純な文字列リテラルならその中身を返す（それ以外は null＝判定しない）。 */
function literalString(arg: string): string | null {
  const match = STRING_LITERAL.exec(arg);
  return match === null ? null : match[2];
}

/**
 * 実引数が配列リテラルなら要素数を返す（それ以外・スプレッド混じりは null＝判定しない）。
 * `[]` は 0、末尾カンマは数えない。
 */
function literalArrayLength(arg: string): number | null {
  const trimmed = arg.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.trim().length === 0) return 0;
  // スプレッドは長さが静的に決まらない
  if (/(^|[^.])\.\.\./.test(inner)) return null;
  const parts = splitCallArgs(`${inner})`, 0);
  if (parts === null) return null;
  return parts.args.filter((part) => part.trim().length > 0).length;
}

/**
 * `$getAll` / `$setAll` / `$resolve` の添字の本数を検査する。
 *
 * `$resolve` は**厳密一致**（不足はランタイムが元から throw、超過は黙って無視されていた）、
 * `$getAll` / `$setAll` は**上限**（不足は「残りの階層を全展開」という正当な意味を持つ接頭辞）。
 */
function validateIndexArity(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  API_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
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
    const requirement = api === '$resolve' ? 'exact' as const : 'atMost' as const;
    const mismatched = requirement === 'exact' ? actual !== wildcardCount : actual > wildcardCount;
    if (!mismatched) continue;
    const argText = parsed.args[1];
    const leading = argText.length - argText.trimStart().length;
    out.push({
      code: WcsDiagnosticCode.IndexArity,
      start: scriptStart + parsed.starts[1] + leading,
      end: scriptStart + parsed.starts[1] + argText.trimEnd().length,
      message: msgs.indexArity(api, path, requirement, wildcardCount, actual),
      severity: 'warning',
    });
  }
  return out;
}

/** getter 本体から読んでいる state パスを拾う（`this["a.b"]` / `this.a` / API の第1引数）。 */
const READ_BRACKET = /\bthis\s*\??\.\s*\[\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*\]|\bthis\s*\??\[\s*(["'])((?:\\.|(?!\3)[^\\])*)\3\s*\]/g;
const READ_DOT = /\bthis\s*\??\.\s*([A-Za-z_]\w*)/g;
const READ_API = /\bthis\s*\??\.\s*\$(?:getAll|resolve)\s*\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;

function collectReadPaths(body: string): Set<string> {
  const paths = new Set<string>();
  for (const [regex, groups] of [
    [READ_BRACKET, [2, 4]],
    [READ_API, [2]],
    [READ_DOT, [1]],
  ] as const) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      for (const group of groups) {
        const value = match[group];
        // `$` 始まりは API 名前空間（`$getAll` 等）なので読みパスではない
        if (value !== undefined && value.length > 0 && !value.startsWith('$')) {
          paths.add(value);
        }
      }
    }
  }
  return paths;
}

/**
 * パス getter の循環参照を検出する。
 *
 * 辺は「getter → その本体が読んでいるパスのうち、**それ自身も getter として宣言されて
 * いるもの**」に限る。データパスへの読みは循環し得ないので辺にしない — これで
 * 「親パスを読む getter」（`get "cart.total"() { return this.cart… }`）のような
 * 正常形を巻き込まない。
 */
function validateGetterCycles(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const getters = analyzeCallableBodies(script).filter((entry) => entry.kind === 'getter');
  if (getters.length === 0) return [];
  const declared = new Set(getters.map((getter) => getter.name));
  const edges = new Map<string, string[]>();
  for (const getter of getters) {
    const targets: string[] = [];
    for (const read of collectReadPaths(getter.body)) {
      if (declared.has(read)) targets.push(read);
    }
    edges.set(getter.name, targets);
  }

  // DFS（gray = 現在の経路、black = 循環なしと確定）。sidecar の $ref 検出と同型。
  const gray = new Set<string>();
  const black = new Set<string>();
  const stack: string[] = [];
  const cyclesByEntry = new Map<string, string>();

  const visit = (name: string): void => {
    if (black.has(name)) return;
    if (gray.has(name)) {
      const from = stack.indexOf(name);
      const cycle = stack.slice(from).concat(name).join(' -> ');
      // 循環の当事者すべてに同じ説明を付ける（どこを直しても良いので全員に出す）
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

  const out: WcsDiagnostic[] = [];
  for (const getter of getters) {
    const cycle = cyclesByEntry.get(getter.name);
    if (cycle === undefined) continue;
    out.push({
      code: WcsDiagnosticCode.GetterCycle,
      start: scriptStart + getter.start,
      end: scriptStart + getter.end,
      message: msgs.getterCycle(cycle),
      severity: 'warning',
    });
  }
  return out;
}

/**
 * 行コメント / ブロックコメントを同じ長さの空白へ潰す（文字列リテラルは残す）。
 * 文字列の中の `//` をコメント開始と誤認しないよう、文字列も同時に追跡する。
 */
function blankComments(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { out[i] = ' '; i++; }
      if (i < source.length) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * `$updatedCallback` の本体で、**パス判定に使われている**文字列リテラルを位置付きで返す。
 *
 * 対象の形（実測された事故の形 `if (!paths.includes("…")) return;` を含む）:
 *   `.includes("X")` / `.indexOf("X")` / `=== "X"` / `!== "X"`
 * `this["X"]` のような**読み取り**は対象外 — 読みはバインドの有無に関係なく成立するので、
 * 未バインドでも死んでいない。
 */
const PATH_TEST_LITERAL = /(?:\.\s*(?:includes|indexOf)\s*\(\s*|[!=]==\s*)(["'])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * `$updatedCallback` が「どのバインディングにも現れないパス」を判定に使っていないか。
 *
 * `$updatedCallback` は **binding 駆動**で、live binding が適用された path しか報告しない。
 * したがって「表示用の要素が購読の実体になる」＝ その要素を消すとプログラムの意味論が
 * 変わる、という事故が起きる（`examples/state-intersect-scroll` の README に記録された
 * 実例: 表示専用の `<b data-wcs="textContent: $streamStatus.pageResult">` を消したら
 * フィードの commit が止まった）。ここはその形の静的検出。
 *
 * 判定は「そのパスが state の宣言に実在し、かつこのドキュメントのどこにもバインドが無い」
 * ときのみ。どちらかが分からなければ黙る（偽陽性ゼロ優先）。
 */
function validateUpdatedCallbackDemand(
  html: string,
  stateTagName: string,
  bindAttrName: string,
  locale?: string,
): WcsDiagnostic[] {
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  if (blocks.length === 0) return [];
  const hasCallback = blocks.some((block) => block.content.includes(STATE_UPDATED_CALLBACK));
  if (!hasCallback) return [];

  const msgs = getMessages(locale);
  const boundPaths = collectBoundPaths(html, stateTagName, bindAttrName);
  const out: WcsDiagnostic[] = [];

  for (const block of blocks) {
    const callback = analyzeCallableBodies(block.content)
      .find((entry) => entry.name === STATE_UPDATED_CALLBACK && entry.kind === 'method');
    if (callback === undefined) continue;
    // ボリューム（mount=）の $updatedCallback は runtime が**相対配送**で実行する
    //（自分の接頭辞配下の更新が相対パスで届く）。バインド側は接頭辞付き絶対パスなので
    // この突合には接頭辞補正が要る — 未対応のため誤報しない側に倒してスキップ
    if (block.mountPath !== null) continue;
    const declared = new Set(analyzeStatePaths(block.content).map((p) => p.path));
    const bound = boundPaths;
    const body = blankComments(callback.body);
    PATH_TEST_LITERAL.lastIndex = 0;
    let match: RegExpExecArray | null;
    const reported = new Set<string>();
    while ((match = PATH_TEST_LITERAL.exec(body)) !== null) {
      const path = match[2];
      if (path.length === 0 || !declared.has(path) || bound.has(path)) continue;
      if (reported.has(path)) continue;
      reported.add(path);
      // レンジはリテラル本体（引用符の内側）
      const quoteAt = match.index + match[0].length - path.length - 1;
      out.push({
        code: WcsDiagnosticCode.UpdatedCallbackUnbound,
        start: block.contentStart + callback.bodyStart + quoteAt,
        end: block.contentStart + callback.bodyStart + quoteAt + path.length,
        message: msgs.updatedCallbackUnbound(path),
        severity: 'warning',
      });
    }
  }
  return out;
}

/**
 * このドキュメントでバインドされている state パスを集める（v2: 1 root 1 ツリー）。
 *
 * 正本パーサ経由の参照インデックスを使う。for 短縮パス（`.label`）は
 * インデックスに**字句どおり**載る仕様なので、ここで囲みテンプレートを見て
 * 展開してから登録する（ランタイム: structural/expandShorthandPaths.ts）。
 */
function collectBoundPaths(
  html: string,
  stateTagName: string,
  bindAttrName: string,
): Set<string> {
  const bound = new Set<string>();
  const index = buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName });
  for (const occurrence of index.occurrences) {
    bound.add(occurrence.path);
    if (!occurrence.path.startsWith('.')) continue;
    const forPath = getInnermostForPath(html, occurrence.pathRange.start, bindAttrName);
    if (forPath === null || forPath.startsWith('.')) continue;
    bound.add(
      occurrence.path === '.' ? `${forPath}.*` : `${forPath}.*.${occurrence.path.slice(1)}`,
    );
  }
  return bound;
}

/**
 * HTML 内の `<wcs-state>` スクリプトから意味論的な取り違えを検出する。
 */
export function validateSemantics(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  bindAttrName: string = 'data-wcs',
): WcsDiagnostic[] {
  const out: WcsDiagnostic[] = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    out.push(...validateIndexArity(block.content, block.contentStart, locale));
    out.push(...validateGetterCycles(block.content, block.contentStart, locale));
  }
  out.push(...validateUpdatedCallbackDemand(html, stateTagName, bindAttrName, locale));
  return out;
}
