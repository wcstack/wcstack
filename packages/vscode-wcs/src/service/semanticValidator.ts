/**
 * semanticValidator.ts
 *
 * `<wcs-state>` スクリプト内の**意味論的な**取り違えを検出する。既存の validator は
 * 「構文が正しいか」「そのパスが宣言されているか」までしか見ておらず、
 * **パス文字列から機械的に決まるはずの整合**は誰も検査していなかった。
 *
 *   wcs/index-arity              — `$getAll` / `$setAll` / `$resolve` の添字の本数 vs パス中の `*` の本数
 *   wcs/getter-cycle             — パス getter どうしの循環参照
 *   wcs/getter-untracked-read    — getter の中の `this.form.name`（追跡されるのは `form` だけ）
 *   wcs/updated-callback-unbound — `$renderedCallback` が未バインドのパスを判定に使っている
 *   wcs/index-param-range        — `this.$0` / `this.$129`（ループの添字の範囲の外。読んだ時点で throw）
 *   wcs/input-nested-write       — `<wcs-storage>` の `value: cart` と `cart.0.quantity` への書き込み（保存されない）
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

import { findIgnoredRanges, parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { findAllBindAttributes, writesBack } from './bindingValidator.js';
import { parseBindTextWithPositions } from '../core/parser/positionalParser.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { analyzeCallableBodies, analyzeDeclarationSpans, analyzeOnHandlerSources, analyzeStatePaths, analyzeWatchHandlerSources, hasDefaultExportObject, isObjectLiteral, maskCommentsAndStrings } from './stateAnalyzer.js';
import { suggestion } from './suggestion.js';
import { collectGetterReads, collectThisMemberRefs, collectThisMemberRefsInValue, findInPlaceChanges, findLocationRead, findOwnThis, type MemberNameFilter, type ThisMemberRef } from './scriptAst.js';
import type { WatchHandlerSource } from './stateAnalyzer.js';
import { isOutOfRangeIndexRead, MAX_INDEX_PARAM } from './indexPath.js';
import { countWildcardSegments, getResolvedForListPath, getRowShorthandForPath } from './forContext.js';
import { buildReferenceIndex } from '../core/index/referenceIndex.js';
import { findBuiltinTagOccurrences } from './ioNodeValidator.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { ASSIGN_TAIL, PRE_INCDEC, ROOT_BRACKET } from './scriptPatterns.js';
import { blankComments, literalArrayLength, literalString, splitCallArgs } from './scriptCallArgs.js';
import { hasRecursionWildcard } from './recursionPaths.js';
import { REMOVED_DECLARATION_KEYS, removedApiReplacement, removedDeclarationReplacement } from './removedNames.js';

/** ランタイム予約キー（@wcstack/state の manifest の reservedLifecycle）。4.0 は旧名 `$updatedCallback` を外した */
const STATE_UPDATED_CALLBACKS: ReadonlySet<string> = new Set(['$renderedCallback']);

/**
 * 4.0 で外れた旧名 → 正式名（@wcstack/state 3.2 で改名・4.0 で外した。要件 D4・B12）。API はメソッド呼び出し、
 * 宣言は state のキー。表は removedNames.ts（4.0 の正本との整合は `__tests__/nameAliases.drift.test.ts`）。
 */
const OLD_API_CALL = /\.\s*(\$trackDependency|\$untrackDependency)\b/g;
/**
 * 4.0 で外れた宣言キーを `this.` 越しに**読む**。4.0 の state にそのキーは無いので、`this.$streams` は
 * 例外も出さずに `undefined` になる（宣言していれば、読み込み時に `wcs/declaration-alias` で止まる）。
 * code（`wcs/declaration-alias-read`）を宣言側と分ける理由。
 *
 * これは AST（`collectThisMemberRefs`）が読めないときのフォールバック。走査は
 * `maskCommentsAndStrings` の鏡像に対して行うのでコメント・文字列リテラルの中には
 * 当たらないが、正規表現なので構造は見えず他オブジェクト（`other.$streams`）には当たりうる —
 * だからフォールバック経路は info に留め、warning へは上げない。
 */
const OLD_DECLARATION_MEMBER = /\.\s*(\$streams|\$updatedCallback)\b/g;
/** メンバー参照を探す旧名の集合（AST 経路。値は `REMOVED_DECLARATION_KEYS` の正式名）。 */
const OLD_DECLARATION_MEMBER_NAMES: ReadonlySet<string> = new Set(Object.keys(REMOVED_DECLARATION_KEYS));
/**
 * 宣言オブジェクトが静的に読めないとき（class 構文の state — ボリューム（`mount=`）の通常形）の
 * フォールバック。オブジェクトリテラルのキー（`$streams:`）・メソッド（`$updatedCallback(…) {}`）に
 * 加えて class フィールド（`$streams = …`。`==` / `===` は除く）も見る。
 * 走査は鏡像（コメント・文字列リテラルの中身を空白化）に対して行うので例示には当たらないが、
 * 構造は見えない（state 以外のオブジェクトのキーにも当たりうる）ので severity は warning に留める —
 * 「読めないから黙る」より「移行漏れを取りこぼさない」側に倒す（この診断の目的）。
 */
