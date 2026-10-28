/**
 * stateAnalyzer.ts
 *
 * HTML 内の <wcs-state> スクリプトからオブジェクトリテラルを解析し、
 * バインディング用のパス候補を生成する。
 *
 * TypeScript の AST パーサを使用せず、軽量な正規表現ベースで解析する。
 * 完全な精度は求めず、補完候補として有用なパスを高速に生成することを優先。
 */

/** パス候補 */
export interface PathCandidate {
  /** ドット区切りパス（例: "users.*.name"、"$command.play"） */
  path: string;
  /**
   * パスの種別（method は検証専用、補完候補には出さない）。
   * - command: `$commandTokens` 宣言から導出した `$command.<name>` パス
   * - eventToken: `$eventTokens` 宣言から導出したトークン名（`eventToken.<prop>:` の右辺）
   * - recursive: `**` を含む再帰 getter のキー（`nodes.**.total`）。オーサリング層専用の
   *   記号なので `data-wcs` には書けない（runtime は `wcs/recursion-unsupported` で throw）。
   *   検証だけが使う — 補完候補には出さない。
   * - recursionAnchor: `$recursion` 宣言そのもののマーカー。path はアンカーの `**` 形
   *   （`nodes.**`）、`repeat` に反復サブパスが入る。候補集合に載せることで、マウント
   *   接頭辞の付与・外部 state ファイルの解決といった既存の配管をそのまま通す。
   */
  kind: 'data' | 'computed' | 'method' | 'list' | 'command' | 'eventToken' | 'recursive' | 'recursionAnchor';
  /** 値の型ヒント（推定） */
  typeHint?: string;
  /** kind: 'recursionAnchor' のときだけ設定。反復サブパス（`children.*`）。 */
  repeat?: string;
  /**
   * 初期値リテラルの生テキスト（kind: 'data' のみ、トリム済み。例: "true"、"''"、"null"）。
   * シード値検査（trigger スロットの true シード / storage スロットの空文字シード等）が
   * 具体値を必要とするため typeHint とは別に公開する。JSON 由来のパスには付かない。
   */
  rawInitial?: string;
  /**
   * kind: 'computed' のときだけ、setter も宣言されていれば true（アクセサペア）。書き込みの
   * 受け口がある getter — `<wcs-storage>` の値を復元する形 — を見分ける検査が使う。
   */
  settable?: boolean;
  /**
   * sidecar manifest の `stateSchema` から導出した候補（analyzeSchemaPaths）。
   * 型は宣言された契約由来なので「確定」扱い — `for:` の非配列を error にする判定に使う。
   */
  fromSchema?: boolean;
}

import type { JsonSchemaNode } from '../core/sidecar/types.js';
import {
  RECURSION_KEY,
  checkNodePath,
  hasRecursionWildcard,
  impliedStructurePaths,
  makeRecursionSpec,
  type RecursionSpec,
} from './recursionPaths.js';
import {
  collectJsDocTypedefs,
  jsDocShape,
  jsDocTypeHint,
  parseJsDocType,
  readJsDocReturnsBefore,
  readJsDocTypeBefore,
  type JsDocType,
  type JsDocTypedefs,
} from './jsdocType.js';

// ランタイム予約キー（@wcstack/state src/define.ts の reservedStateApi が正本）。
// トップレベルの `$` プレフィックスキーは宣言・API 名前空間でありデータパスにならない。
/** `$stream` が正式名。`$streams` は 3.x の旧名（4.0 は読み込み時に throw — wcs/declaration-alias）だが、値の実体化は続ける（束縛側に binding-path-missing を重ねない） */
const RESERVED_STREAMS_KEYS: ReadonlySet<string> = new Set(['$stream', '$streams']);
const RESERVED_COMMAND_TOKENS_KEY = '$commandTokens';
const RESERVED_EVENT_TOKENS_KEY = '$eventTokens';
const RESERVED_LIST_KEYS_KEY = '$listKeys';
// `$watch` はパスを新設しないので analyzeStatePaths では派生候補を作らない。
// 宣言そのものの検証（キーがパスとして成立するか）は analyzeWatchEntries が担う。
const RESERVED_WATCH_KEY = '$watch';
// `$scan: { <output>: { from | on, initial, fold, resetOn? } }`。3.x の宣言で、4.0 は読み込み時に throw する
// （scanDeclarationValidator が `wcs/scan-declaration-invalid` で報告する）。出力の値プロパティは 3.x と同じく
// 実体化したままにする — 束縛側に `wcs/binding-path-missing` を重ねて、直す場所を 1 つから増やさないため。
const RESERVED_SCAN_KEY = '$scan';
// `$recursion: { "<anchor>": "<repeat>" }`。`$listKeys` と同じく**構造を実体化する**宣言
// （宣言だけで `nodes` / `nodes.*.children` の存在が確定する）ので後処理で候補を足す。
// 宣言そのものの検証は analyzeRecursionDeclaration + recursionValidator が担う。
const RESERVED_RECURSION_KEY = RECURSION_KEY;

/**
 * export default { ... } のオブジェクトリテラルからパス候補を生成する。
 *
 * @param scriptContent - <script type="module"> の内容
 * @returns パス候補の配列
 */
export function analyzeStatePaths(scriptContent: string): PathCandidate[] {
  const root = locateDefaultExportObject(scriptContent);
  if (!root || !root.content) return [];

  const paths: PathCandidate[] = [];
  const topLevelProps = parseTopLevelProperties(root.content);
  // `$streams` の値プロパティ実体化はループ後に処理する（明示宣言されたプロパティが優先）
  const pendingStreamValues: PropertyInfo[] = [];
  // `$listKeys` のリストパス実体化も同様に後処理（明示宣言・$streams 実体化が優先）
  const pendingListKeys: PropertyInfo[] = [];
  // `$recursion` が含意する構造パスも後処理（明示宣言が優先）
  const recursionSpec = specFromRecursionValue(topLevelProps.find(p => p.name === RESERVED_RECURSION_KEY));
  // 同じキーを 2 度書いた宣言は、オブジェクトリテラルの評価順どおりに畳む（後の宣言が勝つ）
  const effectiveDescriptors = effectiveTopLevelDescriptors(topLevelProps);
  // JSDoc `@typedef` の名前（`/** @type {Product[] | null} */` の `Product` を形に解決する）
  const typedefs: JsDocTypedefs = scriptContent.includes('@typedef')
    ? collectJsDocTypedefs(scriptContent, maskCommentsAndStrings(scriptContent))
    : new Map();

  for (const prop of topLevelProps) {
    // トップレベルの `$` プレフィックスキーは予約名（$streams/$scan/$commandTokens/$eventTokens/
    // $listKeys/$watch/$on/$bindables/$connectedCallback 等）。データパスにせず宣言由来の
    // 候補だけを導出する。`$watch` は既存パスを購読するだけで新しいパスを作らないため、
    // `$streams` / `$scan`（値プロパティを実体化する）と違い個別処理は要らない。
    if (prop.name.startsWith('$')) {
      collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys);
      continue;
    }

    const effective = effectiveDescriptors.get(prop.name) as EffectiveDescriptor;
    if ((prop.kind === 'getter') !== (effective !== 'data')) {
      // 後に書いた同じキーの宣言に置き換えられた（データ → アクセサ、アクセサ → データ）
      continue;
    }

    if (prop.kind === 'method') {
      // メソッドはパス補完には含めないが、検証用に登録
      paths.push({ path: prop.name, kind: 'method' });
      continue;
    }

    if (prop.kind === 'getter') {
      // computed getter / setter: "users.*.ageCategory" のようなパス。
      // get/set のペアは同じパスを 2 度宣言するので候補は 1 つに畳む。
      // `**` を含むキーは**深さの族**を表す再帰 getter（`nodes.**.total`）。具体パスの
      // 存在判定に要るので候補には載せるが、補完（＝ data-wcs へ書く候補）には出さない。
      if (!paths.some(p => p.path === prop.name)) {
        const recursive = hasRecursionWildcard(prop.name);
        const settable = !recursive && effective !== 'data' && effective.set;
        paths.push({ path: prop.name, kind: recursive ? 'recursive' : 'computed', ...(settable ? { settable } : {}) });
      }
      // `@returns {T}` が宣言する戻りの形（本体から読めた形は collectGetterResultShapes が足す）
      if (prop.declaredType !== undefined) pushDeclaredShapePaths(prop.name, prop.declaredType, paths, 0, typedefs);
      continue;
    }

    pushDataPropertyPaths(prop, paths, typedefs);
  }

  // $streams / $scan 宣言による値プロパティの実体化（processStreamsDeclaration §1-3 /
  // materializeScanOutputs 相当）。
  // ユーザーが同名プロパティを明示宣言している場合は上書きしない。
  for (const streamValue of pendingStreamValues) {
    // `$eventTokens` の名前（kind: 'eventToken'）は `eventToken.<prop>:` の右辺でパスではないので、同名でも実体化する
    if (paths.some(p => p.path === streamValue.name && p.kind !== 'eventToken')) continue;
    pushDataPropertyPaths(streamValue, paths, typedefs);
  }

  // $listKeys 宣言によるリストパスの実体化（processListKeysDeclaration §3 相当）。
  // $streams 実体化の後に走らせて、stream 由来のリストにキー宣言が付くケースも拾う。
  for (const listKeyEntry of pendingListKeys) {
    pushListKeyPaths(listKeyEntry, paths);
  }

  // $recursion 宣言による構造パスの実体化。宣言は「そのパスは再帰する木である」という
  // 作者の明示なので、初期値が `[]` で行の形が読めなくても `nodes` / `nodes.*` /
  // `nodes.*.children` / `nodes.*.children.*` は確定する（runtime の listPathsUpTo と同じ集合）。
  // アンカーのマーカーも候補に載せる — 深さを畳む照合（recursionPaths.matchesRecursion）が
  // 消費し、マウント接頭辞の付与も既存の配管に乗る。
  if (recursionSpec !== null) {
    if (!paths.some(p => p.path === recursionSpec.recursiveAnchor && p.kind === 'recursionAnchor')) {
      paths.push({ path: recursionSpec.recursiveAnchor, kind: 'recursionAnchor', repeat: recursionSpec.repeat });
    }
    for (const implied of impliedStructurePaths(recursionSpec)) {
      if (paths.some(p => p.path === implied.path)) continue;
      paths.push({ path: implied.path, kind: implied.kind, typeHint: implied.typeHint });
    }
  }

  // 行を足す / 置き換える代入式（`this.items = this.items.concat({ … })` 等）の行リテラルから
  // リスト行の形を補う。初期値が `[]` のリストは行フィールドが読めない（Issue #239）。
  // 明示宣言・$streams・$listKeys の候補が揃った後に走らせ、無いパスだけを足す。
  collectRowShapesFromAssignments(scriptContent, paths);

  // getter の戻り値の形（`get visible() { return this.todos.filter(…) }` の行、
  // `get summary() { return { total: … } }` の子）と、同じ読み方をした代入の右辺の形
  // （`this.rows = this.items.map(c => ({ … }))` の行、`this.errors = { date: "…" }` の子）。
  // 行の形が揃った後に走らせる — 写す元のリストの行が、上の代入式から分かることもあるため。
  collectGetterResultShapes(scriptContent, root.start, topLevelProps, effectiveDescriptors, paths);

  return paths;
}

/**
 * `$recursion` の値から仕様を組み立てる（形が完全に正しいときだけ返す）。
 *
 * ランタイム（recursion/declaration.ts `processRecursionDeclaration`）は「単一の自己再帰」
 * だけを受け付け、それ以外は raiseError で落とす。ここは**候補の実体化**用なので、
 * 落ちる形からは何も導出しない（壊れた宣言を静的側が追認しないため — `$listKeys` と同じ規約）。
 * 宣言の誤りそのものは recursionValidator が位置付きで報告する。
 */
function specFromRecursionValue(prop: PropertyInfo | undefined): RecursionSpec | null {
  if (!prop || prop.kind !== 'data' || !prop.value || !isObjectLiteral(prop.value)) return null;
  const entries = parseTopLevelProperties(extractObjectContent(prop.value)).filter(e => e.kind === 'data');
  if (entries.length !== 1) return null;
  const anchor = entries[0].name;
  const repeat = extractStringLiteralValue(entries[0].value);
  if (repeat === null) return null;
  if (checkNodePath(anchor) !== null || checkNodePath(repeat) !== null) return null;
  return makeRecursionSpec(anchor, repeat);
}

/** `$recursion` の 1 エントリ（キー ＝ アンカー・値 ＝ 反復サブパス）と、原文での位置。 */
export interface RecursionEntryInfo {
  /** アンカー（引用符を外した生の文字列。`nodes.*`）。 */
  readonly anchor: string;
  /** 反復サブパス。値が文字列リテラル（`${}` の無いテンプレートを含む）でなければ null（＝断定しない）。 */
  readonly repeat: string | null;
  /**
   * 値が「文字列ではない」と静的に断定できるか（数値・真偽値・null・オブジェクト / 配列 /
   * 関数リテラル・メソッド短縮記法）。識別子参照・呼び出し・`${}` 付きテンプレートは
   * 実行時まで分からないので false（validator は `repeat === null` でもこれが偽なら黙る）。
   */
  readonly repeatDefinitelyNotString: boolean;
  /** scriptContent 内でのキーの範囲（引用符は含まない）。 */
  readonly start: number;
  readonly end: number;
  /** 値の範囲（引用符を含む生テキストの範囲。値が無ければ start と同じ）。 */
  readonly valueStart: number;
  readonly valueEnd: number;
}

