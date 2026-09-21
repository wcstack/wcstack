/**
 * core/featureEntries.ts — 受け口の機能名 → 利用者が入れるエントリ（設計案 §3 H5・§4）。
 *
 * barrier に当たったページが要るのは「どの import を足すか」であって内部の機能名ではない。
 * 内部では別々の機能（watch / scan / stream）が 1 つのエントリ（temporal）に載るので、
 * 対応表は 1 箇所に置き、3 つの barrier（addressHooks・lifecycleHooks・ssrHooks）が共有する。
 */
const ENTRY_BY_FEATURE: Record<string, string> = {
  watch: "temporal",
  scan: "temporal",
  stream: "temporal",
  scopes: "scopes",
  dcc: "scopes",
  bindComponent: "scopes",
  recursion: "recursion",
  ssr: "ssr",
  devtools: "devtools",
};

/** 未 install の機能を宣言が要求したときの文言（readiness barrier、H5 / D13） */
export function featureNotInstalledMessage(feature: string, declaration: string): string {
  const entry = ENTRY_BY_FEATURE[feature] ?? feature;
  return `[wcs/feature-not-installed] ${declaration} needs the "${feature}" feature: ` +
    `install it with installFeatures([...]) from "@wcstack/state/features/${entry}" before the state is defined.`;
}
