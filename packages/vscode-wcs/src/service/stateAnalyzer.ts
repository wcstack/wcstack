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
   */
  kind: 'data' | 'computed' | 'method' | 'list' | 'command' | 'eventToken';
  /** 値の型ヒント（推定） */
  typeHint?: string;
  /**
   * 初期値リテラルの生テキスト（kind: 'data' のみ、トリム済み。例: "true"、"''"、"null"）。
   * シード値検査（trigger スロットの true シード / storage スロットの空文字シード等）が
   * 具体値を必要とするため typeHint とは別に公開する。JSON 由来のパスには付かない。
   */
  rawInitial?: string;
  /** 所属する state 名（デフォルト: 'default'） */
  /**
   * sidecar manifest の `stateSchema` から導出した候補（analyzeSchemaPaths）。
   * 型は宣言された契約由来なので「確定」扱い — `for:` の非配列を error にする判定に使う。
   */
  fromSchema?: boolean;
}

import type { JsonSchemaNode } from '../core/sidecar/types.js';

// ランタイム予約キー（@wcstack/state src/define.ts が正本）。
// トップレベルの `$` プレフィックスキーは宣言・API 名前空間でありデータパスにならない。
const RESERVED_STREAMS_KEY = '$streams';
const RESERVED_COMMAND_TOKENS_KEY = '$commandTokens';
const RESERVED_EVENT_TOKENS_KEY = '$eventTokens';
const RESERVED_LIST_KEYS_KEY = '$listKeys';
// `$watch` はパスを新設しないので analyzeStatePaths では派生候補を作らない。
// 宣言そのものの検証（キーがパスとして成立するか）は analyzeWatchEntries が担う。
const RESERVED_WATCH_KEY = '$watch';

/**
 * export default { ... } のオブジェクトリテラルからパス候補を生成する。
 *
 * @param scriptContent - <script type="module"> の内容
 * @returns パス候補の配列
 */
