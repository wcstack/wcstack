/**
 * setByRef.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）に値を設定するための関数（setByRef）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を設定（多重ループやワイルドカードにも対応）
 * - getter/setter経由で値設定時はSetStatePropertyRefSymbolでスコープを一時設定
 * - 存在しない場合は親infoやlistIndexを辿って再帰的に値を設定
 * - 設定後はengine.updater.addUpdatedStatePropertyRefValueで更新情報を登録
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値設定を実現
 * - finallyで必ず更新情報を登録し、再描画や依存解決に利用
 * - getter/setter経由のスコープ切り替えも考慮した設計
 */

import { IStateAddress } from "../../address/types";
import { createListIndex } from "../../list/createListIndex";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";
import { getByAddress } from "./getByAddress";
import { getSwapInfoByAddress, setSwapInfoByAddress } from "./swapInfo";

function _setByAddress(
  target   : Object, 
  address  : IStateAddress,
  value    : any, 
  receiver : any,
  handler  : IStateHandler
): any {
  try {
    // 親子関係のあるgetterが存在する場合は、外部依存を通じて値を設定
/*
    if (handler.engine.stateOutput.startsWith(ref.info) && handler.engine.pathManager.setters.intersection(ref.info.cumulativePathSet).size === 0) {
      return handler.engine.stateOutput.set(ref, value);
    }
*/

    if (address.pathInfo.path in target) {
      // getterの中で参照の可能性があるので、addressをプッシュする
      handler.pushAddress(address);
      try {
        return Reflect.set(target, address.pathInfo.path, value, receiver);
      } finally {
        handler.popAddress();
      }
    } else {
      const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined`);
      const parentValue = getByAddress(target, parentAddress, receiver, handler);
      const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
      if (lastSegment === "*") {
        const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined`);
        return Reflect.set(parentValue, index, value);
      } else {
        return Reflect.set(parentValue, lastSegment, value);
      }
    }
  } finally {
    handler.updater.enqueueUpdateAddress(address); // 更新情報を登録
  }
}

function _setByAddressWithSwap(
  target   : Object, 
  address  : IStateAddress,
  value    : any, 
  receiver : any,
  handler  : IStateHandler
) {
  // elementsの場合はswapInfoを準備
  let parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined`);
  let swapInfo = getSwapInfoByAddress(parentAddress);
  if (swapInfo === null) {
    const value = getByAddress(target, parentAddress, receiver, handler) ?? [];
    const listIndexes = getListIndexesByList(value) ?? [];
    swapInfo = {
      value: [...value], listIndexes: [...listIndexes]
    }
    setSwapInfoByAddress(parentAddress, swapInfo);
  }
  try {
    return _setByAddress(target, address, value, receiver, handler);
  } finally {
    const index = swapInfo.value.indexOf(value);
    const currentParentValue = getByAddress(target, parentAddress!, receiver, handler) ?? [];
    const currentListIndexes = getListIndexesByList(currentParentValue) ?? [];
    const curIndex = address.listIndex!.index;
    const listIndex = (index !== -1) ? 
      swapInfo!.listIndexes[index] : 
      createListIndex(parentAddress!.listIndex, -1);
    currentListIndexes[curIndex] = listIndex;
    // 重複チェック
    // 重複していない場合、swapが完了したとみなし、インデックスを更新
    const listValueSet = new Set(currentParentValue);
    if (listValueSet.size === swapInfo!.value.length) {
      for(let i = 0; i < currentListIndexes.length; i++) {
        currentListIndexes[i].index = i;
      }
      // 完了したのでswapInfoを削除
      setSwapInfoByAddress(parentAddress!, null);
    }
  }
}

export function setByAddress(
    target   : Object, 
    address  : IStateAddress,
    value    : any, 
    receiver : any,
    handler  : IStateHandler
): any {
  const stateElement = handler.stateElement;
  const isElements = stateElement.elementPaths.has(address.pathInfo.path);
  const listable = stateElement.listPaths.has(address.pathInfo.path);
  const cacheable = address.pathInfo.wildcardCount > 0 || 
                    stateElement.getterPaths.has(address.pathInfo.path);
  try {
    if (isElements) {
      return _setByAddressWithSwap(target, address, value, receiver, handler);
    } else {
      return _setByAddress(target, address, value, receiver, handler);
    }
  } finally {
    if (cacheable || listable) {
      let cacheEntry = stateElement.cache.get(address) ?? null;
      if (cacheEntry === null) {
        cacheEntry = {
          value: value,
          versionInfo: {
            version: handler.updater.versionInfo.version,
            revision: handler.updater.versionInfo.revision,
          },
        };
        stateElement.cache.set(address, cacheEntry);
      } else {
        cacheEntry.value = value;
        cacheEntry.versionInfo.version = handler.updater.versionInfo.version;
        cacheEntry.versionInfo.revision = handler.updater.versionInfo.revision;
      }
    }
  }
}