/** `$recursion` 宣言 1 個ぶんの静的な素性。 */
export interface RecursionDeclarationInfo {
  /** 宣言そのものの名前スパン（`$recursion` の位置）。 */
  readonly start: number;
  readonly end: number;
  /** 値がオブジェクトでないと断定できる（ランタイムは読み込み時に raiseError）。 */
  readonly notObject: boolean;
  /**
   * 値がオブジェクトリテラルだったか。`entries` が 0 件になる 2 つの原因
   * （`{}` と書かれた / 識別子参照で中身が読めない）を分ける。
   */
  readonly objectLiteral: boolean;
  readonly entries: readonly RecursionEntryInfo[];
  /** 形が完全に正しいときだけ設定される仕様。 */
  readonly spec: RecursionSpec | null;
}

/**
 * `$recursion: { "<anchor>": "<repeat>" }` を位置付きで抽出する。
 *
 * `analyzeWatchEntries` と同型（宣言そのものの妥当性を見る validator 用）。ランタイムは
 * この宣言を**初回マウントで**処理して raiseError するため、誤りはページごと止まる。
 * 静的に決まる形（アンカーの綴り・複数宣言・空宣言）はここで拾う。
 */
export function analyzeRecursionDeclaration(scriptContent: string): RecursionDeclarationInfo | null {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const prop = parseTopLevelProperties(root.content).find(p => p.name === RESERVED_RECURSION_KEY);
  if (!prop || prop.nameStart === undefined || prop.nameEnd === undefined) return null;

  const span = { start: root.start + prop.nameStart, end: root.start + prop.nameEnd };
  // メソッド短縮記法（`$recursion() {}`）と明白な非オブジェクトリテラルだけを断定する。
  // 識別子参照・呼び出し式は実行時までオブジェクトか分からないので疑わない。
  if (prop.kind === 'method') {
    return { ...span, notObject: true, objectLiteral: false, entries: [], spec: null };
  }
  if (prop.kind !== 'data' || !prop.value || prop.valueStart === undefined) {
    return { ...span, notObject: false, objectLiteral: false, entries: [], spec: null };
  }
  if (!isObjectLiteral(prop.value)) {
    const scan = maskCommentsAndStrings(prop.value).trim();
    const definite =
      /^(["'`])[^"'`]*\1$/.test(scan) ||
      /^-?\d[\w.]*$/.test(scan) ||
      /^(?:true|false|null)$/.test(scan) ||
      /^\[/.test(scan) ||
      /^(?:async\s+)?function\b[\s\S]*\}$/.test(scan) ||
      /^(?:async\s+)?\([^()]*\)\s*=>/.test(scan) ||
      /^(?:async\s+)?[$\w]+\s*=>/.test(scan);
    return { ...span, notObject: definite, objectLiteral: false, entries: [], spec: null };
  }

  // 計算キー（`{ ["nodes.*"]: … }`）や spread（`{ ...REC }`）を持つオブジェクトリテラルは、
  // エントリが静的に読めない ＝ 「空」とも「1 件」とも断定しない（識別子参照と同じ側）
  const objectContent = extractObjectContent(prop.value);
  if (hasUndecidableEntries(objectContent)) {
    return { ...span, notObject: false, objectLiteral: false, entries: [], spec: null };
  }
  // 値テキストの先頭空白ぶんだけ `{` がずれる。中身はその次から始まる。
  const leading = prop.value.length - prop.value.trimStart().length;
  const innerStart = root.start + prop.valueStart + leading + 1;
  const entries: RecursionEntryInfo[] = [];
  for (const entry of parseTopLevelProperties(objectContent)) {
    if (entry.nameStart === undefined || entry.nameEnd === undefined) continue;
    const valueStart = entry.valueStart === undefined
      ? innerStart + entry.nameEnd
      : innerStart + entry.valueStart + (entry.value ? entry.value.length - entry.value.trimStart().length : 0);
    entries.push({
      anchor: entry.name,
      repeat: entry.kind === 'data' ? extractStringLiteralValue(entry.value) : null,
      repeatDefinitelyNotString: entry.kind !== 'data' || isDefiniteNonStringLiteral(entry.value),
      start: innerStart + entry.nameStart,
      end: innerStart + entry.nameEnd,
      valueStart,
      valueEnd: valueStart + (entry.value?.trim().length ?? 0),
    });
  }
  return { ...span, notObject: false, objectLiteral: true, entries, spec: specFromRecursionValue(prop) };
}

/** `$watch` の 1 エントリ（キー ＝ 監視対象パス）と、原文での位置。 */
export interface WatchEntryInfo {
  /** 宣言キー。引用符を外した生の文字列（`items.*.price` など） */
  readonly key: string;
  /** scriptContent 内でのキーの範囲（引用符は含まない） */
  readonly start: number;
  readonly end: number;
  /**
   * 値が「関数ではないことが確実」か。識別子参照（`isLoading: onChange`）は
   * 静的には解決できないので false（＝疑わない）に倒す。
   */
  readonly definitelyNotFunction: boolean;
}

/**
 * `$watch: { "<path>": handler }` のエントリを位置付きで抽出する。
 *
 * `analyzeStatePaths` が `$watch` を「パスを作らない予約キー」として素通りするのに対し、
 * こちらは **宣言そのものの妥当性**（キーがパスとして成立するか）を見る validator 用。
 * `$watch` の失敗モードは一貫して「黙って発火しない」なので、キーのタイプミスを
 * 静的に拾えるかどうかが効く。
 */
export function analyzeWatchEntries(scriptContent: string): WatchEntryInfo[] {
  return analyzeObjectEntries(scriptContent, RESERVED_WATCH_KEY).map(entry => ({
    key: entry.key,
    start: entry.start,
    end: entry.end,
    // メソッド短縮記法は関数。data は値リテラルの形で判定し、識別子参照は疑わない。
    definitelyNotFunction: entry.kind === 'data' && isNonFunctionLiteral(entry.value),
  }));
}

/**
 * `$watch` のハンドラ 1 件の原文（`analyzeWatchHandlerSources`）。
 * `kind: 'body'` はメソッド短縮記法（`count() { … }`）の**本体**、
 * `kind: 'value'` は値に置いた式（`count: function (…) { … }` / アロー / 識別子参照）。
 */
export interface WatchHandlerSource {
  /** 宣言のキー（`$watch` ならパス、`$on` ならトークン名） */
  readonly name: string;
  readonly kind: 'body' | 'value';
  readonly text: string;
  /** `text` の先頭に対応する scriptContent 内のオフセット（trim しない生の位置）。 */
  readonly start: number;
}

/**
 * `$watch: { "<path>": handler }` のハンドラの原文を位置付きで返す。
 *
 * `$watch` のハンドラは宣言面の中にありながら、ランタイムが **`this` を state に束縛して**
 * 呼ぶ（`watch/watchRuntime.ts` の `entry.handler.call(state, …)`、ボリュームは
 * `webComponent/volume.ts` の chroot）。本体を読む検査（`wcs/declaration-alias-read`）が、
 * トップレベルの getter / メソッド（`analyzeCallableBodies`）に加えてここも走査するために使う。
 *
 * 位置は `analyzeCallableBodies` と同じ規約（trim しない生の値の開始）。`analyzeObjectEntries`
 * は data 値向けに先頭空白ぶんを進めるので、本体のオフセットには使えない。
 */
export function analyzeWatchHandlerSources(scriptContent: string): WatchHandlerSource[] {
  return analyzeHandlerSources(scriptContent, RESERVED_WATCH_KEY);
}

/**
 * `$on: { <token>: handler }` のハンドラの原文（位置の規約は analyzeWatchHandlerSources と同じ）。
 * ランタイムは `handler(state, event, …)` と呼ぶ — `this` は state ではない（`wcs/on-handler-this`）。
 */
export function analyzeOnHandlerSources(scriptContent: string): WatchHandlerSource[] {
  return analyzeHandlerSources(scriptContent, '$on');
}

function analyzeHandlerSources(scriptContent: string, key: string): WatchHandlerSource[] {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];
  const prop = parseTopLevelProperties(root.content).find(p => p.name === key);
  if (
    !prop || prop.kind !== 'data' || !prop.value ||
    !isObjectLiteral(prop.value) || prop.valueStart === undefined
  ) {
    return [];
  }
  // 値テキストの先頭空白ぶんだけ `{` がずれる。中身はその次から始まる。
  const leading = prop.value.length - prop.value.trimStart().length;
  const innerStart = root.start + prop.valueStart + leading + 1;

  const out: WatchHandlerSource[] = [];
  for (const entry of parseTopLevelProperties(extractObjectContent(prop.value))) {
    if (entry.value === undefined || entry.valueStart === undefined) continue;
    out.push({
      name: entry.name,
      kind: entry.kind === 'data' ? 'value' : 'body',
      text: entry.value,
      start: innerStart + entry.valueStart,
    });
  }
  return out;
}

/** `$listKeys` の 1 エントリ（キー ＝ リストパス）と、原文での位置。 */
export interface ListKeyEntryInfo {
  /** 宣言キー。引用符を外した生の文字列（`items` / `nodes.*.children` など） */
  readonly key: string;
  /** scriptContent 内でのキーの範囲（引用符は含まない） */
  readonly start: number;
  readonly end: number;
}

/**
 * `$listKeys: { "<listPath>": key }` のエントリを位置付きで抽出する。
 *
 * `analyzeStatePaths` はこの宣言から候補を**作る**側（pushListKeyPaths）で、ランタイムが
 * raise する形からは候補を作らない。こちらは宣言そのものの妥当性を報告する validator 用。
 */
export function analyzeListKeyEntries(scriptContent: string): ListKeyEntryInfo[] {
  return analyzeObjectEntries(scriptContent, RESERVED_LIST_KEYS_KEY)
    .map(entry => ({ key: entry.key, start: entry.start, end: entry.end }));
}

/**
 * トップレベル宣言 1 件の名前の範囲・種別・値（4.0 の設定の宣言 `$behavior` / `$features` の検証用）。
 * 位置はすべて scriptContent 相対。値と値の位置は data のときだけ（前後の空白を除いた形）。
 */
export interface TopLevelDeclaration {
  readonly name: string;
  readonly kind: 'data' | 'getter' | 'method';
  readonly start: number;
  readonly end: number;
  readonly value?: string;
  readonly valueStart?: number;
}

/** `export default { ... }` のトップレベルの `key` の宣言（無ければ null）。 */
export function findTopLevelDeclaration(scriptContent: string, key: string): TopLevelDeclaration | null {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const prop = parseTopLevelProperties(root.content).find(p => p.name === key);
  if (!prop || prop.nameStart === undefined || prop.nameEnd === undefined) return null;
  const base = { name: prop.name, kind: prop.kind, start: root.start + prop.nameStart, end: root.start + prop.nameEnd };
  if (prop.kind !== 'data' || prop.value === undefined || prop.valueStart === undefined) return base;
  const leading = prop.value.length - prop.value.trimStart().length;
  return { ...base, value: prop.value.trim(), valueStart: root.start + prop.valueStart + leading };
}

/**
 * トップレベルの `key: { … }` のエントリ（名前の範囲・種別・値）。値がオブジェクトリテラルでなければ空。
 * `$behavior` のキーと値の検証用（`$watch` / `$listKeys` と同じ切り出し）。
 */
export function analyzeDeclarationEntries(scriptContent: string, key: string): TopLevelDeclaration[] {
  return analyzeObjectEntries(scriptContent, key).map(entry => ({
    name: entry.key,
    kind: entry.kind,
    start: entry.start,
    end: entry.end,
    ...(entry.kind === 'data' && entry.value !== undefined && entry.valueStart !== undefined
      ? { value: entry.value.trim(), valueStart: entry.valueStart }
      : {}),
  }));
}

/** `export default { ... }` のオブジェクトリテラルが見つかるか（診断のゲート用）。 */
export function hasDefaultExportObject(scriptContent: string): boolean {
  return locateDefaultExportObject(scriptContent) !== null;
}

/**
 * `export default { ... }` の**トップレベル**に spread（`...expr`）があるか。
 *
 * spread は宣言を持ち込みうる（`...tree` の中に `$recursion` があるかもしれない）が、中身は
 * 静的に読めない。「そのオブジェクトリテラルに宣言が無い」と断定するゲートはこれを見て
 * 黙る側に倒す。入れ子（`nodes: [...rows]`）は数えない。
 */
export function hasTopLevelSpread(scriptContent: string): boolean {
  return findTopLevelSpread(scriptContent) !== null;
}

/**
 * The first top-level spread of `export default { ... }`: from its `...` to the end of the expression (before the
 * next top-level `,` or the closing `}`, trailing space excluded), script-relative. null when there is none.
 */
export function findTopLevelSpread(scriptContent: string): { start: number; end: number } | null {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const scan = maskCommentsAndStrings(root.content);
  let depth = 0;
  let start = -1;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0 && start < 0 && ch === '.' && scan.startsWith('...', i)) start = i;
    else if (depth === 0 && start >= 0 && ch === ',') return spreadRange(root.start, scan, start, i);
  }
  return start < 0 ? null : spreadRange(root.start, scan, start, scan.length);
}

function spreadRange(base: number, scan: string, start: number, stop: number): { start: number; end: number } {
  return { start: base + start, end: base + start + scan.slice(start, stop).trimEnd().length };
}

interface ObjectEntry {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly kind: PropertyInfo['kind'];
  readonly value?: string;
  /** 値テキスト（先頭空白を除く）の scriptContent 内での開始位置。値が無ければ undefined */
  readonly valueStart?: number;
}

/**
 * トップレベルの `<key>: { ... }` 宣言のエントリを位置付きで列挙する（`$watch` / `$listKeys`
 * が共有する形）。値がオブジェクトリテラルでない（識別子参照など）ときは空 ＝ 断定しない。
 */
