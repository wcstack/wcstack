/**
 * recursion/expand.ts
 *
 * `**` を含むオーサリング層のパスと、エンジンが扱う具体パスの相互変換。
 * **純関数だけ**を置く（state も proxy も触らない）。
 *
 * 変換は 1 対 1 ではなく 1 対多である。`nodes.**.total` は深さごとに
 * `nodes.*.total` / `nodes.*.children.*.total` / … という無限の族を表し、
 * エンジンが見るのは常にそのうちの 1 本だけ（設計書 D2）。
 */

import { DELIMITER, MAX_WILDCARD_DEPTH, RECURSION_WILDCARD, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import { IRecursionSpec } from "./types";

/** `**` を含むか（含まない大多数のパスを 1 回の indexOf で抜ける）。 */
export function hasRecursionWildcard(path: string): boolean {
  return path.indexOf(RECURSION_WILDCARD) !== -1;
}

/**
 * `**` を含むパスを宣言と突き合わせ、接尾辞（`**` より後ろ。無ければ空文字）を返す。
 * 宣言に合致しない `**` は「宣言なしの `**`」として呼び出し側が診断する（null を返す）。
 */
export function splitRecursivePath(spec: IRecursionSpec, path: string): string | null {
  if (path === spec.recursiveAnchor) {
    return "";
  }
  const prefix = spec.recursiveAnchor + DELIMITER;
  if (!path.startsWith(prefix)) {
    return null;
  }
  const suffix = path.slice(spec.recursiveAnchor.length);
  // 接尾辞に 2 つ目の `**` があるのは初版では未対応（複数の再帰点）。
  if (hasRecursionWildcard(suffix)) {
    return null;
  }
  // 接尾辞は整形されたパスでなければならない: 空セグメント（`nodes.**.` / `nodes.**..x`）と
  // `**` 直後の素の `*`（`nodes.**.*` — 展開すると `nodes.*.*` でアンカー行そのもの）は
  // 受理しない。`assertNodePath` / `$watch` が同じ形を拒否するのと対称（第 4 サイクルで実測:
  // 受理すると `[undefined×n]` や生の `Reflect.set called on non-object` になっていた）。
  const segments = suffix.slice(DELIMITER.length).split(DELIMITER);
  if (segments[0] === WILDCARD || segments.some((segment) => segment.length === 0)) {
    return null;
  }
  return suffix;
}

/**
 * 接尾辞（`.` で始まる）の添字セグメントだけを `*` に畳む。先頭の空セグメントは区切りの
 * 都合なので畳まない（`indexSegmentsToWildcard` に丸ごと渡すと `Number("") === 0` で `*` になる）。
 * `**` パスの検査（構造・読み取り専用）と `**` getter キーの検査が共有する。
 */
export function foldSuffixIndexes(suffix: string): string {
  return suffix.length === 0 ? suffix : DELIMITER + indexSegmentsToWildcard(suffix.slice(DELIMITER.length));
}

/**
 * 2 つの接尾辞が**同じ具体パス族**を指すか。片方がもう片方の末尾で、差分が反復語の
 * 整数倍（0 回を含む）のとき真。`nodes.**.total` と `nodes.**.children.*.total` は
 * 深さ k と k+1 で同じ `nodes.*.children.*.total` になる、という関係を捉える。
 * 静的側の `recursionPaths.sameFamily` と同じ純関数。
 */
export function sameFamily(spec: IRecursionSpec, a: string, b: string): boolean {
  const unit = DELIMITER + spec.repeat;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.endsWith(shorter)) {
    return false;
  }
  const gap = longer.slice(0, longer.length - shorter.length);
  if (gap.length === 0) {
    return true;
  }
  if (gap.length % unit.length !== 0) {
    return false;
  }
  for (let cursor = 0; cursor < gap.length; cursor += unit.length) {
    if (!gap.startsWith(unit, cursor)) {
      return false;
    }
  }
  return true;
}

/**
 * 接尾辞 `suffix` が、`**` getter の接尾辞 `familySuffix` の族そのもの、またはその値の内側を
 * 指しているか。`.` 境界で切った各接頭辞 `p`（全体を含む）について `sameFamily(familySuffix, p)`
 * を見る — `startsWith(familySuffix + ".")` だけでは、反復語ぶんずれた展開形の値の内側
 * （`nodes.**.children.*.total.x` で `nodes.**.total`）を取りこぼす（第 4 サイクルで実測）。
 */
export function coversSuffix(spec: IRecursionSpec, familySuffix: string, suffix: string): boolean {
  for (let end = suffix.length; end > 0; end = suffix.lastIndexOf(DELIMITER, end - 1)) {
    if (sameFamily(spec, familySuffix, suffix.slice(0, end))) {
      return true;
    }
  }
  return false;
}

/**
 * 添字セグメント（`nodes.1.total` の `1`）を `*` に畳む。判定は `address/ResolvedAddress.ts`
 * と同じ「`Number()` が NaN でない区切り」。API のパス引数（`$getAll` / `$setAll` / `$resolve`）と
 * `**` パスの接尾辞は set トラップと違って `getResolvedAddress` の正規化を経ないので、
 * 再帰の検査（読み取り専用・構造）に掛ける前にここで畳む。
 */
export function indexSegmentsToWildcard(path: string): string {
  const segments = path.split(DELIMITER);
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] !== WILDCARD && !Number.isNaN(Number(segments[i]))) {
      segments[i] = WILDCARD;
    }
  }
  return segments.join(DELIMITER);
}

