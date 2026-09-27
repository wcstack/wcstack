/**
 * updater/updateBatch.ts
 *
 * 次に drain されるバッチの番号（updater が drain を始めるたびに進める）。書き込みが同じバッチのものかを
 * 見る側が読む — 要素書き込みの入れ替えの、揃う前の書き込み（proxy/methods/setByAddress.ts・#361）と、
 * 行はそのままで要素が替わった行の差分（list/createListDiff.ts・#359）。
 * updater は描画の適用を読み込むので、list/ から updater.ts を読むと循環する。番号だけを葉のモジュールに置く。
 */
export let updateBatch = 0;

/** drain を始めた（updater 専用） */
export function advanceUpdateBatch(): void {
  updateBatch++;
}
