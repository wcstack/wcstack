/**
 * searchParams の正規化（docs/router-state-contract-design.md §3.5）。
 *
 * - 読み取り形状は `Record<string, string>`。`URLSearchParams` の生ハンドルは
 *   露出しない（生ハンドルを state に入れない規範）。
 * - キー重複（`?tag=a&tag=b`）は **last-wins**。
 * - 値のデコードは `URLSearchParams` に委ねる（`+` → space を含む）。
 * - 露出オブジェクトは freeze したスナップショット（消費側の変異は loud failure）。
 */
export function parseSearchParams(search: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    result[key] = value;
  }
  return Object.freeze(result);
}

/**
 * Record の shallow 比較。params の変化判定（§3.3: 文字列値の shallow 比較）と
 * searchParams の変化判定（§3.5: キーをソートした pair 列の比較 = 順序非依存）に
 * 共通で使う。
 */
export function shallowEqualRecords(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * `<wcs-link to>` のクエリが今のページのクエリに含まれるか（active / aria-current の判定 — docs/seam-apps.md、
 * city-library）。`to` のクエリの各パラメータについて、今のクエリが同じ値（重複キーは同じ値の組、順序は
 * 問わない）を持てば true。今のページにある余分なパラメータは構わない。`to` にクエリが無ければ常に true。
 * 値は `URLSearchParams` でデコードして比べる（`+` と `%20` は同じ）。
 */
export function queryIncludes(current: string, required: string): boolean {
  const want = new URLSearchParams(required);
  const have = new URLSearchParams(current);
  for (const key of new Set(want.keys())) {
    const a = want.getAll(key).sort();
    const b = have.getAll(key).sort();
    if (a.length !== b.length || a.some((value, i) => value !== b[i])) return false;
  }
  return true;
}

/**
 * 2 つのクエリが同じパラメータを同じ値で持つか（順序は問わない — `queryIncludes` を両向きに）。`<wcs-link>` の
 * `aria-current="page"` は、`to` のクエリが今のページのクエリと等しいときだけ（docs/seam-apps.md、city-library の
 * 取り込み: `page` を省いた 1 ページ目へのリンクが、含む規則ではどのページでも現在のページだった）。
 */
export function queryEquals(a: string, b: string): boolean {
  return queryIncludes(a, b) && queryIncludes(b, a);
}