const OLD_DECLARATION_KEY = /(^|[{,;\s])(\$streams|\$updatedCallback)(?=\s*(?:[:(]|=(?!=)))/g;

/**
 * 旧名の宣言キーの**メンバー参照**（`this.$streams`）を AST で集める。script 相対オフセット。
 *
 * 断定できないときは null を返し、呼び出し側が正規表現へ落とす:
 *   - `export default { … }` が読めない（class 構文の state など）
 *   - 走査対象の本体のどれか 1 つでも acorn がパースできない
 *
 * **走査対象 ＝ ランタイムが `this` を state に束縛して呼ぶ関数だけ**:
 *   - トップレベルの getter / メソッド（`analyzeCallableBodies`）
 *   - `$watch` のハンドラ（`watch/watchRuntime.ts` の `entry.handler.call(state, …)`、
 *     ボリュームは `webComponent/volume.ts` の chroot）
 *
 * **宣言面のうち** `this` を再束縛するのは `$watch` だけ（下の対象外一覧を参照）。ただし
 * 「state 全体で `this` が束縛される経路が `$watch` だけ」ではない — イベント束縛も
 * `event/handler.ts` で `Reflect.apply(handler, state, …)` する（下の既知の限界）。
 *
 * 他の**宣言面**は `this` を束縛しないので**意図的に対象外**（足すと誤検出になる）:
 *   `$scan` の `fold`（`scan/scanRuntime.ts` の `fold(acc, cur, …)`）・`$stream` の `source`
 *   （`stream/consumeSource.ts` の `source(args, signal)`）・`$on` のハンドラ
 *   （`Token.ts` の `fn(...args)` — `event/processOnDeclaration.ts` が「`this` 束縛は行わず
 *   引数で state を渡す」と明記しており、ESM は strict なので `this` は undefined。そこでの
 *   旧名読みは「黙って undefined」ではなく TypeError なので、この診断の文言が当たらない）・
 *   `$listKeys` のキー関数（`list/mergeKeyedList.ts` の `spec(row)`）。データプロパティに
 *   置いたアロー関数（`probe: () => this.$streams`）も、そこの `this` はモジュールスコープ
 *   （ESM では undefined）なので対象外。
 *
 * **既知の限界**（次に読む人が「直った」と誤解しないように）:
 *   - `$watch` の中の入れ子（`count: { … }` のようなさらに深い構造）は追わない。
 *   - `$watch` の値が識別子参照（`count: onCount`）だと本体が静的に読めないので黙る。
 *   - `data-wcs="onclick: <state パス>"` が解決した関数も `this` が state になる
 *     （`event/handler.ts` の `Reflect.apply(handler, state, …)`）。通常はトップレベルの
 *     メソッドなので走査済みだが、入れ子のパス（`onclick: handlers.click`）は追わない。
 *
 * どれも「断定できないときは黙る」側の割り切りで、正規表現フォールバックは走らない
 * （`astReads` は非 null で返る）。
 */
function collectDeclarationAliasReads(script: string): { name: string; start: number }[] | null {
  return collectStateThisReads(script, OLD_DECLARATION_MEMBER_NAMES);
}

/**
 * ランタイムが `this` を state に束縛して呼ぶ関数（トップレベルの getter / メソッドと `$watch` のハンドラ）から、
 * `names` に当たる `this.<name>` を集める（script 相対オフセット・出現順）。範囲と既知の限界は
 * `collectDeclarationAliasReads` に書いたとおり。断定できないとき（`export default { … }` が読めない・
 * 本体のどれかがパースできない）は null。
 */
function collectStateThisReads(script: string, names: MemberNameFilter): { name: string; start: number }[] | null {
  if (!hasDefaultExportObject(script)) return null;
  const out: { name: string; start: number }[] = [];
  const take = (refs: ThisMemberRef[] | null, base: number): boolean => {
    if (refs === null) return false;
    for (const ref of refs) out.push({ name: ref.name, start: base + ref.start });
    return true;
  };
  for (const callable of analyzeCallableBodies(script)) {
    if (!take(collectThisMemberRefs(callable.body, names), callable.bodyStart)) return null;
  }
  for (const handler of analyzeWatchHandlerSources(script)) {
    const refs = handler.kind === 'body'
      ? collectThisMemberRefs(handler.text, names)
      : collectThisMemberRefsInValue(handler.text, names);
    if (!take(refs, handler.start)) return null;
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * 4.0 で外れた旧名（@wcstack/state 3.2 で改名・4.0 で外した）を 3 つの経路で報告する。
 * どれもランタイムが受け付けない形なので、正式名を提案する。
 *
 *   - **API の読み・呼び出し**（`this.$trackDependency(`）→ `wcs/name-alias`（error）。4.0 は読んだ
 *     時点で同じ code（#1701）で throw する。
 *   - **宣言キーの読み出し**（`this.$streams`）→ `wcs/declaration-alias-read`。4.0 の state にその
 *     キーは無いので黙って `undefined` になる。AST（`collectThisMemberRefs`）で断定できたら warning、
 *     読めない形は正規表現へ落として info。
 *   - **宣言キーそのもの**（`$streams: …`）→ `wcs/declaration-alias`。4.0 は読み込み時に同じ code
 *     （#1601）で throw する（正式名と両方書いても同じ）。ボリューム（`mount=`）は読み込みを通らず、
 *     接ぎ木を拒んで console.error で報告する（文面を分ける。どちらも state は動かないので error）。
 *
 * 宣言キーの走査は 2 経路のハイブリッド:
 *
 *   1. 宣言側の正本（`analyzeDeclarationSpans`）が読めたとき — 正確なスパン・文字列リテラルの
 *      誤検出なし・引用符付きキー（`"$streams": { … }`）も拾える。error で報告する。
 *   2. 読めなかったとき（class 構文の state — ボリュームの通常形） — `OLD_DECLARATION_KEY` で
 *      拾って warning に留める。正規表現は誤検出しうるので error にしない（読み出し側の warning /
 *      info の切り替えも同じ方針 — 誤検出しうる経路の severity を 1 段下げる）。
 */
function validateNameAliases(script: string, scriptStart: number, locale?: string, mountPath: string | null = null): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const scan = maskCommentsAndStrings(script);
  const out: WcsDiagnostic[] = [];
  const pushDeclaration = (name: string, start: number, end: number, severity: 'error' | 'warning'): void => {
    const canonical = removedDeclarationReplacement(name);
    if (canonical === null) return;
    out.push({
      code: WcsDiagnosticCode.DeclarationAlias,
      start: scriptStart + start,
      end: scriptStart + end,
      // ボリュームは読み込み（#1601）を通らない — ランタイムは接ぎ木を拒んで console.error で報告する
      message: mountPath === null ? msgs.declarationAlias(name, canonical) : msgs.declarationAliasInVolume(name, canonical, mountPath),
      severity,
    });
  };
  /** 旧名の宣言キーの読み出し（`wcs/declaration-alias-read`）。severity は検出経路で決まる。 */
  const pushRead = (name: string, offset: number, severity: 'warning' | 'info'): void => {
    const canonical = removedDeclarationReplacement(name);
    if (canonical === null) return;
    out.push({
      code: WcsDiagnosticCode.DeclarationAliasRead,
      start: scriptStart + offset,
      end: scriptStart + offset + name.length,
      message: msgs.declarationAliasRead(name, canonical),
      severity,
    });
  };

  OLD_API_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OLD_API_CALL.exec(scan)) !== null) {
    const written = match[1];
    const canonical = removedApiReplacement(written);
    if (canonical === null) continue;
    const offset = match.index + match[0].length - written.length;
    out.push({
      code: WcsDiagnosticCode.NameAlias,
      start: scriptStart + offset,
      end: scriptStart + offset + written.length,
      message: msgs.nameAlias(written, canonical),
      severity: 'error',
    });
  }

  // 旧名の宣言キーの**読み出し**。AST で `this.<name>` を断定できたら warning
  // （黙って undefined になる ＝ `wcs/on-prefixed-member` などと同じ層）。
  // 読めない形（class 構文など）だけ正規表現へ落として info に留める。
  const astReads = collectDeclarationAliasReads(script);
  if (astReads !== null) {
    for (const read of astReads) pushRead(read.name, read.start, 'warning');
  } else {
    OLD_DECLARATION_MEMBER.lastIndex = 0;
    while ((match = OLD_DECLARATION_MEMBER.exec(scan)) !== null) {
      const written = match[1];
      pushRead(written, match.index + match[0].length - written.length, 'info');
    }
  }

  const spans = analyzeDeclarationSpans(script);
  if (spans.length === 0) {
    // 経路 2: 宣言が静的に読めない（class 構文など）。warning に留める
    OLD_DECLARATION_KEY.lastIndex = 0;
    while ((match = OLD_DECLARATION_KEY.exec(scan)) !== null) {
      const at = match.index + match[1].length;
      pushDeclaration(match[2], at, at + match[2].length, 'warning');
    }
    return out;
  }

  // 経路 1: 宣言側の正本が読めた
  for (const span of spans) pushDeclaration(span.name, span.start, span.end, 'error');
  return out;
}

/** `this.$getAll(` / `this.$setAll(` / `this.$resolve(` の呼び出し開始。`?.` 経由も拾う。 */
const API_CALL = /\.\s*\$(getAll|setAll|resolve)\s*\(/g;

/**
 * `$getAll` / `$setAll` / `$resolve` の添字の本数を検査する。
 *
 * `$resolve` は**厳密一致**（不足はランタイムが元から throw、超過は黙って無視されていた）、
 * `$getAll` / `$setAll` は**上限**（不足は「残りの階層を全展開」という正当な意味を持つ接頭辞）。
 * severity は error: 4.0 のランタイムは呼んだ所で #901 / #902 として throw する。リテラルのパスと
 * リテラルの配列だけを見るので、検出は確実。
 */
function validateIndexArity(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  // 呼び出しの**検出**はコメント・文字列リテラルを潰した鏡像で行う（注意書きに書いた
  // 例示を実コードと取り違えない）。実引数は**原文**から読む — 鏡像では文字列の中身が
  // 空白になっていてパスが消える。鏡像は長さを保つのでオフセットは共通。
  const scan = maskCommentsAndStrings(script);
  API_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = API_CALL.exec(scan)) !== null) {
    const api = `$${match[1]}`;
    const parsed = splitCallArgs(script, match.index + match[0].length);
    if (parsed === null) continue;
    API_CALL.lastIndex = parsed.end;
    if (parsed.args.length < 2) continue;
    const path = literalString(parsed.args[0]);
    if (path === null) continue;
    // `**` は固定本数の `*` ではない（深さの族を表す）。添字の本数はここでは決まらず、
    // 形の判定は recursionValidator が `wcs/recursion-getall-form` /
    // `wcs/recursion-setall-form` として担う（ランタイムも `**` を先に分岐する）。
    if (hasRecursionWildcard(path)) continue;
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
      severity: 'error',
    });
  }
  return out;
}

