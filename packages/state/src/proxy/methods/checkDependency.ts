import { calcWildcardLen } from "../../address/calcWildcardLen";
import { IStateAddress } from "../../address/types";
import { listIndexAtWildcard } from "../../list/wildcardLevel";
import { IStateHandler } from "../types";

export function checkDependency(
  handler: IStateHandler,
  address: IStateAddress,
): void {
  // $untrackDependency スコープ中／setter 実行中は依存を張らない
  if (handler.untracking) {
    return;
  }
  // 動的依存関係の登録
  if (handler.addressStackLength > 0) {
    const lastAddress = handler.lastAddressStack;
    const lastInfo = lastAddress?.pathInfo ?? null;
    const stateElement = handler.stateElement;
    if (lastInfo !== null) {
      if (stateElement.getterPaths.has(lastInfo.path) &&
        lastInfo.path !== address.pathInfo.path) {
        // lastInfo.pathはgetterの名前であり、address.pathInfo.pathは
        // そのgetterが参照している値のパスである
        stateElement.addDynamicDependency(address.pathInfo.path, lastInfo.path);
        // 他行読み取りの検出: 評価中の getter と読み取り先が同じワイルドカード親
        // （リスト）を共有し、その階層の listIndex が異なる場合、この getter は
        // 自行の外に依存する（隣接項目参照など）。該当リストを crossRowListPaths に
        // 記録し、walkDependency の diff-filter 展開を全行展開へフォールバックさせる。
        if (address.pathInfo.wildcardCount > 0 && lastInfo.wildcardCount > 0) {
          const sharedLen = calcWildcardLen(address.pathInfo, lastInfo);
          if (sharedLen > 0) {
            // 共有ワイルドカード段の突き合わせ。base 深さ Δ を持つ子スコープでは
            // 先頭起点だと Δ 段目（＝親子で常に同一の base）を比べてしまい、
            // 本物の他行読み取りを取りこぼす。末尾起点で数える（list/wildcardLevel.ts）
            let crossRow = false;
            const hereChain = address.listIndex ?? null;
            const thereChain = lastAddress!.listIndex ?? null;
            for (let level = 0; level < sharedLen; level++) {
              const here = hereChain !== null
                ? listIndexAtWildcard(hereChain, level, address.pathInfo.wildcardCount) : null;
              const there = thereChain !== null
                ? listIndexAtWildcard(thereChain, level, lastInfo.wildcardCount) : null;
              if (here !== there) {
                crossRow = true;
                break;
              }
            }
            if (crossRow) {
              for (let level = 0; level < sharedLen; level++) {
                stateElement.addCrossRowListPath?.(address.pathInfo.wildcardParentPaths[level]);
              }
            }
          }
        }
      }
    }
  }
}