function analyzeObjectEntries(scriptContent: string, key: string, allowEmptyKeys = false): ObjectEntry[] {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];

  const prop = parseTopLevelProperties(root.content).find(p => p.name === key);
  if (
    !prop || prop.kind !== 'data' || !prop.value ||
    !isObjectLiteral(prop.value) || prop.valueStart === undefined
  ) {
    return [];
  }

  // 値テキストの先頭空白ぶんだけ `{` がずれる。中身はその次から始まる。
  const leading = prop.value.length - prop.value.trimStart().length;
  const innerStart = root.start + prop.valueStart + leading + 1;

  const entries: ObjectEntry[] = [];
  for (const entry of parseTopLevelProperties(extractObjectContent(prop.value), allowEmptyKeys)) {
    if (entry.nameStart === undefined || entry.nameEnd === undefined) continue;
    entries.push({
      key: entry.name,
      start: innerStart + entry.nameStart,
      end: innerStart + entry.nameEnd,
      kind: entry.kind,
      value: entry.value,
      valueStart: entry.valueStart === undefined || entry.value === undefined
        ? undefined
        : innerStart + entry.valueStart + (entry.value.length - entry.value.trimStart().length),
    });
  }
  return entries;
}

/** トップレベル宣言 1 件の名前スパン（scriptContent 相対・引用符は含まない）。 */
export interface DeclarationSpan {
  readonly name: string;
  readonly kind: 'data' | 'getter' | 'method';
  readonly start: number;
  readonly end: number;
}

/**
 * `export default { ... }` のトップレベル宣言名を位置付きで列挙する。
 *
 * 参照インデックス（core/index/referenceIndex）の「宣言側」の正本。パスの
 * 第 1 セグメント（`user.name` → `user`）と、引用符付き getter のフルパス名
 * （`"users.*.ageCategory"`）がここに現れる。ネストしたオブジェクトの内側
 * （`user: { name: … }` の `name`）は列挙しない — go-to-definition はトップ
 * レベル宣言へのフォールバックで運用する（v1 の割り切り）。
 */
export function analyzeDeclarationSpans(scriptContent: string): DeclarationSpan[] {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];
  const out: DeclarationSpan[] = [];
  for (const prop of parseTopLevelProperties(root.content)) {
    if (prop.nameStart === undefined || prop.nameEnd === undefined) continue;
    out.push({
      name: prop.name,
      kind: prop.kind,
      start: root.start + prop.nameStart,
      end: root.start + prop.nameEnd,
    });
  }
  return out;
}

/** getter / メソッド宣言 1 個（名前スパン + 本体テキストと位置）。意味論検査が本体を読む。 */
export interface CallableBody {
  readonly name: string;
  readonly kind: 'getter' | 'method';
  /** 名前の範囲（script 内の絶対オフセット。診断のレンジに使う） */
  readonly start: number;
  readonly end: number;
  /** 本体（`{ ... }` の中身）の生テキスト */
  readonly body: string;
  /** 本体の開始オフセット（script 内の絶対位置。本体内のトークンのレンジ計算に使う） */
  readonly bodyStart: number;
  /** `kind: 'getter'` の get / set 種別（メソッドでは未設定）。 */
  readonly accessor?: 'get' | 'set';
}

/**
 * `export default { ... }` のトップレベル getter / メソッドを、名前スパンと本体付きで返す。
 *
 * `analyzeDeclarationSpans` は名前しか返さないため、本体を読む検査
 * （`wcs/getter-cycle` / `wcs/updated-callback-unbound`）はこちらを使う。
 * set 側は `kind: 'getter'` に含まれる（本体の形が同じなので同列に扱ってよい）。
 */
export function analyzeCallableBodies(scriptContent: string): CallableBody[] {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];
  const out: CallableBody[] = [];
  for (const prop of parseTopLevelProperties(root.content)) {
    if (prop.kind !== 'getter' && prop.kind !== 'method') continue;
    if (prop.nameStart === undefined || prop.nameEnd === undefined) continue;
    out.push({
      name: prop.name,
      kind: prop.kind,
      start: root.start + prop.nameStart,
      end: root.start + prop.nameEnd,
      body: prop.value ?? '',
      bodyStart: root.start + (prop.valueStart ?? 0),
      accessor: prop.accessor,
    });
  }
  return out;
}

/**
 * 値が「関数ではない」と静的に断定できるリテラルか。
 *
 * 断定できる場合だけ true を返す（誤検出を出さないほうを優先する）。識別子参照・
 * 呼び出し式・条件式などは「分からない」＝ false に倒す。
 */
function isNonFunctionLiteral(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // 関数の形（function 宣言 / アロー）が見えるなら明確に関数
  const scan = maskCommentsAndStrings(trimmed);
  if (/^(?:async\s+)?function\b/.test(trimmed) || scan.includes('=>')) return false;
  // 明らかな非関数リテラルだけを拾う
  return (
    /^["'`]/.test(trimmed) ||
    /^-?\d/.test(trimmed) ||
    /^(?:true|false|null|undefined)\b/.test(trimmed) ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('{')
  );
}

/**
 * `$watch` の宣言が「オブジェクトでない」とランタイム同様に**断定できる**場合に
 * その名前スパンを返す（該当なしは null）。
 *
 * ランタイム（@wcstack/state watch/processWatchDeclaration.ts）は
 * `typeof declared !== "object" || declared === null` で raiseError する。静的に
 * 断定できるのは:
 * - メソッド短縮記法 `$watch() {}`（値は関数 = 非オブジェクト）
 * - 明白な非オブジェクトリテラル（文字列・数値・真偽値・null・関数/アロー式）
 *
 * 断定しないもの（誤検出回避）: 識別子参照・呼び出し式（実行時までオブジェクトか
 * 不明）、配列リテラル（typeof は "object" なのでランタイムは通す）、
 * `undefined`（ランタイムは宣言なし扱いで早期 return）、getter（評価結果は不明）。
 */
export function findNonObjectWatch(scriptContent: string): { start: number; end: number } | null {
  return findNonObjectDeclaration(scriptContent, RESERVED_WATCH_KEY);
}

function findNonObjectDeclaration(
  scriptContent: string,
  key: string,
): { start: number; end: number } | null {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const declarationProp = parseTopLevelProperties(root.content).find(p => p.name === key);
  if (!declarationProp || declarationProp.nameStart === undefined || declarationProp.nameEnd === undefined) {
    return null;
  }
  const span = { start: root.start + declarationProp.nameStart, end: root.start + declarationProp.nameEnd };
  if (declarationProp.kind === 'method') {
    return span;
  }
  if (declarationProp.kind !== 'data' || !declarationProp.value) return null;
  const trimmed = declarationProp.value.trim();
  if (trimmed.startsWith('{')) return null;
  const scan = maskCommentsAndStrings(trimmed).trim();
  // 値そのものがアロー関数（`(a, b) => ...` / `a => ...`）。呼び出し式・IIFE
  // （`make(() => 1)` / `(() => ({}))()` 等）は値の型を決めないため対象外 —
  // パラメータリストに括弧を含まない素直な形だけを断定する（fold to unknown）。
  // アロー本体は値の末尾まで届くため、こちらは prefix 判定でよい。
  const isArrowFunction =
    /^(?:async\s+)?\([^()]*\)\s*=>/.test(scan) ||
    /^(?:async\s+)?[$\w]+\s*=>/.test(scan);
  // リテラル断定は **値全体がそのリテラルである**ことを要求する。先頭トークンだけ
  // 見ると `true && {…}` / `null ?? {…}` / `"x" ? a : b` のような、実行時には
  // オブジェクトになりうる式を誤って断定する（fold to unknown）。文字列は
  // マスク済み鏡像（引用符は残り中身が空白化される）上で単一リテラルのみ照合。
  const isWholeLiteral =
    /^(["'`])[^"'`]*\1$/.test(scan) ||
    /^-?\d[\w.]*$/.test(scan) ||
    /^(?:true|false|null)$/.test(scan) ||
    /^(?:async\s+)?function\b[\s\S]*\}$/.test(scan);
  if (!isArrowFunction && !isWholeLiteral) return null;
  return span;
}

/**
 * トップレベルの `$` 予約キーから、バインディングで使える派生パス候補を導出する。
 *
 * - `$streams: { <name>: { initial?, ... } }` → 値プロパティ `<name>`（実体化・後処理）＋
 *   `$streamStatus.<name>` / `$streamError.<name>`（読み取り専用名前空間パス）
 * - `$scan: { <output>: { initial?, ... } }` → 値プロパティ `<output>`（実体化・後処理）
 * - `$commandTokens: ["a", ...]` → `$command.<a>`（kind: 'command'）
 * - `$eventTokens: ["a", ...]` → `<a>`（kind: 'eventToken'）
 * - `$listKeys: { "<listPath>": "<field>" }` → `<listPath>` / `<listPath>.*` /
 *   `<listPath>.length` ＋ 文字列キー指定なら `<listPath>.*.<field>`（実体化・後処理）
 * - その他（`$on` / `$bindables` / ライフサイクル等）→ 候補なし
 */
function collectReservedKeyPaths(
  prop: PropertyInfo,
  paths: PathCandidate[],
  pendingStreamValues: PropertyInfo[],
  pendingListKeys: PropertyInfo[],
): void {
  if (RESERVED_STREAMS_KEYS.has(prop.name) && prop.kind === 'data' && prop.value && isObjectLiteral(prop.value)) {
    const entries = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const entry of entries) {
      // ストリーム名はフラットなプロパティ名のみ（`$` 始まりはランタイムが拒否）
      if (entry.kind !== 'data' || entry.name.startsWith('$')) continue;
      const initial = entry.value && isObjectLiteral(entry.value)
        ? findStreamInitialProperty(entry.value)
        : undefined;
      pendingStreamValues.push({
        name: entry.name,
        kind: 'data',
        value: initial?.value,
        typeHint: initial?.typeHint,
      });
      paths.push({ path: `$streamStatus.${entry.name}`, kind: 'data', typeHint: 'string' });
      paths.push({ path: `$streamError.${entry.name}`, kind: 'data' });
    }
    return;
  }

  if (prop.name === RESERVED_SCAN_KEY && prop.kind === 'data' && prop.value && isObjectLiteral(prop.value)) {
    // 空の出力名も拾ってから捨てる（拾わないと `"": { from: … }` の `from` などを出力名と誤読する）
    for (const entry of parseTopLevelProperties(extractObjectContent(prop.value), true)) {
      // 出力名は平坦なプロパティ名のみ（ランタイムは `.` / `*` / `$` 始まりを拒否する）。
      // 壊れた宣言からは候補を作らない（$listKeys と同じ規約 — 誤りは validator が報告する）。
      if (entry.kind !== 'data' || !isFlatScanOutputName(entry.name)) continue;
      const initial = entry.value && isObjectLiteral(entry.value)
        ? findStreamInitialProperty(entry.value)
        : undefined;
      pendingStreamValues.push({
        name: entry.name,
        kind: 'data',
        value: initial?.value,
        typeHint: initial?.typeHint,
      });
    }
    return;
  }

  if (prop.name === RESERVED_COMMAND_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: `$command.${name}`, kind: 'command' });
    }
    return;
  }

  if (prop.name === RESERVED_EVENT_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: name, kind: 'eventToken' });
    }
    return;
  }

  if (prop.name === RESERVED_LIST_KEYS_KEY && prop.kind === 'data' && prop.value && isObjectLiteral(prop.value)) {
    for (const entry of parseTopLevelProperties(extractObjectContent(prop.value))) {
      if (entry.kind !== 'data') continue;
      pendingListKeys.push(entry);
    }
    return;
  }
}

/**
 * `$listKeys: { "<listPath>": "<field>" | (row) => ... }` の1エントリからパス候補を導出する。
 *
 * 宣言は「そのパスはキーで同一性を判定するリストである」という作者の明示なので、初期値が
 * 空配列（`items: []`）で要素の形が読めないケースでも `<listPath>.*` 系を補完・検証に出せる。
 * 文字列キー指定なら行のキーフィールド（`<listPath>.*.<field>`）も確定する。
 * 既存候補（明示宣言・`$streams` 実体化）があるパスは上書きしない。
 *
 * ランタイム（@wcstack/state list/listKeys.ts processListKeysDeclaration §3.1）が
 * raiseError で弾く形の宣言 — 空パス / 空セグメント / 末尾 `*` / `.` `*` を含むキー
 * フィールド名 — からは候補を作らない。壊れた宣言を静的側が追認しないため。
 */
function pushListKeyPaths(entry: PropertyInfo, paths: PathCandidate[]): void {
  const listPath = entry.name;
  const segments = listPath.split('.');
  if (listPath.length === 0 || segments.some(s => s.length === 0) || segments[segments.length - 1] === '*') {
    return;
  }
  // `**` は `$listKeys` の消費者ではない（ランタイムは getPathInfo の不変条件で throw する）。
  // 候補を作ると `**` 入りのパスがデータパスとして候補集合に紛れるので、ここでは何もしない。
  if (hasRecursionWildcard(listPath)) {
    return;
  }
  const has = (path: string): boolean => paths.some(p => p.path === path);

  if (!has(listPath)) paths.push({ path: listPath, kind: 'data', typeHint: 'array' });
  if (!has(`${listPath}.*`)) paths.push({ path: `${listPath}.*`, kind: 'list' });
  if (!has(`${listPath}.length`)) {
    paths.push({ path: `${listPath}.length`, kind: 'data', typeHint: 'number' });
  }

  const keyField = extractStringLiteralValue(entry.value);
  if (keyField === null || keyField.includes('.') || keyField.includes('*')) return;
  if (!has(`${listPath}.*.${keyField}`)) {
    paths.push({ path: `${listPath}.*.${keyField}`, kind: 'data' });
  }
}