/**
 * パス getter の循環参照を検出する。
 *
 * 辺は「getter → その本体が読んでいるパスのうち、**それ自身も getter として宣言されて
 * いるもの**」に限る。データパスへの読みは循環し得ないので辺にしない — これで
 * 「親パスを読む getter」（`get "cart.total"() { return this.cart… }`）のような
 * 正常形を巻き込まない。
 *
 * 読み取りの収集は AST（scriptAst.ts）。分割代入・`this` エイリアス・`$dependOn`（旧名
 * `$trackDependency`）を辺にし、`$untracked`（旧名 `$untrackDependency`）の中・
 * 入れ子 function の中・代入左辺は辺にしない。
 * setter は辺の起点にしない（ランタイムは setter 内の読み取りを依存に登録しない —
 * 依存追跡の境界 規則 2）。パースできない本体は辺なし（断定できないときは黙る）。
 *
 * **再帰 getter（`**`）の扱い**（docs/state-recursive-path-impl-plan.md §7）:
 * 辺は「宣言名との**完全一致**」だけなので、深さが進む読み
 * （`get "nodes.**.total"` の中の `$getAll("nodes.**.children.*.total")`）は辺にならず、
 * 「文字列上の自己参照」を理由に循環扱いすることはない。これは偶然ではなく、
 * 再帰の**深さ差**を辺の重みと見たときに正しい:
 *
 *   - 深さ差 0 の辺（`nodes.**.total` → `nodes.**.total` / `nodes.**.a` ↔ `nodes.**.b`）
 *     だけが同じアドレスへ戻る ＝ 本物の循環。宣言名が一致するのでいまの規則で辺になる。
 *   - 深さ差 > 0 の辺（`… → nodes.**.children.*.x`）は必ず木を下る。葉で止まるので
 *     どんな閉路にも参加しない。宣言名と一致しないのでいまの規則で辺にならない。
 *
 * したがって `**` の展開形（`nodes.*.children.*.total` → `nodes.**.total`）へ**畳んでから**
 * 辺を張ってはならない。畳むと深さ差 > 0 の辺が自己ループに化け、正常な再帰集計が
 * すべて `wcs/getter-cycle` になる。パス存在判定（recursionPaths.matchesRecursion）は
 * 畳むが、依存グラフはここで畳まない — この非対称が要点。
 *
 * severity は error: 4.0 のランタイムは評価の時点で #701 として throw し、その getter を読む束縛はすべて
 * 失敗する（3.x はアドレススタックの上限まで再帰してから落ちた）。限界: 辺は条件分岐を見ないので、
 * 排他な条件の裏にあって実行時には決して回らない循環も報告する（まれ）。
 */
function validateGetterCycles(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const getters = analyzeCallableBodies(script).filter((entry) => entry.kind === 'getter');
  if (getters.length === 0) return [];
  const declared = new Set(getters.map((getter) => getter.name));
  const edges = new Map<string, string[]>();
  for (const getter of getters) {
    if (getter.accessor === 'set') continue;
    const targets = new Set<string>();
    for (const read of collectGetterReads(getter.body) ?? []) {
      if (declared.has(read.path)) targets.add(read.path);
    }
    edges.set(getter.name, [...targets]);
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
    // 報告は get 側の名前スパンだけ（set 側は辺を持たないので同じ循環を二重に出さない）
    if (getter.accessor === 'set') continue;
    const cycle = cyclesByEntry.get(getter.name);
    if (cycle === undefined) continue;
    out.push({
      code: WcsDiagnosticCode.GetterCycle,
      start: scriptStart + getter.start,
      end: scriptStart + getter.end,
      message: msgs.getterCycle(cycle),
      severity: 'error',
    });
  }
  return out;
}

/**
 * getter の中で `this.form.name` のように、`this` を通したパス読み取りの先で素の
 * プロパティアクセスを続けている形を検出する（依存追跡の境界 規則 1 の静的検出）。
 *
 * 追跡されるのは `form` だけなので、`form.name` への書き込み（`this["form.name"] = x` や
 * `<input data-wcs="value: form.name">`）ではこの getter は再評価されない。症状は
 * 「値が更新されない・エラーは出ない」で、ランタイムは素のアクセスと区別できない。
 *
 * 報告条件（すべて満たすとき。docs/getter-dependency-ast-impl-plan.md Phase 2 / D8）:
 *   - get アクセサ本体の member / destructure 読みで、chain が断定できる（動的添字なし）
 *   - ルートが宣言済みデータパスで、初期値がオブジェクトリテラル（配列は対象外 — D7）
 *   - 複合代入・増減の対象（`this.form.age++`）ではない — それは `wcs/nested-assign` の担当（二重報告なし）
 *   - 呼び出しの callee なら末尾 1 段を落とし、残りがルートだけなら黙る
 *     （`this.form.validate()` は報告しない・`this.form.name.trim()` は `form.name` を報告する）
 *   - そのルートへの**入れ子書き込みの証拠**がドキュメントにある（collectNestedWriteRoots）。
 *     ルートが丸ごと置換されるだけの設計（router の `typedParams: routeParams` 出力・
 *     `$streams` の fold 値）では getter は壊れないので、証拠なしでは黙る（偽陽性ゼロ優先）
 * severity は warning: 証拠があっても、そのルートを別経路で丸ごと置換していれば壊れない。
 * ただし読んだパス（かその上の段 — 追跡されるパスより下）を**ページの束縛**が書くとき
 * （collectBindingWrites: 要素の spread・書き戻す束縛・要素の出力）は error: 束縛の書き込みのたびに
 * getter は古いままで、ルートを別に置き換えても束縛の書き込みは getter に届かない。`<wcs-fetch data-wcs="...: monthFetch">`
 * と `this.monthFetch.value` を読む getter で、ページは「読み込み中…」のまま止まった（継ぎ目アプリ family-ledger —
 * warning だったので、スキルの `--errors-only` の関門を通った）。4.3 からの「lint が断定できるものは error」。
 */
