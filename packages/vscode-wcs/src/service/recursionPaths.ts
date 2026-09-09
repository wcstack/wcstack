/**
 * recursionPaths.ts
 *
 * `$recursion` の**パス代数**だけを置く純モジュール（他の service に依存しない）。
 *
 * ランタイム側の正本は `@wcstack/state` の `src/recursion/{declaration,expand,registry}.ts`。
 * ここはその判定のうち **静的に決まる部分だけ** を写す:
 *
 *   - `$recursion` のアンカー / 反復サブパスの形（`assertNodePath` と同条件・同順）
 *   - `**` を含むパスをアンカーと突き合わせて接尾辞に割る（`splitRecursivePath`）
 *   - 具体パス（`nodes.*.children.*.total`）を深さと残りに畳む
 *     （`recursion/bind.ts` の `depthOfConcretePathPrefix` と同じ数え方）
 *   - `$setAll` が拒否する形（構造への書き込み・再帰 getter への書き込み）
 *
 * データを見る判定（共有配列 / 循環 / 深さ超過）は**静的には決まらない**のでここには無い。
 * ランタイム専用の診断（`wcs/recursion-shared-list` / `-cycle` / `-depth-exceeded`）である。
 */

/** 再帰ワイルドカード（オーサリング層専用の記号）。 */
export const RECURSION_WILDCARD = '**';

/** `$recursion` 宣言キー（@wcstack/state src/define.ts の STATE_RECURSION_NAME が正本）。 */
export const RECURSION_KEY = '$recursion';

/** 単一の自己再帰宣言。ランタイムの `IRecursionSpec` に `*List` を足したもの。 */
export interface RecursionSpec {
  /** `"nodes.*"` — 深さ 0 のノードパス。 */
  readonly anchor: string;
  /** `"children.*"` — 1 段深くする相対サブパス。 */
  readonly repeat: string;
  /** `"nodes.**"` — アンカーの `**` 形。オーサリング層のパスはこれで始まる。 */
  readonly recursiveAnchor: string;
  /** `"nodes"` — アンカーのリスト側（末尾の `.*` を落とした形）。 */
  readonly anchorList: string;
  /** `"children"` — 反復サブパスのリスト側。 */
  readonly repeatList: string;
}

/** アンカー / 反復サブパスの形の不正（ランタイムの raiseError と 1:1・判定順も同じ）。 */
export type NodePathProblem =
  | 'empty'
  | 'emptySegment'
  | 'notElement'
  | 'reservedRoot'
  | 'reservedMount'
  | 'midWildcard'
  | 'nestedRecursion';

/** アンカー / 反復サブパスの種別（メッセージの主語）。 */
export type NodePathKind = 'anchor' | 'repeat';

/** `**` を含むか（含まない大多数のパスを 1 回の indexOf で抜ける）。 */
export function hasRecursionWildcard(path: string): boolean {
  return path.indexOf(RECURSION_WILDCARD) !== -1;
}

/**
 * `a.b.*` の形か（`@wcstack/state` recursion/declaration.ts `assertNodePath` の写し）。
 * 問題が無ければ null。複数該当するときは**ランタイムが先に落とす方**を返す。
 */
export function checkNodePath(path: string): NodePathProblem | null {
  if (typeof path !== 'string' || path.length === 0) return 'empty';
  const segments = path.split('.');
  if (segments.some(segment => segment.length === 0)) return 'emptySegment';
  if (segments.length < 2 || segments[segments.length - 1] !== '*') return 'notElement';
  if (segments[0].startsWith('$')) return 'reservedRoot';
  if (path.indexOf('#') !== -1) return 'reservedMount';
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === '*') return 'midWildcard';
    if (segments[i] === RECURSION_WILDCARD) return 'nestedRecursion';
  }
  return null;
}

/** 検証済みのアンカーと反復サブパスから spec を作る。 */
export function makeRecursionSpec(anchor: string, repeat: string): RecursionSpec {
  return Object.freeze({
    anchor,
    repeat,
    recursiveAnchor: anchor.slice(0, anchor.lastIndexOf('.')) + '.' + RECURSION_WILDCARD,
    anchorList: anchor.slice(0, anchor.lastIndexOf('.')),
    repeatList: repeat.slice(0, repeat.lastIndexOf('.')),
  });
}