/** 値が単一の文字列リテラルならその中身を返す（`$listKeys` のキーフィールド名用）。 */
function extractStringLiteralValue(value: string | undefined): string | null {
  if (!value) return null;
  // `${}` の無いテンプレートリテラルも文字列（ランタイムはただの string として受け取る）
  const match = value.trim().match(/^(?:["']([^"'\\]*)["']|`([^`\\$]*)`)$/);
  const literal = match ? (match[1] ?? match[2]) : null;
  return literal !== null && literal !== undefined && literal.length > 0 ? literal : null;
}

/**
 * オブジェクトリテラルの中身に、トップレベルの計算キー（`[expr]:`）か spread（`...expr`）が
 * あるか。どちらも `parseTopLevelProperties` が拾えない（エントリが 0 件に見える）ので、
 * 「空」と断定する前にここで見る。文字列の中身は見ない。
 */
function hasUndecidableEntries(objectContent: string): boolean {
  const scan = maskCommentsAndStrings(objectContent);
  let depth = 0;
  let atKey = true;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0 && atKey && (ch === '[' || scan.startsWith('...', i))) return true;
      depth++;
      atKey = false;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === ',') { atKey = true; continue; }
    if (/\s/.test(ch)) continue;
    if (atKey && scan.startsWith('...', i)) return true;
    atKey = false;
  }
  return false;
}

/**
 * 値が「文字列ではない」と静的に断定できるリテラルか（数値・真偽値・null・オブジェクト /
 * 配列 / 関数 / アロー）。識別子参照・呼び出し・`${}` 付きテンプレートは false。
 */
function isDefiniteNonStringLiteral(value: string | undefined): boolean {
  if (!value) return false;
  const scan = maskCommentsAndStrings(value).trim();
  if (scan.length === 0) return false;
  return (
    /^-?\d[\w.]*$/.test(scan) ||
    /^(?:true|false|null)$/.test(scan) ||
    /^[[{]/.test(scan) ||
    /^(?:async\s+)?function\b/.test(scan) ||
    /^(?:async\s+)?\([^()]*\)\s*=>/.test(scan) ||
    /^(?:async\s+)?[$\w]+\s*=>/.test(scan)
  );
}

// ============================================================
// 代入式の行リテラルから導出する行の形（Issue #239）
// ============================================================

/**
 * 「行を足す / 置き換える」代入式を捕捉する。
 *
 * 左辺: `this.<ident>` または `this["<dotted path>"]` への単純代入（`=` のみ。`==` / `=>` と
 * 複合代入は除外）。右辺は次のどちらか:
 * - 配列リテラルで始まる（`[...this.items, { … }]` / `[{ … }, ...this.items]`）→ group 3 = `[`
 * - `.concat(` / `.toSpliced(` / `.with(` の呼び出しを含む → group 4 = `(`
 *   代入から呼び出しまでの区間は `;` `=` `{` `}` を跨がない（別の文・別のブロックへ
 *   流れ込まない）。アロー `=>` だけは許容し `filter(r => r.ok).concat({ … })` を通す。
 *
 * マスク済み鏡像で走査するため引用符付きパス（group 2）は中身が空白 — 呼び出し側が
 * `d` フラグの indices で原文から取り直す。
 */
const ROW_ASSIGN = new RegExp(
  String.raw`\bthis\s*(?:\.\s*([$\w]+)|\[\s*["']([^"']+)["']\s*\])\s*=(?![=>])\s*(?:(\[)|(?:[^;={}]|=>)*?\.\s*(?:concat|toSpliced|with)\s*(\())`,
  'gd',
);

/**
 * メソッド本体などに現れる「行を足す / 置き換える」代入式の行リテラルから、リスト行の
 * フィールド候補（`<list>.*.<field>` とその子）を導出する。
 *
 * `this.items = this.items.concat({ id: newId(), kind: "general" })` の形は、初期値と
 * 同じ確度で行の形を宣言している。初期値が `[]` のリストではこれが唯一の手掛かりで、
 * これが無いと `for` 行内の `.kind` が `wcs/binding-path-missing` になる（Issue #239）。
 *
 * 規則:
 * - 対象は **既にリストと分かっているパス**（`<path>.*` が候補にある）だけ。宣言の無い
 *   パスをここで新設しない。`$` ルート（API 名前空間）と `*` 入りパスは対象外。
 * - 行リテラルは呼び出しの引数（`concat({ … })` / `toSpliced(i, n, { … })` / `with(i, { … })`）、
 *   引数の配列リテラルの要素（`concat([{ … }])`）、右辺の配列リテラルの要素。識別子で渡された
 *   行（`concat(row)`）は読めない（fold to unknown）。
 * - 短縮プロパティ（`{ id, kind }`）も名前だけ拾う。スプレッド（`...r`）・算出キーは無視。
 * - 既存候補は上書きしない（明示宣言 > `$streams` > `$listKeys` > ここ）。型ヒントは
 *   リテラル値から推定するが、初期値ではないので `rawInitial` は付けない。
 * - script 全体を走査する（getter / setter / `$connectedCallback` / `$watch` ハンドラ /
 *   モジュール直下の関数も対象）。コメント・文字列の中は鏡像で潰れているので拾わない。
 */
function collectRowShapesFromAssignments(script: string, paths: PathCandidate[]): void {
  const scan = maskCommentsAndStrings(script);
  ROW_ASSIGN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ROW_ASSIGN.exec(scan)) !== null) {
    const span = match.indices![1] ?? match.indices![2];
    const listPath = script.slice(span[0], span[1]);
    if (listPath.startsWith('$') || listPath.includes('*') || !hasPath(paths, `${listPath}.*`)) continue;

    const openIndex = match.index + match[0].length - 1;
    const isArrayLiteral = scan[openIndex] === '[';
    const inner = extractDelimitedContent(script, scan, openIndex, scan[openIndex], isArrayLiteral ? ']' : ')');
    // 右辺の配列リテラルは要素だけ（配列の配列は行ではない）。呼び出し引数は
    // 配列リテラル 1 段の中も見る（`concat([{ … }])`）。
    for (const literal of collectRowLiterals(inner, isArrayLiteral ? 0 : 1)) {
      for (const field of extractRowLiteralFields(literal)) {
        pushRowFieldPaths(`${listPath}.*.${field.name}`, field, paths, 1);
      }
    }
  }
}

/** 要素列（引数列）からオブジェクトリテラルを集める。`arrayDepth` 段までは配列リテラルの中も見る。 */
function collectRowLiterals(elementList: string, arrayDepth: number): string[] {
  const out: string[] = [];
  for (const element of splitTopLevelElements(elementList)) {
    if (element.startsWith('{')) {
      out.push(element);
    } else if (element.startsWith('[') && arrayDepth > 0) {
      const scan = maskCommentsAndStrings(element);
      out.push(...collectRowLiterals(extractDelimitedContent(element, scan, 0, '[', ']'), arrayDepth - 1));
    }
  }
  return out;
}

/**
 * 行リテラル 1 個のデータフィールドを返す。`name: value` 形は parseTopLevelProperties、
 * 短縮形（`{ id, kind }`）は要素分割で補う。メソッド / getter / スプレッド / 算出キーは対象外。
 */
function extractRowLiteralFields(literal: string): PropertyInfo[] {
  const content = extractObjectContent(literal);
  const fields = parseTopLevelProperties(content).filter(p => p.kind === 'data');
  for (const element of splitTopLevelElements(content)) {
    const shorthand = /^([$\w]+)$/.exec(element);
    if (shorthand && !fields.some(f => f.name === shorthand[1])) {
      fields.push({ name: shorthand[1], kind: 'data' });
    }
  }
  return fields;
}

/**
 * 行フィールド 1 個分の候補を、既存候補を上書きせずに追加する（pushDataPropertyPathsAt の
 * 「無いものだけ足す・rawInitial なし」版）。値が配列 / オブジェクトリテラルなら子へ再帰。
 */
function pushRowFieldPaths(path: string, prop: PropertyInfo, paths: PathCandidate[], depth: number): void {
  if (!hasPath(paths, path)) paths.push(withHint({ path, kind: 'data' }, prop.typeHint));
  if (!prop.value) return;

  if (isArrayLiteral(prop.value)) {
    if (!hasPath(paths, `${path}.*`)) paths.push({ path: `${path}.*`, kind: 'list' });
    if (!hasPath(paths, `${path}.length`)) {
      paths.push({ path: `${path}.length`, kind: 'data', typeHint: 'number' });
    }
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    for (const child of extractArrayElementDataProperties(prop.value)) {
      pushRowFieldPaths(`${path}.*.${child.name}`, child, paths, depth + 1);
    }
    return;
  }

  if (isObjectLiteral(prop.value)) {
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    for (const child of parseTopLevelProperties(extractObjectContent(prop.value))) {
      if (child.kind !== 'data') continue;
      pushRowFieldPaths(`${path}.${child.name}`, child, paths, depth + 1);
    }
  }
}

// ============================================================
// getter の戻り値から導く形
// ============================================================

/**
 * getter の戻り値の形。`mirrors` は既知のパスの下を写す元（`from` の下の候補を、結果の
 * `to` ── `''` なら結果そのもの、`'.*'` なら結果の行 ── の下へ写す）、`fields` はリテラル
 * から読んだフィールド（`to` は同じく結果からの相対）。`isList` は結果がリストか。
 */
interface ResultShape {
  isList: boolean;
  mirrors: { from: string; to: '' | '.*' }[];
  fields: ResultField[];
  /**
   * 元の形が分からない（モジュールの定数・関数の結果・`this.$getAll(…)`）。連鎖の `map` が
   * リテラルを返せば行の形が分かる。最後まで分からなければ読めない式（null）として落ちる。
   */
  opaque?: boolean;
}

/**
 * A field of a result's literal. `shape` is the shape of its value when that is a name the analyzer read in the same
 * function — `{ id, days }` with `const days = list.map((d) => ({ dayText }))` gives `days` its rows.
 */
interface ResultField {
  to: '' | '.*';
  field: PropertyInfo;
  shape?: ResultShape;
}

/** The fields of an object literal, with the shape of a value that names an alias (`{ days }`, `{ list: days }`). */
function literalFields(literal: string, to: '' | '.*', aliases: ReadonlyMap<string, ResultShape>): ResultField[] {
  return extractRowLiteralFields(literal).map((field) => {
    const name = field.value === undefined ? field.name : /^\s*([$A-Za-z_][$\w]*)\s*$/.exec(field.value)?.[1];
    const shape = name === undefined ? undefined : aliases.get(name);
    return shape === undefined ? { to, field } : { to, field, shape };
  });
}

/** 行を保ったまま並べ替え・絞り込み・切り出す配列メソッド（結果の行は元の行そのもの）。 */
const ROW_PRESERVING_METHODS: ReadonlySet<string> = new Set([
  'filter', 'toSorted', 'toReversed', 'slice', 'toSpliced', 'concat', 'with', 'sort', 'reverse',
]);
/** 行を 1 つ返す配列メソッド。 */
const ROW_PICKING_METHODS: ReadonlySet<string> = new Set(['find', 'findLast', 'at']);
/** 依存する getter の形が後から分かることがあるので、追加が止まるまで繰り返す回数の上限。 */
const MAX_GETTER_SHAPE_PASSES = 4;

/**
 * getter の戻り値から、その下のパス候補を導く。
 *
 * `for:` はフィルタを取らないので、絞り込んだリストは getter で返して回すのが正しい書き方
 * （ランタイムの `#121` もそう案内する）。ところが getter の行の形は宣言のどこにも無いので、
 * `for: visible` の行の `.text` が `wcs/binding-path-missing` の偽陽性になっていた。
 *
 * 戻り値の式（`return` の後ろ・`const list = …` の別名を通したもの）を読む:
 * - `this.todos` / `this["groups.*.items"]` と、行を保つメソッドの連鎖（`filter` / `toSorted` /
 *   `slice` …）・`[...this.todos]` → 元のリストの下を写す（`visible.*.text` ← `todos.*.text`）
 * - `find` / `findLast` / `at` → 元の行の下を写す（`selected.name` ← `items.*.name`）
 * - `map(t => ({ … }))` → リテラルのフィールドが行になる（`...t` があれば元の行も写す）。元が state の外
 *   （`PERMS.map(…)`・`Object.entries(…).map(([k, v]) => ({ … }))`・`this.$getAll(…).map(…)`）でも、
 *   行の形はリテラルから分かる
 * - オブジェクトリテラル（`return { total: … }`）→ そのフィールド
 * - 三項演算子・`||` / `??` は両辺の和
 *
 * 写すのは**データの形**（data / list 候補）だけ。元のリストのパス getter（`todos.*.upper`）は
 * `todos.*` のパターンに付くもので、getter が返した行（`visible.0`）にはプロパティが無い ──
 * `visible.*.upper` はランタイムで undefined なので、候補にしない（警告が正しい）。
 * 読めない式（関数呼び出しの結果など）からは何も導かない（今までどおり）。
 *
 * 代入（`this.<key> = …` / `this["<path>"] = …`、スクリプトのどこでも）の右辺も同じ読み方をする
 * （collectAssignments）。メソッドで行を作り直す `this.rows = [...this.items].map((c) => ({ … }))`・
 * `this.rows = this.items.filter(Boolean).map((c) => { return { … }; })` の行と、
 * `{}` を種にしたキーへの `this.fieldErrors = { date: "…" }` のキーは、getter の戻り値と同じ確度で形を言っている
 * （継ぎ目アプリ family-ledger — 作者は 22 件の誤報をすべて書き換えて消した）。
 */
function collectGetterResultShapes(
  script: string,
  rootStart: number,
  props: readonly PropertyInfo[],
  effective: Map<string, EffectiveDescriptor>,
  paths: PathCandidate[],
): void {
  // 同じキーの get を 2 度書いたら後のものが勝つ
  const getters = new Map<string, PropertyInfo>();
  for (const prop of props) {
    if (prop.kind !== 'getter' || prop.accessor !== 'get' || prop.value === undefined) continue;
    if (prop.name.startsWith('$') || hasRecursionWildcard(prop.name) || effective.get(prop.name) === 'data') continue;
    getters.set(prop.name, prop);
  }
  const assignments = collectAssignments(script, rootStart, props);
  for (let pass = 0; pass < MAX_GETTER_SHAPE_PASSES; pass++) {
    const before = paths.length;
    for (const [name, prop] of getters) {
      const shape = getterResultShape(prop.value as string, paths);
      if (shape !== null) applyResultShape(name, shape, paths);
    }
    // 別名は候補に依って形が変わるので、パスごとに読み直す（同じ本体は 1 回）
    const aliasesByBody = new Map<string, Map<string, ResultShape>>();
    for (const assignment of assignments) {
      let aliases = new Map<string, ResultShape>();
      if (assignment.body !== null) {
        aliases = aliasesByBody.get(assignment.body) ?? collectAliases(assignment.body, paths);
        aliasesByBody.set(assignment.body, aliases);
      }
      const shape = expressionShape(assignment.expr, paths, aliases);
      if (shape !== null) applyAssignedShape(assignment.target, shape, paths);
    }
    if (paths.length === before) break;
  }
}

/**
 * getter 本体の `return` 式すべての形の和。読める式が 1 つも無ければ null。
 * 本体そのものの `return` だけを読む — 入れ子の関数（`map` のコールバック）の `return { … }` は getter の戻り値ではない
 * （city-library の継ぎ目アプリ: 内側のコールバックの `return { dayText }` を getter の形と読んでいた）。
 */
function getterResultShape(body: string, paths: PathCandidate[]): ResultShape | null {
  const scan = maskCommentsAndStrings(body);
  const aliases = collectAliases(body, paths);
  const shapes: ResultShape[] = [];
  for (const start of ownReturnEnds(scan)) {
    const shape = expressionShape(readExpression(body, scan, start), paths, aliases);
    if (shape !== null) shapes.push(shape);
  }
  return shapes.length === 0 ? null : mergeShapes(shapes);
}

/** Keywords whose `(…)` is followed by a block, not a function body (`if (x) {`, `catch (e) {`). */
const BLOCK_HEADS: ReadonlySet<string> = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/**
 * The offsets just after each `return` keyword of a function body itself (the masked text of its `{ … }` content), not
 * of a function nested in it: a `{` after `=>`, or after the `)` of a parameter list (`function (d) {`, `m(d) {`), opens
 * a nested function's body, whose returns are its own; a `{` after `if (…)` / `else` / `try` / an object literal does
 * not.
 */
function ownReturnEnds(scan: string): number[] {
  const out: number[] = [];
  // per open brace: whether it opens a nested function's body
  const stack: boolean[] = [];
  let nested = 0;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '{') {
      const opens = opensFunctionBody(scan, i);
      stack.push(opens);
      if (opens) nested++;
    } else if (ch === '}') {
      if (stack.pop() === true) nested--;
    } else if (nested === 0 && ch === 'r' && /^return\b/.test(scan.slice(i, i + 7)) && !/[\w$.]/.test(scan[i - 1] ?? '')) {
      out.push(i + 6);
      i += 5;
    }
  }
  return out;
}

/** Whether the `{` at `at` opens a function body (see ownReturnEnds). */
function opensFunctionBody(scan: string, at: number): boolean {
  let end = at - 1;
  while (end >= 0 && /\s/.test(scan[end])) end--;
  if (end >= 1 && scan[end] === '>' && scan[end - 1] === '=') return true;
  if (scan[end] !== ')') return false;
  // the `(` that matches, and the word before it: a block head, or a function's name / `function`
  let depth = 0;
  let i = end;
  for (; i >= 0; i--) {
    if (scan[i] === ')') depth++;
    else if (scan[i] === '(' && --depth === 0) break;
  }
  let wordEnd = i - 1;
  while (wordEnd >= 0 && /\s/.test(scan[wordEnd])) wordEnd--;
  let wordStart = wordEnd;
  while (wordStart >= 0 && /[$\w]/.test(scan[wordStart])) wordStart--;
  const head = scan.slice(wordStart + 1, wordEnd + 1);
  return !BLOCK_HEADS.has(head);
}

/** 本体の `const list = this.products.filter(…)` の別名（最初の宣言が勝つ）。 */
function collectAliases(body: string, paths: PathCandidate[]): Map<string, ResultShape> {
  const scan = maskCommentsAndStrings(body);
  const aliases = new Map<string, ResultShape>();
  for (const m of scan.matchAll(/\b(?:const|let|var)\s+([$\w]+)\s*=(?![=>])/g)) {
    const name = m[1];
    if (aliases.has(name)) continue;
    const start = (m.index as number) + m[0].length;
    const shape = expressionShape(readExpression(body, scan, start), paths, aliases);
    if (shape !== null) aliases.set(name, shape);
  }
  return aliases;
}

/**
 * `this.<key> = …` / `this["<path>"] = …` の単純代入（`=` だけ。`==` / `=>` と複合代入は除く。
 * `this.a.b = …` は `=` の前にもう 1 段あるので当たらない — 素のプロパティ書き込みは wcs/nested-assign の担当）。
 * マスク済み鏡像で走査するので、引用符付きパス（group 2）は `d` フラグの indices で原文から取り直す。
 */
const PLAIN_ASSIGN = new RegExp(String.raw`\bthis\s*(?:\.\s*([$\w]+)|\[\s*["']([^"']+)["']\s*\])\s*=(?![=>])`, 'gd');

/** 代入 1 件: 書き込む先のパス・右辺の式・それを囲むトップレベルの getter / メソッドの本体（別名を引く）。 */
interface Assignment {
  readonly target: string;
  readonly expr: string;
  readonly body: string | null;
}

/** スクリプトのどこかにある `this.<key> = <式>` を集める（`$` ルート・`*` 入りのパスは除く）。 */
function collectAssignments(script: string, rootStart: number, props: readonly PropertyInfo[]): Assignment[] {
  const scan = maskCommentsAndStrings(script);
  const bodies = props
    .filter(p => (p.kind === 'getter' || p.kind === 'method') && p.value !== undefined && p.valueStart !== undefined)
    .map(p => ({ start: rootStart + (p.valueStart as number), body: p.value as string }));
  const out: Assignment[] = [];
  PLAIN_ASSIGN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAIN_ASSIGN.exec(scan)) !== null) {
    // `other.this.x = …` は state への書き込みではない
    if (/\.\s*$/.test(scan.slice(Math.max(0, match.index - 8), match.index))) continue;
    const span = match.indices![1] ?? match.indices![2];
    const target = script.slice(span[0], span[1]);
    if (target.startsWith('$') || target.includes('*')) continue;
    const expr = readExpression(script, scan, match.index + match[0].length);
    const owner = bodies.find(b => b.start <= match!.index && match!.index < b.start + b.body.length);
    out.push({ target, expr, body: owner?.body ?? null });
  }
  return out;
}

/**
 * 代入の右辺の形を、書き込む先に足す。新しいパスは作らない — 先がデータ（getter の setter へ
 * 書く代入は getter の形を言わない）で、**既にリストと分かっている**（`<path>.*` が候補にある）なら
 * 右辺のリストの行を、**オブジェクトリテラルを種にしている**なら右辺のオブジェクトのキーを足す
 * （種のキーとの和）。`null` を種にしたキーや、形の食い違う右辺（リストへオブジェクト）からは何も足さない。
 *
 * 右辺のオブジェクトリテラルの spread（`{ ...noErrors(), ...parse(e) }`）は追わない — 行リテラルと同じ規則で、
 * 名前の書かれたキーだけが形になる。候補の集合に「開いた形」は無く（`data: make()` の下は今も
 * 「存在しない」）、spread が持ち込むキーへの束縛は今までどおり warning のまま残る。
 */
function applyAssignedShape(target: string, shape: ResultShape, paths: PathCandidate[]): void {
  const declared = paths.find(p => p.path === target);
  if (declared === undefined || declared.kind !== 'data') return;
  if (hasPath(paths, `${target}.*`)) {
    if (shape.isList) applyResultShape(target, shape, paths);
    return;
  }
  if (!shape.isList && declared.rawInitial !== undefined && isObjectLiteral(declared.rawInitial)) {
    applyResultShape(target, shape, paths);
  }
}

/**
 * `start` から式 1 つ分の原文を切り出す。深さ 0 の `;` / `,` / 閉じ括弧で止まり、深さ 0 の改行では、
 * 次の行が `.` / `?` / `:` / `|` / `&` で始まるか、行末が演算子で終わるとき（連鎖・三項の継続）だけ続ける。
 */
function readExpression(text: string, scan: string, start: number): string {
  let depth = 0;
  let i = start;
  for (; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (ch === ';' || ch === ',')) break;
    else if (depth === 0 && ch === '\n') {
      const before = scan.slice(start, i).trimEnd();
      const after = scan.slice(i + 1).trimStart();
      if (before === '') continue;
      if (!/[.?:|&+\-*/=(,]$/.test(before) && !/^[.?:|&]/.test(after)) break;
    }
  }
  return text.slice(start, i).trim();
}

/** 式の形。読めなければ null。 */
function expressionShape(text: string, paths: PathCandidate[], aliases: Map<string, ResultShape>): ResultShape | null {
  const expr = stripWrappingParens(text.trim());
  if (expr === '') return null;
  const scan = maskCommentsAndStrings(expr);

  // 三項演算子（深さ 0 の `?` … `:`）・`||` / `??` は両辺の和
  const ternary = splitTernary(scan);
  if (ternary !== null) {
    const branches = [expr.slice(ternary[0] + 1, ternary[1]), expr.slice(ternary[1] + 1)]
      .map(part => expressionShape(part, paths, aliases))
      .filter((s): s is ResultShape => s !== null);
    return branches.length === 0 ? null : mergeShapes(branches);
  }
  const operands = splitTopLevel(scan, /\|\||\?\?/g);
  if (operands.length > 1) {
    const sides = operands.map(([s, e]) => expressionShape(expr.slice(s, e), paths, aliases))
      .filter((s): s is ResultShape => s !== null);
    return sides.length === 0 ? null : mergeShapes(sides);
  }

  // オブジェクトリテラル
  if (scan.startsWith('{')) {
    if (extractDelimitedContent(expr, scan, 0, '{', '}').length !== expr.length - 2) return null;
    return { isList: false, mirrors: [], fields: literalFields(expr, '', aliases) };
  }

  // `[...this.todos]`（要素がスプレッド 1 つの配列リテラル）と、それに続く連鎖
  let shape: ResultShape | null;
  let rest: number;
  if (scan.startsWith('[')) {
    const inner = extractDelimitedContent(expr, scan, 0, '[', ']');
    rest = inner.length + 2;
    if (inner.trim() === '') {
      // `[]` — the fallback of `this.items ?? []`: a list, whose rows the chain decides
      shape = EMPTY_LIST;
    } else {
      const spread = /^\s*\.\.\.([\s\S]+)$/.exec(inner);
      if (spread === null || splitTopLevelElements(inner).length !== 1) return null;
      const source = expressionShape(spread[1], paths, aliases);
      if (source === null || !source.isList) return null;
      shape = source;
    }
  } else if (scan.startsWith('(')) {
    // `(this.items ?? []).map(…)`: the expression in the parentheses is the base of the chain. One it cannot read
    // (`(await res.json()).map(…)`) is a source of unknown shape: only a `map` with a literal gives it rows
    const inner = extractDelimitedContent(expr, scan, 0, '(', ')');
    shape = expressionShape(inner, paths, aliases) ?? OPAQUE;
    rest = inner.length + 2;
  } else {
    const base = readBase(expr, scan, aliases, paths);
    if (base === null) return null;
    ({ shape, rest } = base);
  }
  return applyChain(expr, scan, rest, shape, paths, aliases);
}

/** `this.a.b` / `this["a.*.b"]` / 別名。続く `.method(` の手前まで。 */
function readBase(
  expr: string,
  scan: string,
  aliases: Map<string, ResultShape>,
  paths: PathCandidate[],
): { shape: ResultShape; rest: number } | null {
  const alias = /^([$\w]+)/.exec(scan);
  if (alias === null) return null;
  if (alias[1] !== 'this') {
    // a member of a name (`r.tags.map(…)` in a callback): its shape is not known either — only a map decides it
    let rest = alias[1].length;
    let member = false;
    for (;;) {
      const dot = /^\s*\??\.\s*([$\w]+)/.exec(scan.slice(rest));
      if (dot === null || /^\s*\(/.test(scan.slice(rest + dot[0].length))) break;
      rest += dot[0].length;
      member = true;
    }
    const shape = member ? undefined : aliases.get(alias[1]);
    // 別名でない名前（モジュールの定数・関数）: 形は分からない — 連鎖の map だけが行の形を決める
    return { shape: shape ?? OPAQUE, rest };
  }
  const segments: string[] = [];
  let i = 4;
  for (;;) {
    const dot = /^\s*\??\.\s*([$\w]+)/.exec(scan.slice(i));
    if (dot !== null) {
      // `.name(` はメソッド呼び出し ── ベースのパスはその手前まで
      if (/^\s*\(/.test(scan.slice(i + dot[0].length))) break;
      segments.push(dot[1]);
      i += dot[0].length;
      continue;
    }
    const bracket = /^\s*\[\s*(["'])/.exec(scan.slice(i));
    if (bracket !== null) {
      const open = i + bracket[0].length - 1;
      const close = scan.indexOf(']', open);
      const literal = /^(["'])([^"']*)\1\s*$/.exec(expr.slice(open, close));
      if (close === -1 || literal === null) return null;
      segments.push(literal[2]);
      i = close + 1;
      continue;
    }
    break;
  }
  const path = segments.join('.');
  // `this.$getAll(…)` などの API の結果: 形は分からない（連鎖の map が決める）
  if (path === '' && /^\s*\??\.\s*\$[$\w]*\s*\(/.test(scan.slice(4))) return { shape: OPAQUE, rest: 4 };
  if (path === '' || path.startsWith('$')) return null;
  return {
    shape: { isList: hasPath(paths, `${path}.*`), mirrors: [{ from: path, to: '' }], fields: [] },
    rest: i,
  };
}

/** `.filter(…)` / `.find(…)` / `.map(…)` の連鎖。最後まで読めたときだけ形を返す。 */
function applyChain(
  expr: string,
  scan: string,
  start: number,
  initial: ResultShape,
  paths: PathCandidate[],
  aliases: Map<string, ResultShape>,
): ResultShape | null {
  let shape = initial;
  let i = start;
  while (scan.slice(i).trim() !== '') {
    // 形の分からない元への呼び出し（`helper(…)`）は飛ばす
    if (shape.opaque && /^\s*\(/.test(scan.slice(i))) {
      const open = scan.indexOf('(', i);
      i = open + extractDelimitedContent(expr, scan, open, '(', ')').length + 2;
      continue;
    }
    const call = /^\s*\??\.\s*([$\w]+)\s*\(/.exec(scan.slice(i));
    if (call === null) return null;
    const open = i + call[0].length - 1;
    const args = extractDelimitedContent(expr, scan, open, '(', ')');
    i = open + args.length + 2;
    const method = call[1];
    if (shape.opaque) {
      // 分からない行のまま並べ替え・絞り込みしても分からない。map だけが形を作る
      if (method === 'map') {
        const mapped = mapRows(args, shape, paths, aliases);
        if (mapped === null) return null;
        shape = mapped;
      }
      continue;
    }
    if (ROW_PRESERVING_METHODS.has(method)) {
      if (!shape.isList) return null;
    } else if (ROW_PICKING_METHODS.has(method)) {
      if (!shape.isList) return null;
      shape = pickRow(shape);
    } else if (method === 'map') {
      // a value the state does not show as a list (seeded `null` until a fetch fills it): `map` makes it one, and
      // the callback's literal is the row — as for a source of unknown shape (the prod-booking seam app)
      const mapped = mapRows(args, shape.isList ? shape : OPAQUE, paths, aliases);
      if (mapped === null) return null;
      shape = mapped;
    } else {
      return null;
    }
  }
  return shape.opaque ? null : shape;
}

/** 形の分からない元。 */
const OPAQUE: ResultShape = { isList: true, mirrors: [], fields: [], opaque: true };
/** 空の配列リテラル `[]`: 行の無いリスト。 */
const EMPTY_LIST: ResultShape = { isList: true, mirrors: [], fields: [] };

/** リストの形 → その行 1 つの形。 */
function pickRow(shape: ResultShape): ResultShape {
  return {
    isList: false,
    mirrors: shape.mirrors.map(m => (m.to === '' ? { from: `${m.from}.*`, to: '' as const } : { from: m.from, to: '' as const })),
    fields: shape.fields.filter(f => f.to === '.*').map(f => ({ ...f, to: '' as const })),
  };
}

/**
 * `map` のコールバック（`t => ({ … })` / `(t) => { return { … }; }` / `function (t) { return { … }; }`）が
 * 返すオブジェクトリテラルから行の形を作る。`...t`（引数のスプレッド）があれば元の行も写す。
 */
function mapRows(args: string, shape: ResultShape, paths: PathCandidate[], outer: Map<string, ResultShape>): ResultShape | null {
  const [callback] = splitTopLevelElements(args);
  if (callback === undefined) return null;
  // 引数は名前 1 つか、分割代入（`([key, value]) =>` — 元の行はスプレッドできない）
  const head = /^(?:async\s+)?(?:function\b[^(]*\(\s*([$\w]+)?[^)]*\)|\(\s*([$\w]+)?[^)]*\)|([$\w]+))\s*(=>)?\s*/.exec(callback);
  if (head === null) return null;
  const param = head[1] ?? head[2] ?? head[3];
  const body = callback.slice(head[0].length);
  const literals: string[] = [];
  // the names the callback's literal may use: the enclosing function's aliases, and the callback's own
  let aliases = outer;
  const bodyScan = maskCommentsAndStrings(body);
  if (bodyScan.startsWith('(')) {
    const inner = stripWrappingParens(body).trim();
    if (inner.startsWith('{')) literals.push(inner);
  } else if (bodyScan.startsWith('{')) {
    // the callback's own `return { … }` (each of them), not one of a function nested in it — the rows of
    // `ids.map((id) => { const days = list.map((d) => { return { dayText }; }); return { id, days }; })` are
    // `{ id, days }` (the city-library seam app: the inner literal was taken)
    const block = extractDelimitedContent(body, bodyScan, 0, '{', '}');
    const blockScan = maskCommentsAndStrings(block);
    aliases = new Map([...outer, ...collectAliases(block, paths)]);
    for (const end of ownReturnEnds(blockScan)) {
      const ret = /^\s*\{/.exec(blockScan.slice(end));
      if (ret === null) continue;
      const open = end + ret[0].length - 1;
      literals.push(`{${extractDelimitedContent(block, blockScan, open, '{', '}')}}`);
    }
  }
  if (literals.length === 0) return null;
  const spreadsRow = literals.some(literal => splitTopLevelElements(extractObjectContent(literal)).some(e => e === `...${param}`));
  return {
    isList: true,
    mirrors: spreadsRow
      ? shape.mirrors.map(m => (m.to === '' ? { from: `${m.from}.*`, to: '.*' as const } : m))
      : [],
    fields: [
      ...(spreadsRow ? shape.fields.filter(f => f.to === '.*') : []),
      ...literals.flatMap(literal => literalFields(literal, '.*', aliases)),
    ],
  };
}

/** 形を `getter` の下の候補として足す（既にあるパスは上書きしない）。 */
function applyResultShape(getter: string, shape: ResultShape, paths: PathCandidate[]): void {
  if (shape.isList) {
    if (!hasPath(paths, `${getter}.*`)) paths.push({ path: `${getter}.*`, kind: 'list' });
    if (!hasPath(paths, `${getter}.length`)) paths.push({ path: `${getter}.length`, kind: 'data', typeHint: 'number' });
  }
  for (const { from, to } of shape.mirrors) {
    // 写す元が getter 自身の下（`get a() { return this.a… }`）なら写さない
    if (from === getter || from.startsWith(`${getter}.`)) continue;
    const sources = paths.filter(p => p.path.startsWith(`${from}.`) && (p.kind === 'data' || p.kind === 'list'));
    for (const source of sources) {
      const target = `${getter}${to}${source.path.slice(from.length)}`;
      if (!hasPath(paths, target)) paths.push(withHint({ path: target, kind: source.kind }, source.typeHint));
    }
  }
  for (const { to, field, shape: fieldShape } of shape.fields) {
    pushRowFieldPaths(`${getter}${to}.${field.name}`, field, paths, 1);
    if (fieldShape !== undefined) applyResultShape(`${getter}${to}.${field.name}`, fieldShape, paths);
  }
}

function mergeShapes(shapes: ResultShape[]): ResultShape {
  return {
    isList: shapes.some(s => s.isList),
    mirrors: shapes.flatMap(s => s.mirrors),
    fields: shapes.flatMap(s => s.fields),
  };
}

/** 式全体を包む括弧（`(a)`）を外す。`(a) && (b)` は外さない。 */
function stripWrappingParens(text: string): string {
  let expr = text.trim();
  for (;;) {
    if (!expr.startsWith('(')) return expr;
    const scan = maskCommentsAndStrings(expr);
    const inner = extractDelimitedContent(expr, scan, 0, '(', ')');
    if (inner.length !== expr.length - 2) return expr;
    expr = inner.trim();
  }
}

/** 深さ 0 の三項演算子 `?` と対応する `:` の位置。`?.` と `??` は演算子ではない。 */
function splitTernary(scan: string): [number, number] | null {
  let depth = 0;
  let question = -1;
  let nested = 0;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth !== 0) continue;
    else if (ch === '?') {
      if (scan[i + 1] === '.' || scan[i + 1] === '?' || scan[i - 1] === '?') continue;
      if (question === -1) question = i;
      else nested++;
    } else if (ch === ':' && question !== -1) {
      if (nested > 0) nested--;
      else return [question, i];
    }
  }
  return null;
}

/** 深さ 0 の区切り（`||` / `??`）で式を割り、各オペランドの範囲を返す。 */
function splitTopLevel(scan: string, separator: RegExp): [number, number][] {
  const out: [number, number][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0) {
      separator.lastIndex = i;
      const m = separator.exec(scan);
      if (m !== null && m.index === i) {
        out.push([start, i]);
        start = i + m[0].length;
        i = start - 1;
      }
    }
  }
  out.push([start, scan.length]);
  return out;
}

/** 候補集合にパスが既にあるか。 */
function hasPath(paths: PathCandidate[], path: string): boolean {
  return paths.some(p => p.path === path);
}

/**
 * 要素列（配列リテラルの中身 / 引数列 / オブジェクトリテラルの中身）を深さ 0 の `,` で
 * 分割し、トリム済みの原文スライスを返す（空要素は除く）。括弧の数え上げは鏡像で行う。
 */
function splitTopLevelElements(text: string): string[] {
  const scan = maskCommentsAndStrings(text);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map(e => e.trim()).filter(e => e.length > 0);
}

/**
 * `$streams` エントリ定義オブジェクトから `initial` プロパティを取り出す。
 */
function findStreamInitialProperty(entryValue: string): PropertyInfo | undefined {
  const defProps = parseTopLevelProperties(extractObjectContent(entryValue));
  return defProps.find(p => p.kind === 'data' && p.name === 'initial');
}

/** `$scan` の出力名として成立するか（平坦・`$` 始まりでない — runtime の assertOutputName の形の部分と同条件）。 */
function isFlatScanOutputName(name: string): boolean {
  return name.length > 0 && !name.startsWith('$') && !name.includes('.') && !name.includes('*');
}

/**
 * 配列リテラルから文字列リテラル要素を取り出す（`$commandTokens` / `$eventTokens` 用）。
 */
function extractStringArrayItems(value: string): string[] {
  if (!isArrayLiteral(value)) return [];
  const items: string[] = [];
  const regex = /["']([^"'\\]+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    items.push(match[1]);
  }
  return items;
}

/**
 * ネストしたオブジェクトリテラルを展開する最大深度。
 * JSON 側（collectJsonPaths）と同じ予算にして、両解析の到達範囲を揃える。
 */
const MAX_OBJECT_NEST_DEPTH = 5;

/**
 * データプロパティ1つ分のパス候補を生成する
 * （配列ならワイルドカード・`.length`・要素子パス、オブジェクトなら子パスも展開）。
 */
interface AccessorPair {
  readonly get: boolean;
  readonly set: boolean;
}

/** 同じトップレベルキーの宣言を畳んだ結果。データ（メソッドを含む）か、get / set の組。 */
type EffectiveDescriptor = 'data' | AccessorPair;

/**
 * 同じトップレベルキーを複数回書いた宣言を、オブジェクトリテラルの評価順どおりに畳む。
 * データの後のアクセサはデータを置き換え、アクセサの後のデータはアクセサを置き換え、
 * get と set は同じキーのアクセサに合わさる（ランタイムが読む property descriptor と同じ）。
 */
function effectiveTopLevelDescriptors(props: readonly PropertyInfo[]): Map<string, EffectiveDescriptor> {
  const effective = new Map<string, EffectiveDescriptor>();
  for (const prop of props) {
    if (prop.kind !== 'getter') {
      effective.set(prop.name, 'data');
      continue;
    }
    const current = effective.get(prop.name);
    const pair: AccessorPair = current === undefined || current === 'data' ? { get: false, set: false } : current;
    effective.set(prop.name, prop.accessor === 'set' ? { ...pair, set: true } : { ...pair, get: true });
  }
  return effective;
}

function pushDataPropertyPaths(prop: PropertyInfo, paths: PathCandidate[], typedefs: JsDocTypedefs): void {
  pushDataPropertyPathsAt(prop.name, prop, paths, 0, typedefs);
}

/**
 * `path` に紐づくデータプロパティのパス候補を生成し、オブジェクトリテラルなら
 * 子プロパティへ再帰する（`MAX_OBJECT_NEST_DEPTH` まで）。
 * JSDoc `@type` で形が宣言されていれば、値から読めなかった分をその形から足す。
 */
function pushDataPropertyPathsAt(
  path: string,
  prop: PropertyInfo,
  paths: PathCandidate[],
  depth: number,
  typedefs: JsDocTypedefs,
): void {
  // データプロパティ
  paths.push({ path, kind: 'data', typeHint: prop.typeHint, rawInitial: prop.value?.trim() });
  pushLiteralStructurePaths(path, prop, paths, depth, typedefs);
  if (prop.declaredType !== undefined) pushDeclaredShapePaths(path, prop.declaredType, paths, depth, typedefs);
}

/**
 * JSDoc `@type` で宣言された形の候補を、既存候補を上書きせずに足す（値のリテラルが先 —
 * 同じパスがあれば値から読んだ型ヒントを残す）。初期値ではないので `rawInitial` は付けない。
 * `null` で始まる `fetch` の結果（`/** @type {{ id: number }[] | null} *\/ catalog: null`）の
 * 行の形（`catalog.*.id`）は、これが唯一の手掛かり。
 */
function pushDeclaredShapePaths(
  path: string,
  type: JsDocType,
  paths: PathCandidate[],
  depth: number,
  typedefs: JsDocTypedefs,
): void {
  const shape = jsDocShape(type, typedefs);
  if (shape.element !== null) {
    if (!hasPath(paths, `${path}.*`)) paths.push({ path: `${path}.*`, kind: 'list' });
    if (!hasPath(paths, `${path}.length`)) paths.push({ path: `${path}.length`, kind: 'data', typeHint: 'number' });
    if (depth < MAX_OBJECT_NEST_DEPTH) pushDeclaredShapePaths(`${path}.*`, shape.element, paths, depth + 1, typedefs);
  }
  if (depth >= MAX_OBJECT_NEST_DEPTH) return;
  for (const field of shape.fields) {
    const fieldPath = `${path}.${field.name}`;
    if (!hasPath(paths, fieldPath)) {
      paths.push(withHint({ path: fieldPath, kind: 'data' }, jsDocTypeHint(field.type, typedefs)));
    }
    pushDeclaredShapePaths(fieldPath, field.type, paths, depth + 1, typedefs);
  }
}

/** 値のリテラルから読める構造（配列の行・オブジェクトの子）の候補を足す。 */
function pushLiteralStructurePaths(
  path: string,
  prop: PropertyInfo,
  paths: PathCandidate[],
  depth: number,
  typedefs: JsDocTypedefs,
): void {
  // 配列の場合、ワイルドカードパスと子パス、組み込みプロパティを生成。
  // 先頭要素の子プロパティへは再帰する — 子が配列/オブジェクトなら
  // `a.*.b.*` / `a.*.b.c` のような深いワイルドカード候補も導出される
  // （ランタイムは任意深度のワイルドカードを解決するため、ここで打ち切ると
  // 入れ子リストの正当なパスが「未知パス」扱いになる）。
  if (prop.value && isArrayLiteral(prop.value)) {
    paths.push({ path: `${path}.*`, kind: 'list' });
    paths.push({ path: `${path}.length`, kind: 'data', typeHint: 'number' });
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    for (const childProp of extractArrayElementDataProperties(prop.value)) {
      pushDataPropertyPathsAt(`${path}.*.${childProp.name}`, childProp, paths, depth + 1, typedefs);
    }
    return;
  }

  // オブジェクトの場合、子パスを生成（さらにネストしたオブジェクトも辿る）
  if (prop.value && isObjectLiteral(prop.value)) {
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const childProps = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const childProp of childProps) {
      if (childProp.kind !== 'data') continue;
      pushDataPropertyPathsAt(`${path}.${childProp.name}`, childProp, paths, depth + 1, typedefs);
    }
  }
}

/**
 * JSON 文字列を解析してパス候補を生成する。
 * `json` 属性や `state` 属性（<script type="application/json">）、
 * 外部 .json ファイルの内容に対して使用する。
 *
 * JSON にはメソッドや computed getter がないため、全て kind: 'data' となる。
 *
 * @param jsonString - JSON 文字列
 * @returns パス候補の配列（パース失敗時は空配列）
 */
export function analyzeJsonPaths(jsonString: string): PathCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return [];
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];

  const paths: PathCandidate[] = [];
  collectJsonPaths(data as Record<string, unknown>, '', paths, 0);
  return paths;
}

/**
 * JSON オブジェクトを再帰的に走査してパス候補を収集する。
 * 最大深度を制限して無限再帰を防止する。
 */
function collectJsonPaths(
  obj: Record<string, unknown>,
  prefix: string,
  paths: PathCandidate[],
  depth: number,
): void {
  if (depth >= MAX_OBJECT_NEST_DEPTH) return; // 深すぎるネストは無視

  for (const [key, value] of Object.entries(obj)) {
    // トップレベルの `$` キーは予約名（JSON state に書いてもデータパスにはならない）
    if (prefix === '' && key.startsWith('$')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    pushJsonValuePaths(path, value, paths, depth);
  }
}

/**
 * JSON 値 1 つ分のパス候補を生成する。配列は先頭要素の子へ再帰し、
 * 入れ子リスト（`a.*.b.*` / `a.*.b.*.c`）の候補も導出する
 * （script 側の pushDataPropertyPathsAt と同じ規則）。
 */
function pushJsonValuePaths(
  path: string,
  value: unknown,
  paths: PathCandidate[],
  depth: number,
): void {
  paths.push({ path, kind: 'data', typeHint: inferJsonTypeHint(value) });

  if (Array.isArray(value)) {
    paths.push({ path: `${path}.*`, kind: 'list' });
    paths.push({ path: `${path}.length`, kind: 'data', typeHint: 'number' });

    // 最初の要素がオブジェクトなら子パスへ再帰
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && !Array.isArray(value[0])) {
      const firstElement = value[0] as Record<string, unknown>;
      for (const [childKey, childValue] of Object.entries(firstElement)) {
        pushJsonValuePaths(`${path}.*.${childKey}`, childValue, paths, depth + 1);
      }
    }
  } else if (typeof value === 'object' && value !== null) {
    collectJsonPaths(value as Record<string, unknown>, path, paths, depth + 1);
  }
}

/**
 * JSON 値から型ヒントを推定する。
 */
function inferJsonTypeHint(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return undefined;
}

// ============================================================
// Internal helpers
// ============================================================

interface PropertyInfo {
  name: string;
  /** `getter` は get / set 双方（どちらも計算パスの宣言なので区別しない）。 */
  kind: 'data' | 'getter' | 'method';
  /**
   * `kind: 'getter'` のときの accessor 種別。依存意味論を持つのは get 側だけ
   * （setter 内の読み取りはランタイムが依存に登録しない）なので、本体を読む検査が
   * get / set を区別するために持つ。パス候補の畳み込み（get/set ペアで 1 候補）は変えない。
   */
  accessor?: 'get' | 'set';
  value?: string;
  typeHint?: string;
  /** 直前の JSDoc `@type` の型（パースできたときだけ）。形の候補を足すのに使う。 */
  declaredType?: JsDocType;
  /**
   * 解析対象の objectContent 内での名前の範囲（引用符は含まない）と値の開始位置。
   * 診断のレンジ計算にだけ使う。宣言から合成した派生プロパティ（`$streams` の値
   * 実体化など）は原文に対応する位置を持たないため未設定。
   */
  nameStart?: number;
  nameEnd?: number;
  valueStart?: number;
}

interface SimpleProperty {
  name: string;
  typeHint?: string;
}

/**
 * `export default { ... }` のオブジェクトリテラルを、中身と **script 内での開始
 * オフセット**の両方で返す。オフセットが要るのは診断のレンジ計算のため
 * （watchDeclarationValidator）。
 */
function locateDefaultExportObject(script: string): { content: string; start: number } | null {
  const scan = maskCommentsAndStrings(script);
  // defineState({ ... }) または { ... } を検出
  const match = scan.match(/export\s+default\s+(?:defineState\s*\(\s*)?(\{)/);
  if (!match) return null;

  const braceIndex = scan.indexOf(match[1], match.index!);
  // extractBracedContent は `{` の中身を返すので、中身の開始は `{` の次
  return { content: extractBracedContent(script, scan, braceIndex), start: braceIndex + 1 };
}

/**
 * オブジェクトリテラルのトップレベルプロパティを解析する。
 * トークンベースでスキャンし、ネストされた括弧をスキップする。
 *
 * 走査はマスク済みの鏡像（コメント・文字列リテラルの中身を空白に潰したもの）に対して
 * 行い、名前と値のテキストは原文から切り出す。鏡像は原文と長さ・オフセットが一致する。
 */
function parseTopLevelProperties(objectContent: string, allowEmptyDataKeys = false): PropertyInfo[] {
  const props: PropertyInfo[] = [];
  const scan = maskCommentsAndStrings(objectContent);
  // 名前は `$` プレフィックスを含めて捕捉する（`\w` だけだと `$streams:` の
  // `streams` 部分にマッチして偽のパスが生まれる）。
  // `d` フラグ必須 — 引用符付きキーは鏡像では中身が空白なので、名前は
  // match.indices が示す範囲を原文から取り直す。
  // メソッド短縮記法も **引用符付きの名前**を受ける: `"items.*.price"(cur, prev) {}`。
  // ドットや `*` を含むキーは引用符でしか書けず、`$watch` のワイルドカード行
  // ハンドラはまさにこの形（README の idiom）。bare 識別子だけを見ていると
  // 宣言そのものが解析結果から丸ごと消える。
  // グループ: 1-3 accessor / 4-6 method / 7-9 data（各 double / single / bare）
  // `allowEmptyDataKeys` は data の引用符付きキーに空文字（`"": …`）を許す。既定で拾わないのは
  // 補完候補に空のパスを作らないため。ただ拾わないと、値の中身（`"": { from: … }` の `from:`）を
  // トップレベルのプロパティと誤読するので、キーそのものを検証する `$scan` の解析だけが有効にする。
  // 引数の並びは括弧の入れ子を 3 段まで読む（既定引数の呼び出し `id = crypto.randomUUID()`・
  // 矢印関数 `cb = () => {}`）。`[^)]*` だけでは最初の `)` で止まり、メソッドが丸ごと消え、本体の
  // `word:` をトップレベルのキーと読んでいた（docs/seam-apps.md、shift-desk）。
  const params = String.raw`\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*\)`;
  const dataKey = allowEmptyDataKeys ? String.raw`(?:"([^"]*)"|'([^']*)'|([$\w]+))` : String.raw`(?:"([^"]+)"|'([^']+)'|([$\w]+))`;
  const regex = new RegExp(
    String.raw`(?:(?:get|set)\s+(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*${params}\s*\{)|(?:(?:async\s+)?(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*${params}\s*\{)|(?:${dataKey}\s*:\s*)`,
    'gd',
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(scan)) !== null) {
    const indices = match.indices!;
    let nameSpan: [number, number] | undefined;
    const nameAt = (group: number): string | undefined => {
      const span = indices[group];
      if (!span) return undefined;
      nameSpan = [span[0], span[1]];
      return objectContent.slice(span[0], span[1]);
    };
    // 本体 `{ ... }` を読み飛ばして走査位置をその直後へ送る（本体内の `word:` を
    // トップレベルのプロパティと誤認しないため）。
    // 本体 `{ ... }` を読み飛ばしつつ、中身と開始位置を返す。
    // 本体は捨てずに value / valueStart へ持つ — 意味論検査
    // （wcs/getter-cycle・wcs/updated-callback-unbound）が「この関数が何を読んで
    // いるか」を見るために要る。value を読む既存の消費者はすべて
    // `kind === 'data'` で絞っているので影響しない。
    const skipBody = (): { body: string; bodyStart: number } => {
      const braceStart = match!.index + match![0].length - 1;
      const body = extractBracedContent(objectContent, scan, braceStart);
      regex.lastIndex = braceStart + body.length + 2; // +2 for { and }
      return { body, bodyStart: braceStart + 1 };
    };

    // accessor: get/set "path"() or get/set path()
    const accessorName = nameAt(1) ?? nameAt(2) ?? nameAt(3);
    if (accessorName) {
      const { body, bodyStart } = skipBody();
      // 正規表現は `(?:get|set)` を非捕捉で畳んでいる（群番号を動かさないため）。
      // マッチは必ず `get` / `set` のどちらかで始まるので先頭 3 文字で判別する。
      const accessor: 'get' | 'set' = match[0].startsWith('set') ? 'set' : 'get';
      // getter の JSDoc `@returns {T}` — 本体から読めない戻りの形を宣言する
      const returnsText = accessor === 'get' ? readJsDocReturnsBefore(objectContent, match.index) : undefined;
      const declaredType = returnsText === undefined ? null : parseJsDocType(returnsText);
      props.push({
        name: accessorName, kind: 'getter', accessor, value: body, valueStart: bodyStart,
        nameStart: nameSpan![0], nameEnd: nameSpan![1],
        ...(declaredType !== null ? { declaredType } : {}),
      });
      continue;
    }

    // method: name(args) { / "path"(args) {
    const methodName = nameAt(4) ?? nameAt(5) ?? nameAt(6);
    if (methodName) {
      const { body, bodyStart } = skipBody();
      props.push({
        name: methodName, kind: 'method', value: body, valueStart: bodyStart,
        nameStart: nameSpan![0], nameEnd: nameSpan![1],
      });
      continue;
    }

    // data property: name: value
    const propName = nameAt(7) ?? nameAt(8) ?? nameAt(9);
    // 空文字のキー（allowEmptyDataKeys のときだけ現れる）も名前として通す
    if (propName !== undefined) {
      const valueStartIndex = match.index + match[0].length;
      const value = extractFullValue(objectContent, scan, valueStartIndex);
      // JSDoc @type アノテーションがあれば優先、なければ値から推定
      const jsdocText = readJsDocTypeBefore(objectContent, match.index);
      const declaredType = jsdocText === undefined ? null : parseJsDocType(jsdocText);
      const jsdocType = declaredType !== null
        ? jsDocTypeHint(declaredType)
        : jsdocText === undefined ? undefined : normalizeJsDocType(jsdocText);
      const typeHint = jsdocType ?? inferTypeHint(value);
      props.push({
        name: propName,
        kind: 'data',
        value,
        typeHint,
        ...(declaredType !== null ? { declaredType } : {}),
        nameStart: nameSpan![0],
        nameEnd: nameSpan![1],
        valueStart: valueStartIndex,
      });
      // 値の末尾までスキップ
      regex.lastIndex = valueStartIndex + value.length;
    }
  }

  return props;
}

/**
 * 行コメント・ブロックコメント・文字列/テンプレートリテラルの「中身」を空白に
 * 置換した鏡像を返す。改行と長さは保つので、鏡像上で求めたオフセットはそのまま
 * 原文に使える。コメントの開始終了記号と引用符自体は残すため、走査側は原文と
 * 同じトークン境界を見られる。
 *
 * 正規表現リテラルは解釈しない（`/["']/` のような値は文字列の開始とみなされる）。
 */
export function maskCommentsAndStrings(source: string): string {
  const out = source.split('');
  const len = source.length;
  const blank = (i: number): void => {
    // 改行は残す（鏡像の行構造を原文と一致させる）
    if (source[i] !== '\n' && source[i] !== '\r') out[i] = ' ';
  };

  let i = 0;
  while (i < len) {
    const ch = source[i];

    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') blank(i++);
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) blank(i++);
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      i++;
      while (i < len && source[i] !== ch) {
        if (source[i] === '\\') blank(i++);
        if (i < len) blank(i++);
      }
      i++;
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * プロパティ値のフルテキストを抽出する（ネストされた括弧を追跡）。
 *
 * @param content - 原文（返す値のテキストはここから切り出す）
 * @param scan - content のマスク済み鏡像（境界判定はこちらで行う）
 */
function extractFullValue(content: string, scan: string, startIndex: number): string {
  let depth = 0;
  let i = startIndex;
  const len = scan.length;
  let inString: string | null = null;

  while (i < len) {
    const ch = scan[i];

    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) {
      break;
    }
    i++;
  }

  return content.slice(startIndex, i).trim();
}

/**
 * `{ ... }` の中身（外側の括弧を除く）を抽出する。
 *
 * @param text - 原文（返す中身のテキストはここから切り出す）
 * @param scan - text のマスク済み鏡像（括弧の数え上げはこちらで行う）
 */
function extractBracedContent(text: string, scan: string, openBraceIndex: number): string {
  return extractDelimitedContent(text, scan, openBraceIndex, '{', '}');
}

/**
 * `open` … `close` の中身（外側の括弧を除く）を抽出する。`{}` / `[]` / `()` 共通。
 * 対応する閉じ括弧が無ければ末尾まで返す。
 */
function extractDelimitedContent(
  text: string,
  scan: string,
  openIndex: number,
  open: string,
  close: string,
): string {
  let depth = 0;
  let inString: string | null = null;

  for (let i = openIndex; i < scan.length; i++) {
    const ch = scan[i];

    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }

  return text.slice(openIndex + 1);
}

/**
 * 値が配列リテラルかどうかを判定する。
 */
function isArrayLiteral(value: string): boolean {
  return value.trimStart().startsWith('[');
}

/**
 * 値がオブジェクトリテラルかどうかを判定する。
 */
export function isObjectLiteral(value: string): boolean {
  return value.trimStart().startsWith('{');
}

/**
 * オブジェクトリテラルの中身を抽出する。
 */
function extractObjectContent(value: string): string {
  const trimmed = value.trim();
  const scan = maskCommentsAndStrings(trimmed);
  const start = scan.indexOf('{');
  if (start === -1) return '';
  return extractBracedContent(trimmed, scan, start);
}

/**
 * 配列リテラルの最初の要素がオブジェクトの場合、そのデータプロパティを
 * `value` 込みの PropertyInfo で抽出する（入れ子の配列/オブジェクト再帰用）。
 */
function extractArrayElementDataProperties(value: string): PropertyInfo[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return [];

  // 先頭要素が**オブジェクトリテラル**の場合だけ子を導出する（JSON 側の
  // !Array.isArray(value[0]) ガードと同じ）。`[[{ a: 1 }]]`（配列の配列）で
  // 内側の `{` を拾うと `weird.*.a` のような実在しないパスを候補化してしまう。
  const scan = maskCommentsAndStrings(trimmed);
  let first = 1;
  while (first < scan.length && /\s/.test(scan[first])) first++;
  if (scan[first] !== '{') return [];

  const objectContent = extractBracedContent(trimmed, scan, first);
  return parseTopLevelProperties(objectContent).filter((prop) => prop.kind === 'data');
}

/**
 * JSDoc 型表現を正規化して型ヒントに変換する。
 * Union 型はそのまま保持する（例: "boolean|null"）。
 */
function normalizeJsDocType(typeExpr: string): string | undefined {
  const parts = typeExpr.split('|').map(p => p.trim());
  const normalized = parts.map(p => {
    const lower = p.toLowerCase();
    if (lower === 'string') return 'string';
    if (lower === 'number') return 'number';
    if (lower === 'boolean') return 'boolean';
    if (lower === 'null') return 'null';
    if (lower === 'undefined') return 'null';
    if (lower.endsWith('[]') || lower.startsWith('array')) return 'array';
    if (lower === 'object') return 'object';
    return null;
  }).filter(p => p !== null) as string[];

  if (normalized.length === 0) return undefined;

  // 重複を除去してソートして結合
  const unique = [...new Set(normalized)].sort();
  return unique.join('|');
}

/**
 * 位置 i の文字がバックスラッシュでエスケープされているかを判定する。
 * 連続するバックスラッシュ（`\\`）を正しくカウントする。
 */
function isEscaped(text: string, i: number): boolean {
  let backslashCount = 0;
  let j = i - 1;
  while (j >= 0 && text[j] === '\\') {
    backslashCount++;
    j--;
  }
  return backslashCount % 2 === 1;
}

/**
 * 値の先頭部分から型を推定する。
 */
function inferTypeHint(valueStart: string): string | undefined {
  const v = valueStart.trim().replace(/,\s*$/, '');
  if (/^-?\d+\.\d/.test(v)) return 'number';
  if (/^-?\d/.test(v)) return 'number';
  if (/^["'`]/.test(v)) return 'string';
  if (v === 'true' || v === 'false') return 'boolean';
  if (v === 'null') return 'null';
  if (v.startsWith('[')) return 'array';
  if (v.startsWith('{')) return 'object';
  return undefined;
}

// ============================================================
// stateSchema（sidecar manifest）由来の候補
// ============================================================

/**
 * `wcstack.application.states[name].stateSchema`（JSON-Schema subset・規範 §4）から
 * パス候補を生成する。補完・hover・型期待（typeHint）に使う。**存在判定には使わない**
 * — schema が宣言された state の存在判定は core/sidecar/schemaSubset.ts の
 * `resolveSchemaPath` の三値（resolved / unknown / nonexistent）で行う。候補集合に
 * 平坦化すると `{}`（unknown）の下のパスが「候補に無い = 不在」に化けて偽 error になる。
 *
 * 規則は collectJsonPaths と同じ: properties → data、配列（items）→ `<path>.*`（list）＋
 * `<path>.length`（number）、items が object なら子へ再帰、深さ上限は MAX_OBJECT_NEST_DEPTH
 * （生成器 wcs-schema も同じ深さで打ち切る）。`$ref` は root `$defs` で局所解決（循環・
 * 未解決は捨てる）、`anyOf` は枝を合併し、型ヒントから null を除く。
 */
export function analyzeSchemaPaths(schema: JsonSchemaNode): PathCandidate[] {
  const paths: PathCandidate[] = [];
  const defs = schema.$defs ?? {};
  collectSchemaObjectPaths(schema, '', paths, defs, 0);
  return paths;
}

/**
 * script / JSON 由来の候補に schema 由来の候補を合流させる。同じパスは schema が
 * 勝つ（D12: 明示の契約が正規表現推定より優先）。schema が無ければそのまま返す。
 */
export function mergeSchemaCandidates(
  candidates: PathCandidate[],
  applicationSchema?: JsonSchemaNode,
): PathCandidate[] {
  if (applicationSchema === undefined) return candidates;
  const schemaCandidates: PathCandidate[] = [];
  const schemaKeys = new Set<string>();
  for (const p of analyzeSchemaPaths(applicationSchema)) {
    schemaCandidates.push(p);
    schemaKeys.add(p.path);
  }
  const kept = candidates.filter(p => !schemaKeys.has(p.path));
  return [...kept, ...schemaCandidates];
}

/** `$ref`（`#/$defs/<name>` のみ）と `anyOf` を展開して具体ノード列にする。循環・未解決は捨てる。 */
function derefSchemaNodes(
  node: JsonSchemaNode,
  defs: Readonly<Record<string, JsonSchemaNode>>,
): JsonSchemaNode[] {
  const out: JsonSchemaNode[] = [];
  const stack: { node: JsonSchemaNode; chain: ReadonlySet<string> }[] = [{ node, chain: new Set() }];
  while (stack.length > 0) {
    const { node: n, chain } = stack.pop()!;
    if (n === null || typeof n !== 'object') continue;
    if (typeof n.$ref === 'string') {
      const match = /^#\/\$defs\/(.+)$/.exec(n.$ref);
      if (match === null || chain.has(n.$ref)) continue;
      const target = defs[match[1].replace(/~1/g, '/').replace(/~0/g, '~')];
      if (target === undefined) continue;
      stack.push({ node: target, chain: new Set([...chain, n.$ref]) });
      continue;
    }
    if (Array.isArray(n.anyOf)) {
      // LIFO なので逆順に積み、展開結果が宣言順（`a|b` の表記順）になるようにする
      for (let i = n.anyOf.length - 1; i >= 0; i--) stack.push({ node: n.anyOf[i], chain });
      continue;
    }
    out.push(n);
  }
  return out;
}

/**
 * 展開済みノード列から型ヒントを決める。`integer` は number、null は除外、複数型は
 * `a|b`（validateFilterChainTypes の union 表記）。`type` 無しは enum / const / properties /
 * items から推定し、どれも無ければ undefined（= 型未確定・型期待検査は沈黙）。
 */
function schemaTypeHint(nodes: JsonSchemaNode[]): string | undefined {
  const hints = new Set<string>();
  for (const n of nodes) {
    const types = typeof n.type === 'string' ? [n.type] : Array.isArray(n.type) ? n.type : [];
    if (types.length > 0) {
      for (const t of types) {
        if (t === 'null') continue;
        hints.add(t === 'integer' ? 'number' : t);
      }
      continue;
    }
    if (Array.isArray(n.enum)) {
      for (const v of n.enum) {
        const h = inferJsonTypeHint(v);
        if (h !== undefined && h !== 'null') hints.add(h);
      }
    } else if (n.const !== undefined) {
      const h = inferJsonTypeHint(n.const);
      if (h !== undefined && h !== 'null') hints.add(h);
    } else if (n.properties !== undefined) {
      hints.add('object');
    } else if (n.items !== undefined) {
      hints.add('array');
    }
  }
  return hints.size === 0 ? undefined : [...hints].join('|');
}

function collectSchemaObjectPaths(
  node: JsonSchemaNode,
  prefix: string,
  paths: PathCandidate[],
  defs: Readonly<Record<string, JsonSchemaNode>>,
  depth: number,
): void {
  if (depth >= MAX_OBJECT_NEST_DEPTH) return;
  const seen = new Set<string>();
  for (const n of derefSchemaNodes(node, defs)) {
    for (const [key, child] of Object.entries(n.properties ?? {})) {
      // トップレベルの `$` キーは予約名（schema に書いてもデータパスにはならない）
      if (prefix === '' && key.startsWith('$')) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const path = prefix ? `${prefix}.${key}` : key;
      pushSchemaValuePaths(path, child, paths, defs, depth);
    }
  }
}

function pushSchemaValuePaths(
  path: string,
  node: JsonSchemaNode,
  paths: PathCandidate[],
  defs: Readonly<Record<string, JsonSchemaNode>>,
  depth: number,
): void {
  const nodes = derefSchemaNodes(node, defs);
  const typeHint = schemaTypeHint(nodes);
  paths.push(withHint({ path, kind: 'data', fromSchema: true }, typeHint));

  const items = nodes.map(n => n.items).find(i => i !== undefined && i !== null && typeof i === 'object');
  const isArray = items !== undefined || (typeHint?.split('|').includes('array') ?? false);
  if (isArray) {
    const itemNodes = items !== undefined ? derefSchemaNodes(items, defs) : [];
    paths.push(withHint({ path: `${path}.*`, kind: 'list', fromSchema: true }, schemaTypeHint(itemNodes)));
    paths.push({ path: `${path}.length`, kind: 'data', typeHint: 'number', fromSchema: true });

    // items がオブジェクトなら子パスへ再帰（JSON 側の「先頭要素の子」と同じ規則）
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const seen = new Set<string>();
    for (const n of itemNodes) {
      for (const [childKey, childNode] of Object.entries(n.properties ?? {})) {
        if (seen.has(childKey)) continue;
        seen.add(childKey);
        pushSchemaValuePaths(`${path}.*.${childKey}`, childNode, paths, defs, depth + 1);
      }
    }
    return;
  }

  if (nodes.some(n => n.properties !== undefined)) {
    collectSchemaObjectPaths(node, path, paths, defs, depth + 1);
  }
}

/** typeHint が undefined のときはキー自体を付けない（JSON 由来候補との toEqual 互換）。 */
function withHint(candidate: PathCandidate, typeHint: string | undefined): PathCandidate {
  return typeHint === undefined ? candidate : { ...candidate, typeHint };
}