function validateGetterUntrackedReads(
  script: string,
  scriptStart: number,
  mountPath: string | null,
  nestedWriteRoots: () => ReadonlyMap<string, string>,
  bindingWrites: () => readonly BindingWrite[],
  locale?: string,
): WcsDiagnostic[] {
  const getters = analyzeCallableBodies(script).filter((entry) => entry.kind === 'getter' && entry.accessor === 'get');
  if (getters.length === 0) return [];
  const objectRoots = new Set<string>();
  for (const candidate of analyzeStatePaths(script)) {
    if (candidate.kind === 'data' && candidate.rawInitial !== undefined && isObjectLiteral(candidate.rawInitial)) {
      objectRoots.add(candidate.path);
    }
  }
  if (objectRoots.size === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const getter of getters) {
    for (const read of collectGetterReads(getter.body) ?? []) {
      if ((read.form !== 'member' && read.form !== 'destructure') || read.chain === null) continue;
      // `this.form.age++` は読み兼書き — 書き込み側として wcs/nested-assign（error）が既に止める
      if (read.written) continue;
      const segments = read.callee ? read.chain.slice(0, -1) : read.chain;
      if (segments.length < 2 || !objectRoots.has(segments[0])) continue;
      // the page's paths are the tree's: a volume's script reads below its mount path
      const prefix = mountPath === null ? [] : mountPath.split('.');
      const write = boundWriteOf([...prefix, ...segments], prefix.length + read.path.split('.').length, bindingWrites());
      if (write === undefined && !nestedWriteRoots().has([...prefix, segments[0]].join('.'))) continue;
      const sp = segments.join('.');
      out.push({
        code: WcsDiagnosticCode.GetterUntrackedRead,
        start: scriptStart + getter.bodyStart + read.start,
        end: scriptStart + getter.bodyStart + read.end,
        message: write === undefined
          ? msgs.getterUntrackedRead(segments[0], sp)
          : msgs.getterUntrackedReadBound(segments[0], sp, write.binding, write.tag, write.path),
        severity: write === undefined ? 'warning' : 'error',
      });
    }
  }
  return out;
}

/**
 * A path a binding on the page writes by path (`wcs/getter-untracked-read` is an error when a getter reads it, or
 * below it, through a plain property access). `path` may hold `*` (a row's relative path in a `for:`).
 */
interface BindingWrite {
  readonly path: string;
  /** The binding as written (`...: monthFetch`, `value: form.name`). */
  readonly binding: string;
  readonly tag: string;
}

/**
 * The write in `writes` that sets the read `segments` or one of its ancestors below the tracked path (the first
 * `tracked` segments). A `*` in a written path stands for a numeric segment of the read.
 */
function boundWriteOf(segments: readonly string[], tracked: number, writes: readonly BindingWrite[]): BindingWrite | undefined {
  return writes.find((write) => {
    const written = write.path.split('.');
    if (written.length <= tracked || written.length > segments.length) return false;
    return written.every((s, i) => s === segments[i] || (s === '*' && /^\d+$/.test(segments[i])));
  });
}

/**
 * The paths the bindings on the page write by path — what makes `wcs/getter-untracked-read` certain. Narrower than
 * collectNestedWriteRoots (the warning's evidence): only a binding the runtime writes back with, read as the runtime
 * plans it.
 *   - a spread (`...: x`) on a built-in tag with a wcBindable: `x.<property>` for each of its outputs, but a member
 *     bound explicitly after the spread (last wins). An element whose declaration the lint does not have is skipped
 *   - a two-way binding (state's dom/plan.ts `isTwoWay` — `value` / `valueAsNumber` / `valueAsDate` of an `<input>`,
 *     `checked` of a checkbox or radio, `value` of `<select>` / `<textarea>`) and `radio:` / `checkbox:`
 *   - an output of a built-in tag (`value: x.y` on `<wcs-fetch>`)
 * `#ro` turns all of them off. A relative path in a `for:` row is expanded to the list's rows.
 */
function collectBindingWrites(html: string, bindAttrName: string): BindingWrite[] {
  const out: BindingWrite[] = [];
  // the runtime reads nothing in a `data-wcs-ignore` element as bindings
  const ignored = findIgnoredRanges(html, bindAttrName);
  for (const attr of findAllBindAttributes(html, bindAttrName)) {
    if (ignored.some(([start, end]) => attr.valueStart >= start && attr.valueStart < end)) continue;
    const tag = attr.tagName ?? '';
    const contract = BUILTIN_TAGS[tag];
    const outputs = contract?.hasWcBindable === true ? contract.properties : null;
    const bindings = parseBindTextWithPositions(attr.value);
    bindings.forEach((binding, index) => {
      const parsed = binding.parsed;
      if (parsed === null || binding.pathRange === null) return;
      let path = parsed.statePathName;
      if (path.startsWith('.')) {
        const at = attr.valueStart + binding.pathRange.start;
        const list = getRowShorthandForPath(html, at, bindAttrName) === null
          ? null
          : getResolvedForListPath(html, at, bindAttrName);
        if (list === null) return;
        path = path === '.' ? `${list}.*` : `${list}.*.${path.slice(1)}`;
      }
      const write = (written: string): void => {
        out.push({ path: written, binding: binding.exprText, tag });
      };
      if (parsed.bindingType === 'spread') {
        if (outputs === null) return;
        const later = new Set(bindings.slice(index + 1).flatMap((b) => (b.parsed?.bindingType === 'prop' ? [b.parsed.propName] : [])));
        for (const output of outputs) if (!later.has(output)) write(`${path}.${output}`);
        return;
      }
      if (parsed.propModifiers.includes('ro')) return;
      if (parsed.bindingType === 'radio' || parsed.bindingType === 'checkbox') {
        write(path);
      } else if (parsed.bindingType === 'prop'
        && (writesBack(attr, parsed.propName, parsed.propName) || outputs?.includes(parsed.propName) === true)) {
        write(path);
      }
    });
  }
  return out;
}

/**
 * getter の中の `location` 読み（`wcs/getter-untracked-read`、warning）。`location` は state ではないので依存として
 * 登録されず、getter は最初に読んだ URL を持ち続ける — 遷移の後の言語の切り替えのリンクが前のページを指した
 * （docs/seam-apps.md、router-admin）。getter ごとに最初の 1 か所。
 */