/**
 * `**` を含むパスを宣言と突き合わせ、接尾辞（`**` より後ろ・無ければ空文字）を返す。
 * 宣言に合致しない（アンカー違い・2 つ目の `**`）なら null。
 */
export function splitRecursivePath(spec: RecursionSpec, path: string): string | null {
  if (path === spec.recursiveAnchor) return '';
  if (!path.startsWith(spec.recursiveAnchor + '.')) return null;
  const suffix = path.slice(spec.recursiveAnchor.length);
  // 2 つ目の `**`（複数の再帰点）は初版では未対応
  return hasRecursionWildcard(suffix) ? null : suffix;
}

/** 具体パスを「反復の段数」と「残り」に畳んだ結果。 */
export interface FoldedPath {
  /** 反復語の段数（`nodes.*.children.*.total` → 1）。 */
  readonly depth: number;
  /** 反復を剥がした残り（`".total"` / `""`）。 */
  readonly rest: string;
}

/**
 * 具体パスをアンカー直後の反復語で畳む。アンカーで始まらない / 反復の直後が
 * パス境界でない場合は null。
 *
 * 文字列中の反復語の**出現数では数えない** — アンカー直後から前方一致で剥がす
 * （`recursion/bind.ts` の `depthOfConcretePathPrefix` と同じ数え方）。
 */
export function foldRecursion(spec: RecursionSpec, path: string): FoldedPath | null {
  if (!path.startsWith(spec.anchor)) return null;
  const unit = '.' + spec.repeat;
  let cursor = spec.anchor.length;
  let depth = 0;
  while (path.startsWith(unit, cursor)) {
    cursor += unit.length;
    depth++;
  }
  // 接頭辞の直後はパス境界（末尾、または `.`）でなければならない
  if (cursor !== path.length && path.charCodeAt(cursor) !== 46 /* '.' */) return null;
  return { depth, rest: path.slice(cursor) };
}

/**
 * 具体パスが「宣言済みの再帰の展開形」として説明できるか。
 *
 * ランタイムが `pathDiagnostics.checkDeclaredPath` で
 * `recursionRegistry.matchesRecursivePath` を先に見るのと同じ役割。あちらは
 * 「`**` getter の展開形か」だけを見るが、静的側は候補集合しか持たないので
 * **深さを畳んでから候補集合に当てる**:
 *
 *   - `nodes.*.children.*.total` → 深さ 1・残り `.total` → `nodes.**.total`（`**` getter）
 *   - `nodes.*.children.*.value` → 深さ 1・残り `.value` → `nodes.*.value`（行の形は
 *     深さによらず同じ、というのが `$recursion` 宣言の意味）
 *
 * `has` は候補集合の照会。存在を**足す**方向にしか効かないので、誤検出は増えない。
 */
export function matchesRecursion(
  specs: readonly RecursionSpec[],
  path: string,
  has: (candidate: string) => boolean,
): boolean {
  for (const spec of specs) {
    const folded = foldRecursion(spec, path);
    if (folded === null) continue;
    if (has(spec.anchor + folded.rest)) return true;
    if (has(spec.recursiveAnchor + folded.rest)) return true;
  }
  return false;
}

/**
 * 候補集合に載っている `$recursion` のマーカー（`kind: 'recursionAnchor'`）から仕様を復元する。
 *
 * 宣言を候補集合に載せて運ぶのは、マウント接頭辞の付与・外部 state ファイルの解決
 * （statePathResolver）といった既存の配管をそのまま通すため。マウント配下の宣言は
 * `path` だけが接頭辞付きになり、反復サブパスはノード相対なのでそのままでよい。
 */
export function collectRecursionSpecs(
  candidates: readonly { readonly kind: string; readonly path: string; readonly repeat?: string }[],
): RecursionSpec[] {
  const out: RecursionSpec[] = [];
  for (const candidate of candidates) {
    if (candidate.kind !== 'recursionAnchor' || typeof candidate.repeat !== 'string') continue;
    if (!candidate.path.endsWith('.' + RECURSION_WILDCARD)) continue;
    const anchor = candidate.path.slice(0, candidate.path.length - RECURSION_WILDCARD.length) + '*';
    if (out.some(spec => spec.anchor === anchor && spec.repeat === candidate.repeat)) continue;
    out.push(makeRecursionSpec(anchor, candidate.repeat));
  }
  return out;
}

