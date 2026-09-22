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
import { analyzeCallableBodies, analyzeDeclarationSpans, analyzeStatePaths, isObjectLiteral } from './stateAnalyzer.js';
import { collectGetterReads } from './scriptAst.js';
import { countWildcardSegments, getInnermostForPath } from './forContext.js';
import { buildReferenceIndex } from '../core/index/referenceIndex.js';
import { findBuiltinTagOccurrences } from './ioNodeValidator.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { ASSIGN_TAIL, PRE_INCDEC, ROOT_BRACKET } from './scriptPatterns.js';
import { blankComments, literalArrayLength, literalString, splitCallArgs } from './scriptCallArgs.js';
import { hasRecursionWildcard } from './recursionPaths.js';

/** ランタイム予約キー（@wcstack/state の define.ts が正本）。`$renderedCallback` が正式名、`$updatedCallback` は 3.x の間の旧名（3.2） */
const STATE_UPDATED_CALLBACKS: ReadonlySet<string> = new Set(['$renderedCallback', '$updatedCallback']);

/** 3.x の間だけ残る旧名 → 正式名（@wcstack/state 3.2・要件 B12）。API はメソッド呼び出し、宣言は state のキー */
const OLD_API_NAMES: Readonly<Record<string, string>> = { $trackDependency: '$dependOn', $untrackDependency: '$untracked' };
const OLD_DECLARATION_KEYS: Readonly<Record<string, string>> = { $streams: '$stream', $updatedCallback: '$renderedCallback' };
const OLD_API_CALL = /\.\s*(\$trackDependency|\$untrackDependency)\b/g;
/** 旧名の宣言キーを `this.` 越しに読む（正規化で自前プロパティから消えるので旧名のまま残さない）。 */
const OLD_DECLARATION_MEMBER = /\.\s*(\$streams|\$updatedCallback)\b/g;
/**
 * 宣言オブジェクトが静的に読めないとき（class 構文の state — ボリューム（`mount=`）の通常形）の
 * フォールバック。オブジェクトリテラルのキー（`$streams:`）・メソッド（`$updatedCallback(…) {}`）に
 * 加えて class フィールド（`$streams = …`。`==` / `===` は除く）も見る。
 * 文字列リテラルの中は潰せないので誤検出が残りうるが、severity は info なので
 * 「読めないから黙る」より「移行漏れを取りこぼさない」側に倒す（この診断の目的）。
 */
const OLD_DECLARATION_KEY = /(^|[{,;\s])(\$streams|\$updatedCallback)(?=\s*(?:[:(]|=(?!=)))/g;

/**
 * 旧名の API 呼び出しと宣言キーに `wcs/name-alias`（info）を付ける。動くが 4.0 で外れるので
 * 正式名を提案する。旧名と正式名を**両方**宣言していたら `wcs/declaration-alias`（error）—
 * ランタイム（@wcstack/state declarationAliases.ts）が正規化の時点で raiseError するので、
 * info ではなくページごと止まる側の報告にする。
 *
 * 宣言キーの走査は 2 経路のハイブリッド:
 *
 *   1. 宣言側の正本（`analyzeDeclarationSpans`）が読めたとき — 正確なスパン・文字列リテラルの
 *      誤検出なし・引用符付きキー（`"$streams": { … }`）も拾える。`wcs/declaration-alias`
 *      （error）への昇格はこの経路だけ（断定できる形なので）。
 *   2. 読めなかったとき（class 構文の state — ボリュームの通常形） — `OLD_DECLARATION_KEY` で
 *      拾って info だけ出す。正規表現は誤検出しうるので、ここでは error に昇格させない
 *      （ランタイムが止める形なので、error を出さないのは安全側）。
 */
function validateNameAliases(script: string, scriptStart: number, locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const scan = blankComments(script);
  const out: WcsDiagnostic[] = [];
  const push = (name: string, canonical: string, offset: number): void => {
    out.push({
      code: WcsDiagnosticCode.NameAlias,
      start: scriptStart + offset,
      end: scriptStart + offset + name.length,
      message: msgs.nameAlias(name, canonical),
      severity: 'info',
    });
  };
  for (const pattern of [OLD_API_CALL, OLD_DECLARATION_MEMBER]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(scan)) !== null) {
      const written = match[1];
      const canonical = OLD_API_NAMES[written] ?? OLD_DECLARATION_KEYS[written];
      push(written, canonical, match.index + match[0].length - written.length);
    }
  }

  const spans = analyzeDeclarationSpans(script);
  if (spans.length === 0) {
    // 経路 2: 宣言が静的に読めない（class 構文など）。info だけを出す
    OLD_DECLARATION_KEY.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = OLD_DECLARATION_KEY.exec(scan)) !== null) {
      push(match[2], OLD_DECLARATION_KEYS[match[2]], match.index + match[1].length);
    }
    return out;
  }

  // 経路 1: 宣言側の正本が読めた
  const declared = new Set(spans.map(span => span.name));
  for (const span of spans) {
    const canonical = OLD_DECLARATION_KEYS[span.name];
    if (canonical === undefined) continue;
    if (declared.has(canonical)) {
      out.push({
        code: WcsDiagnosticCode.DeclarationAlias,
        start: scriptStart + span.start,
        end: scriptStart + span.end,
        message: msgs.declarationAlias(span.name, canonical),
        severity: 'error',
      });
      continue;
    }
    push(span.name, canonical, span.start);
  }
  return out;
}