function validateGetterLocationReads(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  if (!script.includes('location')) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const getter of analyzeCallableBodies(script)) {
    if (getter.kind !== 'getter' || getter.accessor !== 'get' || !getter.body.includes('location')) continue;
    const read = findLocationRead(getter.body);
    if (read === null) continue;
    out.push({
      code: WcsDiagnosticCode.GetterUntrackedRead,
      start: scriptStart + getter.bodyStart + read.start,
      end: scriptStart + getter.bodyStart + read.end,
      message: msgs.getterReadsLocation(read.text),
      severity: 'warning',
    });
  }
  return out;
}

/** The clock a getter can read: `Date.now()`, a `new Date()` of no argument (now), `performance.now()`. */
const CLOCK_READ = /\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\s*\.\s*now\s*\(/;

/**
 * getter の中の現在時刻の読み（`wcs/getter-untracked-read`、warning）。時刻は state ではないので依存として登録されず、
 * getter はキャッシュした最初の値を返し続ける — 経過時間の getter が 0.0s のまま動かなかった（7GUIs の評価の Timer:
 * 毎フレームのイベントトークンで「描き直される」と思いがちだが、getter は再評価されない）。getter ごとに最初の 1 か所。
 */
function validateGetterClockReads(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  if (!/Date|performance/.test(script)) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const getter of analyzeCallableBodies(script)) {
    if (getter.kind !== 'getter' || getter.accessor !== 'get') continue;
    const read = CLOCK_READ.exec(maskCommentsAndStrings(getter.body));
    if (read === null) continue;
    const text = read[0].startsWith('new') ? 'new Date()' : read[0].startsWith('performance') ? 'performance.now()' : 'Date.now()';
    out.push({
      code: WcsDiagnosticCode.GetterUntrackedRead,
      start: scriptStart + getter.bodyStart + read.index,
      end: scriptStart + getter.bodyStart + read.index + read[0].length,
      message: msgs.getterReadsClock(text),
      severity: 'warning',
    });
  }
  return out;
}

/**
 * `$on` のハンドラが state を受ける第 1 引数の名前（`cardEvent(state, event) { … }` の `state`）。メソッド記法なら
 * 本体の前の引数リストから、値（function 式・アロー関数）ならその先頭から読む。読めなければ null。
 */