/**
 * `**` パスの接尾辞が「再帰の構造そのもの」を名指しているか。
 *
 * ノード自身（`nodes.**` / `nodes.**.children.*`）・子リスト（`nodes.**.children`）・その
 * `length`（`arr.length = 0` は配列を切り詰める）・多段の反復サブパスなら子リストへ至る
 * 途中のオブジェクト（`nodes.**.branch`）。書き側（`setAllRecursive`）は確定済みの
 * 子アドレスを壊すので拒否し、宣言側（`**` getter のキー）は生成 getter が実データの
 * 子リストを影にするので拒否する — 同じ述語を両方が使う。
 *
 * 反復サブパスを**途中まで**名指す形もすべて構造。`"." + repeatList` との完全一致だけを
 * 見ると、多段の repeat で途中のオブジェクトが素通りし、深さ 0 の `branch` を置き換えた
 * 瞬間に確定済みの深さ 1 のアドレスが宙に浮く（着地後レビューで実測。実装計画 §7-3）。
 */
export function isStructuralSuffix(spec: IRecursionSpec, suffix: string): boolean {
  const repeatSegments = spec.repeat.split(DELIMITER);
  const repeatList = repeatSegments.slice(0, -1).join(DELIMITER);
  const unit = DELIMITER + spec.repeat;
  let rest = suffix;
  while (rest.startsWith(unit)) {
    rest = rest.slice(unit.length);
  }
  if (rest.length === 0 || rest === DELIMITER + repeatList + DELIMITER + "length") {
    return true;
  }
  for (let i = 1; i < repeatSegments.length; i++) {
    if (rest === DELIMITER + repeatSegments.slice(0, i).join(DELIMITER)) {
      return true;
    }
  }
  return false;
}

/** 深さ k の具体パスを作る。上限超過は生成前に throw する（設計書 D11）。 */
export function concretePathAt(spec: IRecursionSpec, suffix: string, depth: number): string {
  if (depth < 0) {
    raiseError(`Recursion depth must not be negative (got ${depth}).`);
  }
  let path = spec.anchor;
  for (let i = 0; i < depth; i++) {
    path += DELIMITER + spec.repeat;
  }
  const full = path + suffix;
  // ワイルドカード段数は展開後のパス全体で数える（アンカー・反復・接尾辞をすべて含む）。
  // intern（getPathInfo）より**前**に文字列から数える — 上限超過のパスを永続キャッシュ
  // （PathInfo の `_cache`）に残さない（設計書 D10「毎ノードの固有パスを intern しない」）。
  let wildcardCount = 0;
  for (const segment of full.split(DELIMITER)) {
    if (segment === WILDCARD) {
      wildcardCount++;
    }
  }
  if (wildcardCount > MAX_WILDCARD_DEPTH) {
    raiseError(
      `[wcs/recursion-depth-exceeded] Recursion on "${spec.anchor}" reached depth ${depth} ` +
      `("${full}"), which needs ${wildcardCount} wildcard levels — the limit is ${MAX_WILDCARD_DEPTH}. ` +
      `Either the data nests deeper than the engine can address, or the tree contains a cycle.`
    );
  }
  return full;
}

/** 深さ k のノードパス（接尾辞なし）。リストパスの登録に使う。 */
export function nodePathAt(spec: IRecursionSpec, depth: number): string {
  return concretePathAt(spec, "", depth);
}

/**
 * 深さ k のノードが持つ子リストのパス（`nodes.*.children` / `nodes.*.children.*.children` …）。
 * `listPaths` へ登録する対象（E4）。深さ 0 のアンカー自身のリスト（`nodes`）も含める。
 */
export function listPathsUpTo(spec: IRecursionSpec, depth: number): string[] {
  const paths: string[] = [];
  // アンカー自身のリスト（末尾の `.*` を落とした形）
  paths.push(spec.anchor.slice(0, spec.anchor.lastIndexOf(DELIMITER)));
  const repeatList = spec.repeat.slice(0, spec.repeat.lastIndexOf(DELIMITER));
  for (let k = 0; k < depth; k++) {
    paths.push(nodePathAt(spec, k) + DELIMITER + repeatList);
  }
  return paths;
}

/**
 * 具体パスが「その再帰 getter の深さ k の展開形」なら深さを返す。違えば null。
 *
 * 文字列中の反復語の出現数で数えない — 接尾辞が反復語と同じ綴りを含む場合に
 * 取り違える。前から `anchor`、後ろから `suffix` を確かめ、間が `repeat` の
 * 反復ちょうどであることを見る。
 */
export function depthOfConcretePath(spec: IRecursionSpec, suffix: string, path: string): number | null {
  if (!path.startsWith(spec.anchor)) {
    return null;
  }
  if (suffix.length > 0 && !path.endsWith(suffix)) {
    return null;
  }
  // 接頭辞と接尾辞が**重なって**はならない。重なると slice が空文字に畳まれて
  // 「深さ 0 で一致」に見え、アンカーそのもの（`nodes.*` — 実データの行）が
  // 生成 getter に隠される。接尾辞が `.*` の `nodes.**.*` で実際に踏んだ。
  if (path.length < spec.anchor.length + suffix.length) {
    return null;
  }
  const middle = path.slice(spec.anchor.length, path.length - suffix.length);
  if (middle.length === 0) {
    return 0;
  }
  const unit = DELIMITER + spec.repeat;
  let depth = 0;
  let cursor = 0;
  while (cursor < middle.length) {
    if (!middle.startsWith(unit, cursor)) {
      return null;
    }
    cursor += unit.length;
    depth++;
  }
  return depth;
}
