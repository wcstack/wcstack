/**
 * setByAddress.ts
 *
 * Stateの内部APIとして、アドレス情報（IStateAddress）を指定して
 * 状態オブジェクト（target）に値を設定するための関数（setByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を設定（多重ループやワイルドカードにも対応）
 * - getter/setter経由で値設定時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathInfoやlistIndexを辿って再帰的に値を設定
 * - 設定後はupdater.enqueueUpdateAddressで更新情報を登録
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値設定を実現
 * - finallyで必ず更新情報を登録し、再描画や依存解決に利用
 * - getter/setter経由のスコープ切り替えも考慮した設計
 */

import { createAbsoluteStateAddress } from "../../address/AbsoluteStateAddress";
import { IStateAddress } from "../../address/types";
import { WILDCARD } from "../../define";
import { createListIndex } from "../../list/createListIndex";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { raiseError } from "../../raiseError";
import { getUpdater } from "../../updater/updater";
import { IStateHandler, IStateProxy } from "../types";
import { getByAddress } from "./getByAddress";
import { getSwapInfoByAddress, setSwapInfoByAddress } from "./swapInfo";
import { walkDependency } from "../../dependency/walkDependency";

function _setByAddress(
  target   : object, 
  address  : IStateAddress,
  value    : any, 
  receiver : any,
  handler  : IStateHandler
): any {
  try {
    // ToDo:親子関係のあるgetterが存在する場合は、外部依存を通じて値を設定
/*
    if (handler.engine.stateOutput.startsWith(ref.info) && handler.engine.pathManager.setters.intersection(ref.info.cumulativePathSet).size === 0) {
      return handler.engine.stateOutput.set(ref, value);
    }
*/

    if (address.pathInfo.path in target) {
      if (handler.stateElement.setterPaths.has(address.pathInfo.path)) {
        // setterの中で参照の可能性があるので、addressをプッシュする
        handler.pushAddress(address);
        try {
          return Reflect.set(target, address.pathInfo.path, value, receiver);
        } finally {
          handler.popAddress();
        }
      } else {
        return Reflect.set(target, address.pathInfo.path, value);
      }
    } else {
      const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
      const parentValue = getByAddress(target, parentAddress, receiver, handler);
      const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
      if (lastSegment === WILDCARD) {
        const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
        return Reflect.set(parentValue, index, value);
      } else {
        return Reflect.set(parentValue, lastSegment, value);
      }
    }
  } finally {
    const updater = getUpdater();
    const absoluteAddress = createAbsoluteStateAddress(handler.stateName, address);
    updater.enqueueAbsoluteAddress(absoluteAddress);
    // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
    walkDependency(
      address,
      handler.stateElement.staticDependency,
      handler.stateElement.dynamicDependency,
      handler.stateElement.listPaths,
      receiver as IStateProxy,
      "new",
      (depAddress: IStateAddress) => {
        // キャッシュを無効化（ダーティ）
        if (depAddress === address) return;
        handler.stateElement.cache.delete(depAddress);
        const absDepAddress = createAbsoluteStateAddress(handler.stateName, depAddress);
        updater.enqueueAbsoluteAddress(absDepAddress);
      }
    )
  }
}

function _setByAddressWithSwap(
  target   : object, 
  address  : IStateAddress,
  value    : any, 
  receiver : any,
  handler  : IStateHandler
) {
  // elementsの場合はswapInfoを準備
  let parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
  let swapInfo = getSwapInfoByAddress(parentAddress);
  if (swapInfo === null) {
    const parentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
    const listIndexes = getListIndexesByList(parentValue) ?? [];
    swapInfo = {
      value: [...parentValue], listIndexes: [...listIndexes]
    }
    setSwapInfoByAddress(parentAddress, swapInfo);
  }
  try {
    return _setByAddress(target, address, value, receiver, handler);
  } finally {
    const index = swapInfo.value.indexOf(value);
    const currentParentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
    const currentListIndexes = Array.isArray(currentParentValue) ? (getListIndexesByList(currentParentValue) ?? []) : [];
    const curIndex = address.listIndex!.index;
    const listIndex = (index !== -1) ? 
      swapInfo!.listIndexes[index] : 
      createListIndex(parentAddress.listIndex, -1);
    currentListIndexes[curIndex] = listIndex;
    // 重複チェック
    // 重複していない場合、swapが完了したとみなし、インデックスを更新
    const listValueSet = new Set(currentParentValue);
    if (listValueSet.size === swapInfo!.value.length) {
      for(let i = 0; i < currentListIndexes.length; i++) {
        currentListIndexes[i].index = i;
      }
      // 完了したのでswapInfoを削除
      setSwapInfoByAddress(parentAddress, null);
    }
  }
}

export function setByAddress(
    target   : object, 
    address  : IStateAddress,
    value    : any, 
    receiver : any,
    handler  : IStateHandler
): any {
  const stateElement = handler.stateElement;
  const isElements = stateElement.elementPaths.has(address.pathInfo.path);
  const cacheable = address.pathInfo.wildcardCount > 0 || 
                    stateElement.getterPaths.has(address.pathInfo.path);
  try {
    if (isElements) {
      return _setByAddressWithSwap(target, address, value, receiver, handler);
    } else {
      return _setByAddress(target, address, value, receiver, handler);
    }
  } finally {
    if (cacheable) {
      let lastCacheEntry = stateElement.cache.get(address) ?? null;
      if (lastCacheEntry === null) {
        stateElement.cache.set(address, {
          value: value,
          versionInfo: {
            version: handler.versionInfo.version,
            revision: ++handler.versionInfo.revision,
          },
        });
      } else {
        // 既存のキャッシュエントリを更新(高速化のため新規オブジェクトを作成しない)
        lastCacheEntry.value = value;
        lastCacheEntry.versionInfo.version = handler.versionInfo.version;
        lastCacheEntry.versionInfo.revision = ++handler.versionInfo.revision;
      }
    }
  }
}
