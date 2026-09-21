/**
 * devtools/keyedSubscriptions.ts
 *
 * DevTools Hook Protocol の `keyedSubscriptions(rootNode)`（protocol v2 追補・要件 D17）。
 * 鍵付き購読（`$eq` / `$eqPath` / `$eqIndex`）の台帳を path ごとに数えて返す。
 *
 * 購読は描画のたびに行単位で増減する依存グラフの動的な変化なので、イベントでは流さず
 * pull で取る（protocol §4.6。1 万行の描画で 1 万件のイベントにしない）。数えるのは
 * 呼ばれた時点だけで、台帳への参照は返さない。このモジュールは devtools 機能だけが
 * import する — core は台帳を読ませるアクセサしか持たない。
 */

import { IStateElement } from "../components/types";
import { getKeyedLedgerView } from "../dependency/keyedDependency";
import { IKeyedSubscriptionSummary } from "./types";

export function collectKeyedSubscriptions(stateElement: IStateElement): IKeyedSubscriptionSummary[] {
  const view = getKeyedLedgerView(stateElement);
  if (view === null) {
    return [];
  }
  const paths = new Set<string>([...view.byPath.keys(), ...view.tracked]);
  if (typeof view.watchers !== "undefined") {
    for (const path of view.watchers.keys()) {
      paths.add(path);
    }
  }
  const summaries: IKeyedSubscriptionSummary[] = [];
  for (const path of [...paths].sort()) {
    const keyMap = view.byPath.get(path);
    let rows = 0;
    if (typeof keyMap !== "undefined") {
      for (const addresses of keyMap.values()) {
        rows += addresses.size;
      }
    }
    summaries.push({
      path,
      tracked: view.tracked.has(path),
      rows,
      keys: keyMap?.size ?? 0,
      lists: view.watchers?.get(path)?.size ?? 0,
      lastValue: view.lastValue.get(path),
    });
  }
  return summaries;
}