/** `this.$getAll(` / `this.$setAll(` / `this.$resolve(` の呼び出し開始。`?.` 経由も拾う。 */
const API_CALL = /\.\s*\$(getAll|setAll|resolve)\s*\(/g;

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
      severity: 'warning',
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
      severity: 'warning',
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
 */
function validateGetterUntrackedReads(
  script: string,
  scriptStart: number,
  nestedWriteRoots: () => ReadonlySet<string>,
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
      if (!nestedWriteRoots().has(segments[0])) continue;
      out.push({
        code: WcsDiagnosticCode.GetterUntrackedRead,
        start: scriptStart + getter.bodyStart + read.start,
        end: scriptStart + getter.bodyStart + read.end,
        message: msgs.getterUntrackedRead(segments[0], segments.join('.')),
        severity: 'warning',
      });
    }
  }
  return out;
}

/** ランタイムの既定 two-way DOM プロパティ（書き戻しあり）。 */
const TWO_WAY_PROPS = new Set(['value', 'checked']);
/** `this["a.b"] = …` / `+=` / `++`（後置）と `++this["a.b"]`（前置）。ドットパス経由の入れ子書き込み。 */
const BRACKET_WRITE = new RegExp(`${ROOT_BRACKET}${ASSIGN_TAIL}`, 'g');
const PRE_BRACKET_INCDEC = new RegExp(`${PRE_INCDEC}${ROOT_BRACKET}`, 'g');

/**
 * 入れ子書き込みの証拠があるルート（およびその全接頭辞）を集める。
 * `wcs/getter-untracked-read` のゲート: `form.name` が書かれるなら `form` に証拠が付く。
 *
 * 証拠として数える形（どれも `root.<sub>` への書き込みだと静的に断定できるもの）:
 *   - HTML: `value:` / `checked:` の prop バインド、`radio:` / `checkbox:`、spread `...: root`
 *     （spread は展開先のメンバーへ書く — `...: fetch` は `fetch.value` 等）
 *   - HTML: 組み込み wcs-* タグの出力プロパティへのバインド（`latitude: geo.lat`）
 *   - script: `this["a.b"] = …`（複合代入・増減含む）、`$setAll("a.…")`、値付き `$resolve("a.…", [...], v)`
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
): Set<string> {
  const roots = new Set<string>();
  const addPrefixes = (path: string, inclusive: boolean): void => {
    const segments = path.split('.');
    const last = inclusive ? segments.length : segments.length - 1;
    for (let i = 1; i <= last; i++) roots.add(segments.slice(0, i).join('.'));
  };

  // HTML 側。組み込みタグの範囲を先に取り、出現のオフセットで所属タグを引く
  const tags = findBuiltinTagOccurrences(html).map((occ) => ({
    contract: BUILTIN_TAGS[occ.tagName],
    start: occ.tagStart,
    end: occ.attrsStart + occ.attrsText.length,
  }));
  const index = buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName });
  for (const occ of index.occurrences) {
    if (occ.kind !== 'path' || occ.path.startsWith('.') || occ.source !== 'attribute') continue;
    if (occ.bindingType === 'spread') { addPrefixes(occ.path, true); continue; }
    if (occ.bindingType === 'radio' || occ.bindingType === 'checkbox') { addPrefixes(occ.path, false); continue; }
    if (occ.bindingType !== 'prop' || occ.propName === null) continue;
    if (TWO_WAY_PROPS.has(occ.propName)) { addPrefixes(occ.path, false); continue; }
    const at = occ.exprRange.start;
    const tag = tags.find((t) => t.start <= at && at <= t.end);
    if (tag?.contract?.hasWcBindable && tag.contract.properties.includes(occ.propName)) addPrefixes(occ.path, false);
  }

  // script 側
  for (const block of blocks) {
    if (block.mountPath !== null) addPrefixes(block.mountPath, true);
    const scan = blankComments(block.content);
    for (const regex of [BRACKET_WRITE, PRE_BRACKET_INCDEC]) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(scan)) !== null) addPrefixes(match[1], false);
    }
    API_CALL.lastIndex = 0;
    let call: RegExpExecArray | null;
    while ((call = API_CALL.exec(scan)) !== null) {
      const api = call[1];
      if (api === 'getAll') continue;
      const parsed = splitCallArgs(scan, call.index + call[0].length);
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
  const hasCallback = blocks.some((block) => [...STATE_UPDATED_CALLBACKS].some((name) => block.content.includes(name)));
  if (!hasCallback) return [];

  const msgs = getMessages(locale);
  const boundPaths = collectBoundPaths(html, stateTagName, bindAttrName);
  const out: WcsDiagnostic[] = [];

  for (const block of blocks) {
    const callback = analyzeCallableBodies(block.content)
      .find((entry) => STATE_UPDATED_CALLBACKS.has(entry.name) && entry.kind === 'method');
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
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  // 入れ子書き込みの証拠はドキュメント単位で 1 回だけ集める（必要になるまで作らない）
  let nestedWriteRoots: Set<string> | null = null;
  const getNestedWriteRoots = (): ReadonlySet<string> =>
    (nestedWriteRoots ??= collectNestedWriteRoots(html, stateTagName, bindAttrName, blocks));
  for (const block of blocks) {
    out.push(...validateIndexArity(block.content, block.contentStart, locale));
    out.push(...validateNameAliases(block.content, block.contentStart, locale));
    out.push(...validateGetterCycles(block.content, block.contentStart, locale));
    out.push(...validateGetterUntrackedReads(block.content, block.contentStart, getNestedWriteRoots, locale));
  }
  out.push(...validateUpdatedCallbackDemand(html, stateTagName, bindAttrName, locale));
  return out;
}