export function analyzeStatePaths(scriptContent: string): PathCandidate[] {
  const objectContent = extractDefaultExportObject(scriptContent);
  if (!objectContent) return [];

  const paths: PathCandidate[] = [];
  const topLevelProps = parseTopLevelProperties(objectContent);
  // `$streams` の値プロパティ実体化はループ後に処理する（明示宣言されたプロパティが優先）
  const pendingStreamValues: PropertyInfo[] = [];
  // `$listKeys` のリストパス実体化も同様に後処理（明示宣言・$streams 実体化が優先）
  const pendingListKeys: PropertyInfo[] = [];

  for (const prop of topLevelProps) {
    // トップレベルの `$` プレフィックスキーは予約名（$streams/$commandTokens/$eventTokens/
    // $listKeys/$watch/$on/$bindables/$connectedCallback 等）。データパスにせず宣言由来の
    // 候補だけを導出する。`$watch` は既存パスを購読するだけで新しいパスを作らないため、
    // `$streams`（値プロパティを実体化する）と違い個別処理は要らない。
    if (prop.name.startsWith('$')) {
      collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys);
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
      if (!paths.some(p => p.path === prop.name)) {
        paths.push({ path: prop.name, kind: 'computed' });
      }
      continue;
    }

    pushDataPropertyPaths(prop, paths);
  }

  // $streams 宣言による値プロパティの実体化（processStreamsDeclaration §1-3 相当）。
  // ユーザーが同名プロパティを明示宣言している場合は上書きしない。
  for (const streamValue of pendingStreamValues) {
    if (paths.some(p => p.path === streamValue.name)) continue;
    pushDataPropertyPaths(streamValue, paths);
  }

  // $listKeys 宣言によるリストパスの実体化（processListKeysDeclaration §3 相当）。
  // $streams 実体化の後に走らせて、stream 由来のリストにキー宣言が付くケースも拾う。
  for (const listKeyEntry of pendingListKeys) {
    pushListKeyPaths(listKeyEntry, paths);
  }

  return paths;
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
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];

  const watchProp = parseTopLevelProperties(root.content).find(p => p.name === RESERVED_WATCH_KEY);
  if (
    !watchProp || watchProp.kind !== 'data' || !watchProp.value ||
    !isObjectLiteral(watchProp.value) || watchProp.valueStart === undefined
  ) {
    return [];
  }

  // 値テキストの先頭空白ぶんだけ `{` がずれる。中身はその次から始まる。
  const leading = watchProp.value.length - watchProp.value.trimStart().length;
  const innerStart = root.start + watchProp.valueStart + leading + 1;

  const entries: WatchEntryInfo[] = [];
  for (const entry of parseTopLevelProperties(extractObjectContent(watchProp.value))) {
    if (entry.nameStart === undefined || entry.nameEnd === undefined) continue;
    entries.push({
      key: entry.name,
      start: innerStart + entry.nameStart,
      end: innerStart + entry.nameEnd,
      // メソッド短縮記法は関数。data は値リテラルの形で判定し、識別子参照は疑わない。
      definitelyNotFunction: entry.kind === 'data' && isNonFunctionLiteral(entry.value),
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
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const watchProp = parseTopLevelProperties(root.content).find(p => p.name === RESERVED_WATCH_KEY);
  if (!watchProp || watchProp.nameStart === undefined || watchProp.nameEnd === undefined) {
    return null;
  }
  const span = { start: root.start + watchProp.nameStart, end: root.start + watchProp.nameEnd };
  if (watchProp.kind === 'method') {
    return span;
  }
  if (watchProp.kind !== 'data' || !watchProp.value) return null;
  const trimmed = watchProp.value.trim();
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
  if (prop.name === RESERVED_STREAMS_KEY && prop.kind === 'data' && prop.value && isObjectLiteral(prop.value)) {
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
  const match = value.trim().match(/^["']([^"'\\]*)["']$/);
  return match && match[1].length > 0 ? match[1] : null;
}

/**
 * `$streams` エントリ定義オブジェクトから `initial` プロパティを取り出す。
 */
function findStreamInitialProperty(entryValue: string): PropertyInfo | undefined {
  const defProps = parseTopLevelProperties(extractObjectContent(entryValue));
  return defProps.find(p => p.kind === 'data' && p.name === 'initial');
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
function pushDataPropertyPaths(prop: PropertyInfo, paths: PathCandidate[]): void {
  pushDataPropertyPathsAt(prop.name, prop, paths, 0);
}

/**
 * `path` に紐づくデータプロパティのパス候補を生成し、オブジェクトリテラルなら
 * 子プロパティへ再帰する（`MAX_OBJECT_NEST_DEPTH` まで）。
 */
function pushDataPropertyPathsAt(
  path: string,
  prop: PropertyInfo,
  paths: PathCandidate[],
  depth: number,
): void {
  // データプロパティ
  paths.push({ path, kind: 'data', typeHint: prop.typeHint, rawInitial: prop.value?.trim() });

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
      pushDataPropertyPathsAt(`${path}.*.${childProp.name}`, childProp, paths, depth + 1);
    }
    return;
  }

  // オブジェクトの場合、子パスを生成（さらにネストしたオブジェクトも辿る）
  if (prop.value && isObjectLiteral(prop.value)) {
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const childProps = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const childProp of childProps) {
      if (childProp.kind !== 'data') continue;
      pushDataPropertyPathsAt(`${path}.${childProp.name}`, childProp, paths, depth + 1);
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
  value?: string;
  typeHint?: string;
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
 * `export default { ... }` からオブジェクトリテラルの中身を抽出する。
 */
function extractDefaultExportObject(script: string): string | null {
  return locateDefaultExportObject(script)?.content ?? null;
}

/**
 * オブジェクトリテラルのトップレベルプロパティを解析する。
 * トークンベースでスキャンし、ネストされた括弧をスキップする。
 *
 * 走査はマスク済みの鏡像（コメント・文字列リテラルの中身を空白に潰したもの）に対して
 * 行い、名前と値のテキストは原文から切り出す。鏡像は原文と長さ・オフセットが一致する。
 */
function parseTopLevelProperties(objectContent: string): PropertyInfo[] {
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
  const regex = /(?:(?:get|set)\s+(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*\([^)]*\)\s*\{)|(?:(?:async\s+)?(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*\([^)]*\)\s*\{)|(?:(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*:\s*)/gd;

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
      props.push({
        name: accessorName, kind: 'getter', value: body, valueStart: bodyStart,
        nameStart: nameSpan![0], nameEnd: nameSpan![1],
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
    if (propName) {
      const valueStartIndex = match.index + match[0].length;
      const value = extractFullValue(objectContent, scan, valueStartIndex);
      // JSDoc @type アノテーションがあれば優先、なければ値から推定
      const jsdocType = extractJsDocType(objectContent, match.index);
      const typeHint = jsdocType ?? inferTypeHint(value);
      props.push({
        name: propName,
        kind: 'data',
        value,
        typeHint,
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
function maskCommentsAndStrings(source: string): string {
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
  let depth = 0;
  let inString: string | null = null;

  for (let i = openBraceIndex; i < scan.length; i++) {
    const ch = scan[i];

    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(openBraceIndex + 1, i);
      }
    }
  }

  return text.slice(openBraceIndex + 1);
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
function isObjectLiteral(value: string): boolean {
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
 * プロパティの直前にある JSDoc `@type` コメントから型ヒントを抽出する。
 *
 * 対応パターン:
 * - `/** @type {string} * /`
 * - `/** @type {boolean|null} * /`
 * - `/** @type {number[]} * /`
 *
 * Union 型の場合、null/undefined を除いた主要な型を返す。
 */
function extractJsDocType(content: string, propIndex: number): string | undefined {
  // プロパティの直前の空白・改行をスキップして JSDoc コメントを探す
  const before = content.slice(Math.max(0, propIndex - 200), propIndex);
  const jsdocMatch = before.match(/\/\*\*\s*@type\s*\{([^}]+)\}\s*\*\/\s*$/);
  if (!jsdocMatch) return undefined;

  const typeExpr = jsdocMatch[1].trim();
  return normalizeJsDocType(typeExpr);
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
 * script / JSON 由来の候補に schema 由来の候補を合流させる。同じ state・同じパスは
 * schema が勝つ（D12: 明示の契約が正規表現推定より優先）。applicationStates が無ければ
 * そのまま返す。
 */
export function mergeSchemaCandidates(
  candidates: PathCandidate[],
  applicationStates?: ReadonlyMap<string, JsonSchemaNode>,
): PathCandidate[] {
  if (applicationStates === undefined || applicationStates.size === 0) return candidates;
  const schemaCandidates: PathCandidate[] = [];
  const schemaKeys = new Set<string>();
  for (const schema of applicationStates.values()) {
    for (const p of analyzeSchemaPaths(schema)) {
      schemaCandidates.push(p);
      schemaKeys.add(p.path);
    }
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