function onHandlerStateParam(script: string, handler: WatchHandlerSource): string | null {
  if (handler.kind === 'body') {
    const head = script.slice(Math.max(0, handler.start - 400), handler.start);
    return /\(\s*([A-Za-z_$][\w$]*)[^()]*\)\s*\{\s*$/.exec(head)?.[1] ?? null;
  }
  return /^\s*(?:async\s+)?(?:function\b[^(]*\(\s*([A-Za-z_$][\w$]*)|\(\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*=>)/.exec(handler.text)
    ?.slice(1).find((name) => name !== undefined) ?? null;
}

/**
 * state の値をその場で変える形のうち、正規表現の規則（`this.<…>` を基点にした wcs/nested-assign・wcs/array-*）が
 * 見ないもの（docs/seam-apps.md、state-collab-board — ボードのカードの更新が出なかった）:
 *   - 別名を通した変更（`const cards = this.cards; cards[i] = card` / `Object.assign(cards[i], card)` / `cards.push(x)`）
 *   - `Object.assign(this.cards[i], card)`
 *   - `$on` のハンドラの state 引数を通した変更（`state.board.cards.push(x)`）
 * 同じ値を書き戻しても（`this.cards = cards`）一覧の行は追加・削除・置き換えされない（新しい配列を代入したときだけ
 * 行を合わせ直す）。形ごとに族の code（破壊的メソッド → array-mutation、添字だけ → array-index-assign、ほか →
 * nested-assign）、error。
 */
function validateInPlaceChanges(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const push = (text: string, kind: 'body' | 'value', textStart: number, root: string | null): void => {
    for (const change of findInPlaceChanges(text, kind, root)) {
      out.push({
        code: change.form === 'method' ? WcsDiagnosticCode.ArrayMutation
          : change.form === 'index' ? WcsDiagnosticCode.ArrayIndexAssign : WcsDiagnosticCode.NestedAssign,
        start: scriptStart + textStart + change.start,
        end: scriptStart + textStart + change.end,
        severity: 'error',
        message: change.alias !== null
          ? msgs.inPlaceAlias(change.alias, change.source, change.target)
          : msgs.inPlaceChange(change.source, change.target),
      });
    }
  };
  for (const callable of analyzeCallableBodies(script)) push(callable.body, 'body', callable.bodyStart, 'this');
  for (const handler of analyzeWatchHandlerSources(script)) push(handler.text, handler.kind, handler.start, 'this');
  for (const handler of analyzeOnHandlerSources(script)) {
    const root = handler.kind === 'body' ? onHandlerStateParam(script, handler) : null;
    if (handler.kind === 'body' && root === null) continue;
    push(handler.text, handler.kind, handler.start, root);
  }
  return out;
}

/**
 * `wcs/input-nested-write` の対象: 束縛が当て直されたとき（＝束ねたパス自身への代入のとき）に
 * だけ働く組み込みタグの入力。下への書き込み（`cart.0.quantity`）では当て直されないので、
 * その書き込みは要素に届かない。
 *   - `<wcs-storage>` の `value`: 代入で保存する。下への書き込みは保存されず、エラーも出ない。
 *     `manual` なら対象外 — `trigger` の保存が今の値（書き込みが入った同じオブジェクト）を
 *     読むので届く（storage の README §2 の形）。
 *   - `<wcs-fetch>` の `body`: 使い捨ての入力で、要求のたびに `null` へ戻る（fetch の README
 *     Design Notes）。最初の要求は同じオブジェクトの参照で届くが、下への書き込みでは当て直されない
 *     ので、2 回目からは本文なしで送られる（`manual` + `trigger` でも同じ・実測）。`oneShot` は
 *     直し方の違い（getter では足りない — 入力を変えない再試行で `null` のまま）をメッセージに出す。
 * 束縛を当て直さないことは全部の入力に共通だが、それで壊れるかは要素の作り（代入で動くか、
 * 後で読むか）次第なので、壊れると分かっている入力だけを載せる（偽陽性ゼロ優先）。
 */
const NESTED_WRITE_INPUTS: Readonly<Record<string, {
  readonly inputs: readonly string[];
  readonly exemptWhenManual: boolean;
  readonly oneShot?: boolean;
}>> = {
  'wcs-storage': { inputs: ['value'], exemptWhenManual: true },
  'wcs-fetch': { inputs: ['body'], exemptWhenManual: false, oneShot: true },
};
const MANUAL_ATTRIBUTE = /(?:^|\s)manual(?:\s|=|$)/i;

/**
 * 組み込みタグの入力を束ねたパスの下へページが書き込む形（`wcs/input-nested-write`）。
 *
 * `<wcs-storage data-wcs="value: cart">` に `this[`cart.${i}.quantity`] += 1` を合わせると、
 * 数量の変化は保存されない（表示は 2、保存は 1。再読み込みで 1 に戻る）。束縛は `cart` への
 * 代入（行の追加・削除）でしか当て直されない — 依存の伝播は親 → 子の向きだけ。直し方は、
 * フィールドをパスで読む getter（行 getter と `$getAll`）を束ねるか、下へ書かずに配列を差し替える。
 * 証拠は collectNestedWriteRoots と同じ（`wcs/getter-untracked-read` と共有）。severity は error:
 * データを失い（storage は保存せず、fetch は本文なしで送る）、実行時は何も言わない。warning のままでは
 * スキルの `--errors-only` の関門を通った（docs/mistake-catalogue.md）。下への書き込みの後に別の経路で必ず
 * `cart` を差し替えるページでは届くが、そのとき下への書き込みは要らない — 差し替えだけを書けばよい。
 */
function validateInputNestedWrites(
  html: string,
  stateTagName: string,
  bindAttrName: string,
  nestedWriteRoots: () => ReadonlyMap<string, string>,
  locale?: string,
): WcsDiagnostic[] {
  const tags = findBuiltinTagOccurrences(html)
    .filter((occ) => {
      const target = NESTED_WRITE_INPUTS[occ.tagName];
      return target !== undefined && !(target.exemptWhenManual && MANUAL_ATTRIBUTE.test(occ.attrsText));
    })
    .map((occ) => ({ tagName: occ.tagName, start: occ.tagStart, end: occ.attrsStart + occ.attrsText.length }));
  if (tags.length === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const index = buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName });
  for (const occ of index.occurrences) {
    if (occ.kind !== 'path' || occ.source !== 'attribute' || occ.bindingType !== 'prop' || occ.propName === null) continue;
    if (occ.path.startsWith('.')) continue;
    const at = occ.exprRange.start;
    const tag = tags.find((t) => t.start <= at && at <= t.end);
    if (tag === undefined) continue;
    const input = occ.propName.startsWith('.') ? occ.propName.slice(1) : occ.propName;
    if (!NESTED_WRITE_INPUTS[tag.tagName].inputs.includes(input)) continue;
    const example = nestedWriteRoots().get(occ.path);
    if (example === undefined) continue;
    const message = NESTED_WRITE_INPUTS[tag.tagName].oneShot
      ? msgs.inputNestedWriteOneShot(tag.tagName, input, occ.path, example)
      : msgs.inputNestedWrite(tag.tagName, input, occ.path, example);
    out.push({
      code: WcsDiagnosticCode.InputNestedWrite,
      start: occ.pathRange.start,
      end: occ.pathRange.end,
      severity: 'error',
      tag: tag.tagName,
      statePath: occ.path,
      message,
    });
  }
  return out;
}

/** ランタイムの既定 two-way DOM プロパティ（書き戻しあり）。 */
const TWO_WAY_PROPS = new Set(['value', 'checked']);
/** `this["a.b"] = …` / `+=` / `++`（後置）と `++this["a.b"]`（前置）。ドットパス経由の入れ子書き込み。 */
const BRACKET_WRITE = new RegExp(`${ROOT_BRACKET}${ASSIGN_TAIL}`, 'g');
const PRE_BRACKET_INCDEC = new RegExp(`${PRE_INCDEC}${ROOT_BRACKET}`, 'g');
/** `` this[`cart.${i}.quantity`] `` — テンプレートリテラルのキー（鏡像では中身が空白、群 1 が中身の範囲）。 */
const TEMPLATE_BRACKET = String.raw`\bthis\s*(?:\?\.)?\s*\[\s*` + '`([^`]*)`' + String.raw`\s*\]`;
const TEMPLATE_BRACKET_WRITE = new RegExp(`${TEMPLATE_BRACKET}${ASSIGN_TAIL}`, 'g');
const PRE_TEMPLATE_BRACKET_INCDEC = new RegExp(`${PRE_INCDEC}${TEMPLATE_BRACKET}`, 'g');
/** 置換（`${…}`）を `*` に読み替えた後のキーがパスとして読めるか（段の一部だけの置換 `item${i}` は読まない）。 */
const TEMPLATE_KEY_PATH = /^[A-Za-z_][\w]*(?:\.(?:\*|[\w]+))*$/;

/**
 * テンプレートリテラルのキーを、置換を `*` に読み替えたパスにする（`` `cart.${i}.quantity` `` →
 * `cart.*.quantity`）。段の一部だけの置換・`$` 始まり（API 名前空間）・入れ子の置換は読めないので null。
 */
function templateKeyPath(raw: string): string | null {
  if (raw.includes('`')) return null;
  const path = raw.replace(/\$\{[^{}]*\}/g, '*');
  return TEMPLATE_KEY_PATH.test(path) ? path : null;
}

/**
 * 入れ子書き込みの証拠があるルート（およびその全接頭辞）を集める。値は証拠になった書き込みの
 * パス（最初に見つけたもの。メッセージの例に使う）。
 * `wcs/getter-untracked-read` のゲート: `form.name` が書かれるなら `form` に証拠が付く。
 * `wcs/input-nested-write` も同じ証拠を使う: `cart.*.quantity` が書かれるなら `cart` に付く。
 *
 * 証拠として数える形（どれも `root.<sub>` への書き込みだと静的に断定できるもの）:
 *   - HTML: `value:` / `checked:` の prop バインド、`radio:` / `checkbox:`、spread `...: root`
 *     （spread は展開先のメンバーへ書く — `...: fetch` は `fetch.value` 等）
 *   - HTML: 組み込み wcs-* タグの出力プロパティへのバインド（`latitude: geo.lat`）
 *   - HTML: 上のどれかの、`for:` の行の中の相対パス（`value: .quantity` は `cart.*.quantity`）
 *   - script: `this["a.b"] = …`（複合代入・増減含む）、`` this[`a.${i}.b`] = … ``（置換は `*`）、
 *     `$setAll("a.…")`、値付き `$resolve("a.…", [...], v)`
 *   - `<wcs-state mount="a.b">` ボリューム（そのサブツリーは `a.b.*` への書き込み）
 * 数えない形: `textContent:` / mustache（読み）、ルート自身へのバインド（`typedParams: params` は
 * 丸ごと置換）、`this.a.b = …`（素のプロパティ書き込み — 反応しないので wcs/nested-assign が error にする）。
 * 精度の割り切り: `value#ro:` の `#ro` は索引に載らないので value と同じに数える（丸ごと置換と
 * `#ro` が同居するときだけ余計に出る）。
 */
function collectNestedWriteRoots(
  html: string,
  stateTagName: string,
  bindAttrName: string,
  blocks: readonly { content: string; mountPath: string | null }[],
): Map<string, string> {
  const roots = new Map<string, string>();
  const addPrefixes = (path: string, inclusive: boolean): void => {
    const segments = path.split('.');
    const last = inclusive ? segments.length : segments.length - 1;
    const example = inclusive ? `${path}.*` : path;
    for (let i = 1; i <= last; i++) {
      const prefix = segments.slice(0, i).join('.');
      if (!roots.has(prefix)) roots.set(prefix, example);
    }
  };

  // HTML 側。組み込みタグの範囲を先に取り、出現のオフセットで所属タグを引く
  const tags = findBuiltinTagOccurrences(html).map((occ) => ({
    contract: BUILTIN_TAGS[occ.tagName],
    start: occ.tagStart,
    end: occ.attrsStart + occ.attrsText.length,
  }));
  const index = buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName });
  for (const occ of index.occurrences) {
    if (occ.kind !== 'path' || occ.source !== 'attribute') continue;
    // 行の中の相対パスは、囲む `for:` のリストの行へ展開する（`.quantity` → `cart.*.quantity`）。
    // ランタイムが拒む `for:` の中（getRowShorthandForPath が null）の行は存在しないので数えない。
    let path = occ.path;
    if (path.startsWith('.')) {
      const list = getRowShorthandForPath(html, occ.pathRange.start, bindAttrName) === null
        ? null
        : getResolvedForListPath(html, occ.pathRange.start, bindAttrName);
      if (list === null) continue;
      path = path === '.' ? `${list}.*` : `${list}.*.${path.slice(1)}`;
    }
    if (occ.bindingType === 'spread') { addPrefixes(path, true); continue; }
    if (occ.bindingType === 'radio' || occ.bindingType === 'checkbox') { addPrefixes(path, false); continue; }
    if (occ.bindingType !== 'prop' || occ.propName === null) continue;
    if (TWO_WAY_PROPS.has(occ.propName)) { addPrefixes(path, false); continue; }
    const at = occ.exprRange.start;
    const tag = tags.find((t) => t.start <= at && at <= t.end);
    if (tag?.contract?.hasWcBindable && tag.contract.properties.includes(occ.propName)) addPrefixes(path, false);
  }

  // script 側
  for (const block of blocks) {
    if (block.mountPath !== null) addPrefixes(block.mountPath, true);
    // 検出は鏡像（コメント・文字列の中身を空白化）、値の読み出しは原文から（上と同じ規約）
    const scan = maskCommentsAndStrings(block.content);
    for (const regex of [BRACKET_WRITE, PRE_BRACKET_INCDEC]) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      // `this["a.b"] = …` のキーは引用符の中なので、鏡像では空白 — 原文から切り出す
      while ((match = regex.exec(scan)) !== null) {
        const keyStart = match.index + match[0].search(/["']/) + 1;
        addPrefixes(block.content.slice(keyStart, keyStart + match[1].length), false);
      }
    }
    for (const regex of [TEMPLATE_BRACKET_WRITE, PRE_TEMPLATE_BRACKET_INCDEC]) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(scan)) !== null) {
        const keyStart = match.index + match[0].indexOf('`') + 1;
        const path = templateKeyPath(block.content.slice(keyStart, keyStart + match[1].length));
        if (path !== null) addPrefixes(path, false);
      }
    }
    // `$on` のハンドラは state を第 1 引数で受ける（`handler(state, event)`）: `state["board.cards"] = …` も同じ証拠。
    // SSE・WebSocket のデータが着く所（docs/seam-apps.md、state-collab-board — lint が黙っていた）
    for (const handler of analyzeOnHandlerSources(block.content)) {
      const param = onHandlerStateParam(block.content, handler);
      if (param === null) continue;
      const name = param.replace(/\$/g, '\\$');
      const region = { start: handler.start, end: handler.start + handler.text.length };
      const bracket = `\\b${name}\\s*(?:\\?\\.)?\\s*\\[\\s*["']([^"']+)["']\\s*\\]`;
      const template = `\\b${name}\\s*(?:\\?\\.)?\\s*\\[\\s*` + '`([^`]*)`' + String.raw`\s*\]`;
      for (const [pattern, quote] of [[bracket, /["']/], [template, /`/]] as const) {
        for (const regex of [new RegExp(`${pattern}${ASSIGN_TAIL}`, 'g'), new RegExp(`${PRE_INCDEC}${pattern}`, 'g')]) {
          let match: RegExpExecArray | null;
          const part = scan.slice(region.start, region.end);
          while ((match = regex.exec(part)) !== null) {
            const keyStart = region.start + match.index + match[0].search(quote) + 1;
            const raw = block.content.slice(keyStart, keyStart + match[1].length);
            const path = quote.source === '`' ? templateKeyPath(raw) : raw;
            if (path !== null) addPrefixes(path, false);
          }
        }
      }
    }
    API_CALL.lastIndex = 0;
    let call: RegExpExecArray | null;
    while ((call = API_CALL.exec(scan)) !== null) {
      const api = call[1];
      if (api === 'getAll') continue;
      const parsed = splitCallArgs(block.content, call.index + call[0].length);
      if (parsed === null) continue;
      API_CALL.lastIndex = parsed.end;
      const path = parsed.args.length > 0 ? literalString(parsed.args[0]) : null;
      if (path === null) continue;
      if (api === 'setAll' || parsed.args.length >= 3) addPrefixes(path, false);
    }
  }
  return roots;
}

/**
 * `$renderedCallback` の本体で、**パス判定に使われている**文字列リテラルを位置付きで返す。
 *
 * 対象の形（実測された事故の形 `if (!paths.includes("…")) return;` を含む）:
 *   `.includes("X")` / `.indexOf("X")` / `=== "X"` / `!== "X"`
 * `this["X"]` のような**読み取り**は対象外 — 読みはバインドの有無に関係なく成立するので、
 * 未バインドでも死んでいない。
 */
const PATH_TEST_LITERAL = /(?:\.\s*(?:includes|indexOf)\s*\(\s*|[!=]==\s*)(["'])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * `$renderedCallback` が「どのバインディングにも現れないパス」を判定に使っていないか。
 *
 * `$renderedCallback` は **binding 駆動**で、live binding が適用された path しか報告しない。
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
  // bind-component の中のスクリプトはランタイムが読まない（wcs/bind-component-source）
  const blocks = parseLoadedScriptBlocks(html, stateTagName);
  if (blocks.length === 0) return [];
  const hasCallback = blocks.some((block) => [...STATE_UPDATED_CALLBACKS].some((name) => block.content.includes(name)));
  if (!hasCallback) return [];

  const msgs = getMessages(locale);
  const boundPaths = collectBoundPaths(html, stateTagName, bindAttrName);
  const out: WcsDiagnostic[] = [];

  for (const block of blocks) {
    const callback = analyzeCallableBodies(block.content)
      .find((entry) => STATE_UPDATED_CALLBACKS.has(entry.name) && entry.kind === 'method');
    if (callback === undefined) continue;
    // ボリューム（mount=）の $renderedCallback は 4.0 では接ぎ木を拒まれる（console.error。3.x は自分の接頭辞配下の
    // 更新を相対パスで届けて実行した）ので、この「走らない分岐」の検査の対象外
    if (block.mountPath !== null) continue;
    const declared = new Set(analyzeStatePaths(block.content).map((p) => p.path));
    const bound = boundPaths;
    // ここだけは `blankComments`（コメントだけ潰す）が正しい — 探しているのが
    // `paths.includes("form.name")` の**文字列リテラルそのもの**なので、
    // `maskCommentsAndStrings` を使うと検査対象のパスごと消える
    const body = blankComments(callback.body);
    PATH_TEST_LITERAL.lastIndex = 0;
    let match: RegExpExecArray | null;
    const reported = new Set<string>();
    while ((match = PATH_TEST_LITERAL.exec(body)) !== null) {
      const path = match[2];
      if (path.length === 0 || bound.has(path) || reported.has(path)) continue;
      // A path the state does not have is never in `paths` either: reported only beside a near one it has (a typo —
      // `items.*.onn`, `labell`), as a string of another kind may be compared here too (7GUIs evaluation)
      let message: string;
      if (declared.has(path)) {
        message = msgs.updatedCallbackUnbound(path);
      } else {
        const near = suggestion(path, [...declared, ...bound], msgs);
        if (near === '') continue;
        message = msgs.updatedCallbackUnknownPath(path) + near;
      }
      reported.add(path);
      // レンジはリテラル本体（引用符の内側）
      const quoteAt = match.index + match[0].length - path.length - 1;
      out.push({
        code: WcsDiagnosticCode.UpdatedCallbackUnbound,
        start: block.contentStart + callback.bodyStart + quoteAt,
        end: block.contentStart + callback.bodyStart + quoteAt + path.length,
        message,
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
    // the list the innermost for renders, its relative fors joined from the outside in (`for: rows` →
    // `for: .cells` → `rows.*.cells`): `if: .editing` there is `rows.*.cells.*.editing`
    const forPath = getResolvedForListPath(html, occurrence.pathRange.start, bindAttrName);
    if (forPath === null) continue;
    bound.add(
      occurrence.path === '.' ? `${forPath}.*` : `${forPath}.*.${occurrence.path.slice(1)}`,
    );
  }
  return bound;
}

/** `$` の次が数字の名前（`$1`・`$0`・`$129`・`$1x`）。 */
const DOLLAR_DIGIT_NAME = /\$\d[\w$]*/g;
/** フォールバック: 鏡像（コメント・文字列を空白化）の `this.$<数字>…`。 */
const THIS_DOLLAR_DIGIT = /\bthis\s*\.\s*(\$\d[\w$]*)/g;
const INDEX_READ_FILTER: MemberNameFilter = { has: isOutOfRangeIndexRead };

/**
 * スクリプトの `this.$0` / `this.$129` / `this.$1000`（`wcs/index-param-range`）。4.0 の `engine.ts` の `dollar` は、
 * `$` の次が数字の名前を読んだ時点で、`$1`〜`$128`（上限は manifest の `syntax.indexParam.maxDepth`）のほかは
 * すべて `[wcs/index-param-range]` で投げる（その getter に結ばれたバインディングは失敗する）。
 *
 * 走査対象は旧名の宣言キーの読み出しと同じ（`collectStateThisReads` — ランタイムが `this` を state に束縛して呼ぶ
 * 関数）。AST で断定できたら error。読めない形（class 構文など）は鏡像への正規表現へ落として warning に留める
 * （構造が見えず、state でない `this` にも当たりうる — 誤検出しうる経路の severity を 1 段下げる）。
 * 範囲の外の名前がスクリプトのどこにも無ければ、1 回の走査で抜ける（解析しない）。
 */
function validateIndexParamReads(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  if (!hasOutOfRangeIndexName(script)) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const push = (name: string, start: number, severity: 'error' | 'warning'): void => {
    out.push({
      code: WcsDiagnosticCode.IndexParamRange,
      start: scriptStart + start,
      end: scriptStart + start + name.length,
      message: msgs.indexParamRange(name, MAX_INDEX_PARAM),
      severity,
    });
  };
  const reads = collectStateThisReads(script, INDEX_READ_FILTER);
  if (reads !== null) {
    for (const read of reads) push(read.name, read.start, 'error');
    return out;
  }
  const scan = maskCommentsAndStrings(script);
  THIS_DOLLAR_DIGIT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = THIS_DOLLAR_DIGIT.exec(scan)) !== null) {
    const name = match[1];
    if (isOutOfRangeIndexRead(name)) push(name, match.index + match[0].length - name.length, 'warning');
  }
  return out;
}

/** 範囲の外の添字の名前（`isOutOfRangeIndexRead`）がスクリプトのどこかにあるか（解析の前の安いゲート）。 */
function hasOutOfRangeIndexName(script: string): boolean {
  DOLLAR_DIGIT_NAME.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DOLLAR_DIGIT_NAME.exec(script)) !== null) {
    if (isOutOfRangeIndexRead(match[0])) return true;
  }
  return false;
}

/**
 * HTML 内の `<wcs-state>` スクリプトから意味論的な取り違えを検出する。
 */
/**
 * `wcs/on-handler-this`（error）: `$on` のハンドラの中の `this.…`。ランタイムは `$on` のハンドラを
 * `handler(state, event, …)` と呼ぶ（engine.ts の deliver）ので `this` は undefined — `$watch` や
 * メソッドの書き方で書くと、呼ばれたときに例外になる。router-auth と state-collab-board の初めての作者が
 * どちらも踏み、ランタイムの報告（`event.detail` を state のパスとして読んだ `binding-path-missing`）は
 * 原因を指さなかった（docs/seam-apps.md）。`this.x` も別名（`const state = this`）も報告する。入れ子の
 * function / class の中の `this` と、値がアロー関数のハンドラは見ない（断定できない側に倒す）。ハンドラ
 * ごとに最初の 1 か所を報告する。
 */
function validateOnHandlerThis(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const handler of analyzeOnHandlerSources(script)) {
    // `this` の使い方は問わない — `this.x` も `const state = this` も同じ間違い
    const first = findOwnThis(handler.text, handler.kind);
    if (first === null) continue;
    out.push({
      code: WcsDiagnosticCode.OnHandlerThis,
      start: scriptStart + handler.start + first.start,
      end: scriptStart + handler.start + first.end,
      severity: 'error',
      message: msgs.onHandlerThis(handler.name),
    });
  }
  return out;
}

export function validateSemantics(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  bindAttrName: string = 'data-wcs',
): WcsDiagnostic[] {
  const out: WcsDiagnostic[] = [];
  const blocks = parseLoadedScriptBlocks(html, stateTagName);
  // 入れ子書き込みの証拠はドキュメント単位で 1 回だけ集める（必要になるまで作らない）
  let nestedWriteRoots: Map<string, string> | null = null;
  const getNestedWriteRoots = (): ReadonlyMap<string, string> =>
    (nestedWriteRoots ??= collectNestedWriteRoots(html, stateTagName, bindAttrName, blocks));
  let bindingWrites: BindingWrite[] | null = null;
  const getBindingWrites = (): readonly BindingWrite[] => (bindingWrites ??= collectBindingWrites(html, bindAttrName));
  for (const block of blocks) {
    out.push(...validateIndexArity(block.content, block.contentStart, locale));
    out.push(...validateNameAliases(block.content, block.contentStart, locale, block.mountPath));
    out.push(...validateIndexParamReads(block.content, block.contentStart, locale));
    out.push(...validateGetterCycles(block.content, block.contentStart, locale));
    out.push(...validateGetterUntrackedReads(
      block.content, block.contentStart, block.mountPath, getNestedWriteRoots, getBindingWrites, locale,
    ));
    out.push(...validateGetterLocationReads(block.content, block.contentStart, locale));
    out.push(...validateGetterClockReads(block.content, block.contentStart, locale));
    out.push(...validateOnHandlerThis(block.content, block.contentStart, locale));
    out.push(...validateInPlaceChanges(block.content, block.contentStart, locale));
  }
  out.push(...validateInputNestedWrites(html, stateTagName, bindAttrName, getNestedWriteRoots, locale));
  out.push(...validateUpdatedCallbackDemand(html, stateTagName, bindAttrName, locale));
  return out;
}
