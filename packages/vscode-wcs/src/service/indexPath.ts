/**
 * indexPath.ts — 束縛に書いた数値添字のパス（`items.0.v`）をランタイムがどう読むか（#355）。
 *
 * 正本は @wcstack/state の `address/indexPathAccessor.ts` の `isIndexPath`（#332）と、実行時の存在の
 * 診断 `diagnostics/pathChecks.ts` の `resolvePathExistence`:
 * - 数値の区切り（`Number()` が NaN にならないセグメント。`01` も `1e0` も `1` と同じ行 1 を指す）が
 *   ちょうど 1 つで、`*` を持たず、先頭が数値でないパスは「いまその位置にある行」を読む。
 *   添字のパスへの書き込み・要素の差し替え・並べ替えに追従し、行 getter（`get "items.*.double"()`）も
 *   `items.0.double` で読める。存在は、数値の区切りを `*` に読み替えたパスで検査する — ただし親が
 *   リストで、添字が負でないときだけ（負の添字・配列でない親は素のキーとして探す）。
 * - 数値の区切りを持つそれ以外のパス（区切りが 2 つ以上・`*` と混ざる・省略パスの `.tags.0`・数値の
 *   `for` の行の `.v` → `groups.0.items.*.v`）は素のパスのまま。添字を通した書き込みは届かず、最初の値で
 *   止まることがある。存在は、実行時と同じく配列の上の添字（`"0"` のような配列のキーの綴り）を要素として
 *   辿って、データの候補と照合する（isPlainElementPath）。
 * - `for:` の対象が数値の区切りを持つリスト（`for: groups.0.items`）は、行が `groups.0.items.*.…` として
 *   解決される。初期表示とリストの置き換えには追従するが、行への双方向束縛（`value: .v`）と添字のパスの
 *   読み書き（`this["groups.0.items.0.v"]`）は実行時に投げる（state の #363）。bindingValidator が
 *   `for:` そのものに `wcs/template-syntax` を出す（hasIndexSegment）。
 * - 数値のキーを持つオブジェクト（`sales.2024.total`）は素のキー。実行時も作者の同名のキーが先なので、
 *   呼び手は読み替えより先に候補集合の完全一致を見る。
 *
 * 実行時にしか分からない条件（拡張できない state — `Object.freeze` など — では素のパスになる・素のパスの
 * 添字の位置に要素があるか）は見ない。警告を出さない側に倒す。
 */

import type { PathCandidate } from './stateAnalyzer.js';

/** 配列の要素のキーになる綴り（`"0"`・`"12"`）。`01` / `1e0` / `-1` は配列の上で素のキーとして見つからない */
const ARRAY_INDEX_KEY = /^(?:0|[1-9]\d*)$/;

/**
 * 数値の区切りか（実行時の ResolvedAddress と同じ `Number()` の判定）。空のセグメントは数えない —
 * 省略パスの先頭（`.tags.0` の `""`）を数値と取り違えないため（空の区切りは正本パーサが
 * `wcs/binding-syntax` で拒否する）。
 */
function isNumericSegment(segment: string): boolean {
  return segment !== '' && !Number.isNaN(Number(segment));
}

/** 行として読まれるパスなら、その数値の区切りの位置。行として読まれないパスは -1。 */
function rowIndexPosition(segments: readonly string[]): number {
  // `*` を持つパスと省略パス（`items.*.…` に展開される）は、数値の区切りが 1 つでも行にならない
  if (segments[0] === '' || segments.includes('*')) return -1;
  let position = -1;
  for (let i = 0; i < segments.length; i++) {
    if (!isNumericSegment(segments[i])) continue;
    // 先頭の数値はルートのキー（`2024.total`）。2 つ目の数値の区切りは素のパス
    if (i === 0 || position !== -1) return -1;
    position = i;
  }
  return position;
}

/**
 * 添字の位置に数値の区切りを持つのに、行としては読まれないパスか（`groups.0.items.0.v`・`.tags.0`）。
 * `wcs/template-syntax` の警告の対象。先頭の数値はルートのキーなので添字に数えない。
 */
export function isPlainIndexPath(path: string): boolean {
  return hasIndexSegment(path) && rowIndexPosition(path.split('.')) === -1;
}

/** 添字の位置（先頭以外）に数値の区切りを持つか。先頭の数値はルートのキーなので数えない。 */
export function hasIndexSegment(path: string): boolean {
  return path.split('.').some((segment, i) => i > 0 && isNumericSegment(segment));
}

/**
 * 候補集合と照合する形。行として読まれるパスは、数値の区切りを `*` に読み替える
 * （`items.0.double` → `items.*.double`）。読み替えないパスはそのまま返す。
 *
 * 親がリストか（`<親>.*` が候補にあるか）で読み替えを決める。実行時も親が配列のときだけ行として探し、
 * 配列でない親（`sales.2025.total`）は素のキーとして探して、無ければ報告する。
 */
export function toRowPatternPath(path: string, pathSet: ReadonlySet<string>): string {
  const segments = path.split('.');
  const position = rowIndexPosition(segments);
  if (position === -1 || Number(segments[position]) < 0) return path;
  if (!pathSet.has(`${segments.slice(0, position).join('.')}.*`)) return path;
  segments[position] = '*';
  return segments.join('.');
}

/**
 * 素のパス（行として読まれないパス）を、要素の形（`*`）へ読み替える。
 *
 * 実行時の存在の診断（resolvePathExistence）は素のパスを 1 段ずつ辿り、配列の上の数値の区切りは
 * その位置の要素として降りる（`groups.0.items.*.v`・`groups.0.items.0.v` は、要素があれば存在する）。
 * 要素の形は `*` の候補と同じなので、親がリスト（`<親>.*` が候補にある）で配列のキーの綴りの添字を
 * `*` に読み替える。親は読み替え済みの形で見る（`groups.0.items.0` の 2 つ目の添字の親は `groups.*.items`）。
 * 行として読まれるパスに掛けても、`toRowPatternPath` の結果は変わらない（そちらで読み替え済みか、
 * 負の添字・親がリストでないので読み替えない）。
 */
export function toPlainPatternPath(path: string, pathSet: ReadonlySet<string>): string {
  const segments = path.split('.');
  for (let i = 1; i < segments.length; i++) {
    if (ARRAY_INDEX_KEY.test(segments[i]) && pathSet.has(`${segments.slice(0, i).join('.')}.*`)) {
      segments[i] = '*';
    }
  }
  return segments.join('.');
}

/**
 * 素のパスが、リストの要素を添字で辿って届くデータか（読み替えた形がデータの候補 — kind: data / list）。
 *
 * 行 getter（`get "groups.*.items.*.double"()`）は数えない — 素のパスは行を持たないので、実行時は
 * getter を呼ばずに空で描く（`for: groups.0.items` の中の `.double` は、#332 の暗黙のアクセサが接頭辞の
 * 記述子になって存在の検査が判定不能に倒れ、実行時の警告も出ない — state 側の別件）。要素の個数は静的に
 * 分からないので、その位置に要素があるものとして扱う。
 */
export function isPlainElementPath(path: string, candidates: readonly PathCandidate[], pathSet: ReadonlySet<string>): boolean {
  const pattern = toPlainPatternPath(path, pathSet);
  return candidates.some(c => c.path === pattern && (c.kind === 'data' || c.kind === 'list'));
}
