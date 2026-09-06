/**
 * ナビゲーションターゲット文字列の分解（docs/router-state-contract-design.md §4.1）。
 *
 * ナビゲーションターゲットを受理する全地点（Router.navigate / Link の href 組み立て・
 * active 判定）で使う共通規範。最初の `#` より後を hash、残りの最初の `?` より後を
 * search として分離する。normalizePathname / basename 結合は pathname にのみ適用し、
 * search / hash は再結合して URL を組み立てる。
 *
 * 受理形:
 * - `/path` / `path` — クエリ無し遷移（現在のクエリは引き継がない）
 * - `/path?k=v`      — パス遷移＋クエリ指定
 * - `?k=v`           — クエリのみ遷移（pathname 空 = 現在値を維持する合図）
 * - `?`              — クエリの全消去（pathname 維持）
 */
export interface IUrlTarget {
  /** クエリ・ハッシュを除いたパス部。クエリのみ遷移では "" */
  pathname: string;
  /** "?k=v" 形式（先頭 `?` 込み）。無ければ "" */
  search: string;
  /** "#x" 形式（先頭 `#` 込み）。無ければ "" */
  hash: string;
}

export function splitUrlTarget(to: string): IUrlTarget {
  let rest = to;
  let hash = "";
  const hashIndex = rest.indexOf("#");
  if (hashIndex >= 0) {
    hash = rest.slice(hashIndex);
    rest = rest.slice(0, hashIndex);
  }
  let search = "";
  const searchIndex = rest.indexOf("?");
  if (searchIndex >= 0) {
    search = rest.slice(searchIndex);
    rest = rest.slice(0, searchIndex);
  }
  return { pathname: rest, search, hash };
}

/**
 * URL 再結合時の search。`?` 単独は「クエリの全消去」の合図なので "" にする。
 */
export function effectiveSearch(search: string): string {
  return search === "?" ? "" : search;
}
