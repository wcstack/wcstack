import { config } from "./config";

/**
 * 名前付き State（`<wcs-state name>` / `path@name`）の deprecation 通知。
 *
 * v2 では名前の次元そのものが消え、`<wcs-state mount="path">` と接頭辞付きパスに
 * 置き換わる（docs/state-mount-design.md D1 / D16）。1.x には `mount=` が無く、
 * warn を出しても利用者は動けないので、**既定では出さない**（`config.debug` 下だけ）。
 * 主経路は lint（`wcs/named-state-deprecated`）と README の告知。
 *
 * 出すときは種別 × 対象ごとに 1 回（起動のたびに同じ行が並ばないように）。
 */
const reported = new Set<string>();

export type NamedStateDeprecationKind = 'attribute' | 'path';

export function warnNamedStateDeprecated(kind: NamedStateDeprecationKind, subject: string): void {
  if (!config.debug) {
    return;
  }
  const key = `${kind}:${subject}`;
  if (reported.has(key)) {
    return;
  }
  reported.add(key);
  const hint = kind === 'attribute'
    ? `<wcs-state name="${subject}"> will be removed in v2. Mount the state onto the root tree with <wcs-state mount="${subject}"> and read it as "${subject}.<path>".`
    : `"${subject}" uses the "@name" state selector, which will be removed in v2. Read the mounted tree as "<name>.<path>" instead.`;
  console.warn(`[@wcstack/state] [wcs/named-state-deprecated] ${hint} See docs/state-mount-design.md §9.`);
}

/** テスト用: 報告済み台帳を空にする。 */
export function clearNamedStateDeprecationReportsForTesting(): void {
  reported.clear();
}
