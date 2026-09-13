/**
 * scan/scanReport.ts
 *
 * `$scan` の失敗の報告（docs/state-scan-design.md D4 / D5）。
 *
 * fold の例外は scan 側で閉じる（drain リスナーと event-token の emit ループを
 * 他の機構と共有しているため）。閉じた事実を console と devtools の両方に出す。
 * devtools には `$watch` と同じ `state:watch-error` を `phase: "fold"` で流す。
 */

import { STATE_SCAN_NAME } from "../define";
import { devtoolsSink } from "../devtools/sink";

export function reportScanError(name: string, error: unknown): void {
  console.error(`[@wcstack/state] ${STATE_SCAN_NAME} fold for "${name}" threw. The output was not written.`, error);
  if (devtoolsSink !== null) {
    devtoolsSink({
      type: "state:watch-error",
      phase: "fold",
      path: `${STATE_SCAN_NAME}.${name}`,
      error,
    });
  }
}

export function isThenable(value: unknown): boolean {
  return value !== null
    && (typeof value === "object" || typeof value === "function")
    && typeof (value as { then?: unknown }).then === "function";
}

/**
 * fold が thenable を返した（同期契約違反）。書き込まずに報告し、
 * 後から reject されても unhandled rejection にしない。
 */
export function reportScanThenable(name: string, value: unknown): void {
  (value as PromiseLike<unknown>).then(undefined, () => undefined);
  reportScanError(
    name,
    new TypeError(`${STATE_SCAN_NAME} fold for "${name}" returned a Promise. fold must be synchronous and return the next value.`),
  );
}

const lateGetterReported: WeakSet<object> = new WeakSet();

/**
 * 宣言時には plain だった `from` が、接ぎ木（ボリュームのアクセサ登録）で後から getter に
 * なった（設計書 D5 後段）。getter の再評価回数を畳まないよう、その scan を止める。
 * entry につき 1 回だけ報告する。
 */
export function reportLateGetterSource(entry: object, name: string, path: string): void {
  if (lateGetterReported.has(entry)) {
    return;
  }
  lateGetterReported.add(entry);
  console.error(
    `[@wcstack/state] [wcs/scan-source-computed] ${STATE_SCAN_NAME} entry "${name}" from "${path}" is now backed by a getter ` +
    `(registered after the declaration, e.g. by a volume). A getter re-evaluates whenever its inputs change, ` +
    `so this scan stopped folding. Fold the plain value the getter reads instead.`,
  );
}
