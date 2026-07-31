/**
 * occurrenceWrite.ts
 *
 * wc-bindable の `semantics: "event"` を宣言した property から届いた値を state へ書き込む
 * 間だけ、same-value guard（`config.sameValueGuard`・既定 ON）を 1 回分だけ無効化する
 * one-shot トークン。
 *
 * 背景:
 * same-value guard は primitive が `Object.is` 同値なら set / enqueue / 依存伝播 / DOM 適用 /
 * `$updatedCallback` をまるごとスキップする。current value（state）にとっては正しい最適化だが、
 * occurrence（同じ payload でも「もう一度起きた」ことに意味がある）へ適用すると発生を取りこぼす。
 * どちらであるかは producer の declaration が `semantics` で宣言する
 * （docs/architecture-hardening/12-wc-bindable-observable-inventory.md）。
 *
 * one-shot にしている理由:
 * フラグを書き込みの呼び出しスタック全体へ張ると、その内側で走る `$updatedCallback` や
 * 依存伝播が行う無関係な書き込みまでガードを失う。`setByAddress` が最初のガード評価で
 * トークンを消費するため、影響は目的の 1 write に閉じる。
 */

let pending = false;

/** 直後の 1 write を occurrence として扱う。必ず `endOccurrenceWrite` と対で使う。 */
export function beginOccurrenceWrite(): void {
  pending = true;
}

/** 未消費のトークンを破棄する（write が setByAddress へ到達しなかった場合の後始末）。 */
export function endOccurrenceWrite(): void {
  pending = false;
}

/**
 * ガード評価側が呼ぶ。`true` を返したら、その 1 回だけ same-value guard を飛ばす。
 * トークンは呼んだ時点で消費される。
 */
export function consumeOccurrenceWrite(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}
