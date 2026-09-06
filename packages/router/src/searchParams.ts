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
