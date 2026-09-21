/**
 * watch/addressHooks.ts — `$watch` / `$scan` を宣言した state に付く hook（設計案 H1、S3）。
 * 宣言済みパスの `prev` 台帳（prevValues.ts）への記録を core（setByAddress）から移し、
 * どちらも宣言しない state では一切走らない。台帳を読むのは `$watch`
 * （docs/state-watch-hook-design.md §4-1）と `$scan` の `from`（docs/state-scan-design.md §2-1）。
 */
import { IAddressHooks } from "../core/addressHooks";
import { getPrevValue, hasPrevValue, recordPrevValue } from "./prevValues";

export const watchAddressHooks: IAddressHooks = {
  // same-value guard が既に読んだ旧値だけを使い、そのための追加読みはしない
  writeObserve(stateElement, path, absAddress, oldValue, hasOldValue) {
    if (!hasOldValue) {
      return;
    }
    const watchPaths = stateElement.watchPaths;
    const scanPaths = stateElement.scanPaths;
    if (watchPaths?.has(path) === true || scanPaths?.has(path) === true) {
      recordPrevValue(absAddress, oldValue);
    }
  },
  // 要素の入れ替えで行が動いた: 旧値の台帳を行に追従させる
  swapped(_stateElement, elementAbsAddress, displacedAbsAddress) {
    if (hasPrevValue(displacedAbsAddress)) {
      recordPrevValue(elementAbsAddress, getPrevValue(displacedAbsAddress));
    }
  },
};
