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
import { IRecursionSpec, IRecursivePathParts } from "./types";

/** `**` を含むか（含まない大多数のパスを 1 回の indexOf で抜ける）。 */
export function hasRecursionWildcard(path: string): boolean {
  return path.indexOf(RECURSION_WILDCARD) !== -1;
}

/**
 * `**` を含むパスを宣言と突き合わせ、接尾辞を取り出す。
 * 宣言に合致しない `**` は「宣言なしの `**`」として呼び出し側が診断する（null を返す）。
 */
export function splitRecursivePath(spec: IRecursionSpec, path: string): IRecursivePathParts | null {
  if (path === spec.recursiveAnchor) {
    return { spec, suffix: "" };
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
  return { spec, suffix };
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