/** `$recursion` 宣言そのものが含意する構造パス（`$listKeys` の実体化と同じ性格）。 */
export interface ImpliedPath {
  readonly path: string;
  readonly kind: 'data' | 'list';
  readonly typeHint?: string;
}

/**
 * 宣言だけから確定する構造パスを深さ 0 ぶん返す（深さ 1 以上は `foldRecursion` が畳む）。
 *
 * ランタイムが `listPathsUpTo` で `listPaths` に載せる経路（`nodes` /
 * `nodes.*.children` / …）と同じ集合を、静的側では候補として出す。宣言は
 * 「そのパスは再帰する木である」という作者の明示なので、初期値が `[]` で
 * 行の形が読めなくてもこの構造は確定する。
 */
export function impliedStructurePaths(spec: RecursionSpec): ImpliedPath[] {
  const out: ImpliedPath[] = [
    { path: spec.anchorList, kind: 'data', typeHint: 'array' },
    { path: spec.anchor, kind: 'list' },
    { path: `${spec.anchorList}.length`, kind: 'data', typeHint: 'number' },
  ];
  // 反復サブパスが多段（`branch.children.*`）なら途中のオブジェクトも含意される
  const repeatSegments = spec.repeatList.split('.');
  for (let i = 1; i < repeatSegments.length; i++) {
    out.push({ path: `${spec.anchor}.${repeatSegments.slice(0, i).join('.')}`, kind: 'data' });
  }
  out.push({ path: `${spec.anchor}.${spec.repeatList}`, kind: 'data', typeHint: 'array' });
  out.push({ path: `${spec.anchor}.${spec.repeat}`, kind: 'list' });
  out.push({ path: `${spec.anchor}.${spec.repeatList}.length`, kind: 'data', typeHint: 'number' });
  return out;
}

/** 一括書き込みが「再帰の構造そのもの」を名指しているときの種別。 */
export type StructuralWriteTarget = 'node' | 'list';

/**
 * `$setAll` の接尾辞が構造を名指しているか（ランタイム
 * `recursion/setAllRecursive.ts` の `assertNotStructural` の写し）。
 *
 * ノード自身（`nodes.**`）・子リスト（`nodes.**.children`）・子ノード
 * （`nodes.**.children.*`）は、書き換えると確定済みの子アドレスを壊す。
 */
export function structuralWriteTarget(spec: RecursionSpec, suffix: string): StructuralWriteTarget | null {
  const unit = '.' + spec.repeat;
  let rest = suffix;
  while (rest.startsWith(unit)) rest = rest.slice(unit.length);
  if (rest.length === 0) return 'node';
  if (rest === '.' + spec.repeatList) return 'list';
  return null;
}

/**
 * 2 つの接尾辞が**同じ具体パス族**を指すか（`RecursionRegistry._sameFamily` の写し）。
 * 片方がもう片方の末尾で、差分が反復語の整数倍（0 回を含む）のとき真。
 */
export function sameFamily(spec: RecursionSpec, a: string, b: string): boolean {
  const unit = '.' + spec.repeat;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.endsWith(shorter)) return false;
  const gap = longer.slice(0, longer.length - shorter.length);
  if (gap.length === 0) return true;
  if (gap.length % unit.length !== 0) return false;
  for (let cursor = 0; cursor < gap.length; cursor += unit.length) {
    if (!gap.startsWith(unit, cursor)) return false;
  }
  return true;
}

/**
 * その接尾辞が宣言済みの `**` getter と衝突するなら、その getter の接尾辞を返す
 * （`RecursionRegistry.conflictingRecursiveGetter` の写し）。
 */
export function conflictingGetterSuffix(
  spec: RecursionSpec,
  getterSuffixes: readonly string[],
  suffix: string,
): string | null {
  for (const declared of getterSuffixes) {
    if (sameFamily(spec, declared, suffix)) return declared;
    if (suffix.startsWith(declared + '.')) return declared;
  }
  return null;
}
