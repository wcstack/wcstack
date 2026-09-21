/**
 * scan/scanReport.ts
 *
 * `$scan` の失敗の報告（docs/state-scan-design.md D4 / D5）。
 *
 * 値の読み・fold・出力の書き込みの例外は scan 側で閉じる（drain リスナーと event-token の
 * emit ループを他の機構と共有しているため）。閉じた事実を console と devtools の両方に出す。
 * devtools には `$watch` と同じ `state:watch-error` を path `$scan.<出力名>` で流し、phase は
 * 直し方で分ける: 値を読めなかった（`evaluate`）・fold が契約を破った（`fold`）・出力を
 * 書けなかった（`write`）。
 */

import { STATE_SCAN_NAME } from "../define";
import { devtoolsSink } from "../platform/devtoolsSink";

/** 失敗の種類。原因も直し方も違うので console の文言を分ける */
export type ScanFailure = "read-source" | "read-output" | "threw" | "returned-promise" | "write";

type ScanPhase = "evaluate" | "fold" | "write";

const SCAN_FAILURE_MESSAGE: Readonly<Record<ScanFailure, (name: string) => string>> = {
  "read-source": (name) =>
    `${STATE_SCAN_NAME} could not read a "from" value for "${name}". That landing was not folded; the other landings of the batch still were.`,
  "read-output": (name) => `${STATE_SCAN_NAME} could not read the output "${name}". Nothing was folded or written.`,
  threw: (name) => `${STATE_SCAN_NAME} fold for "${name}" threw. The output was not written.`,
  "returned-promise": (name) =>
    `${STATE_SCAN_NAME} fold for "${name}" returned a Promise. fold must be synchronous and return the next value; the output was not written.`,
  write: (name) => `${STATE_SCAN_NAME} could not write the output "${name}".`,
};

const SCAN_FAILURE_PHASE: Readonly<Record<ScanFailure, ScanPhase>> = {
  "read-source": "evaluate",
  "read-output": "evaluate",
  threw: "fold",
  "returned-promise": "fold",
  write: "write",
};

function sendToDevtools(name: string, phase: ScanPhase, error: unknown): void {
  if (devtoolsSink !== null) {
    devtoolsSink({
      type: "state:watch-error",
      phase,
      path: `${STATE_SCAN_NAME}.${name}`,
      error,
    });
  }
}

export function reportScanError(name: string, error: unknown, failure: ScanFailure): void {
  console.error(`[@wcstack/state] ${SCAN_FAILURE_MESSAGE[failure](name)}`, error);
  sendToDevtools(name, SCAN_FAILURE_PHASE[failure], error);
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
    "returned-promise",
  );
}

const lateGetterReported: WeakSet<object> = new WeakSet();

/**
 * 宣言時には plain だった `from` が、接ぎ木（ボリュームのアクセサ登録）で後から getter に
 * なった（設計書 D5 後段）。getter の再評価回数を畳まないよう、その scan を止める。
 * entry につき 1 回だけ報告する。fold を適用しないと決めた失敗なので devtools の phase は `fold`。
 */
export function reportLateGetterSource(entry: object, name: string, path: string): void {
  if (lateGetterReported.has(entry)) {
    return;
  }
  lateGetterReported.add(entry);
  const message = `[wcs/scan-source-computed] ${STATE_SCAN_NAME} entry "${name}" from "${path}" is now backed by a getter ` +
    `(registered after the declaration, e.g. by a volume). A getter re-evaluates whenever its inputs change, ` +
    `so this scan stopped folding. Fold the plain value the getter reads instead.`;
  console.error(`[@wcstack/state] ${message}`);
  sendToDevtools(name, "fold", new Error(message));
}
