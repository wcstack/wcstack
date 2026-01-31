/**
 * getByAddress.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（checkDependencyで登録）
 * - キャッシュ機構（リストもキャッシュ対象）
 * - getter経由で値取得時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathAddressやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - checkDependencyで依存追跡を実行  
 * - キャッシュ有効時はstateAddressで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */

import { IStateAddress } from "../../address/types";
import { ICacheEntry } from "../../cache/types";
import { IStateElement } from "../../components/types";
import { WILDCARD } from "../../define";
import { createListIndexes } from "../../list/createListIndexes";
import { getListIndexesByList, setListIndexesByList } from "../../list/listIndexesByList";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";
import { checkDependency } from "./checkDependency";

function _getByAddress(
  target   : Object, 
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement,
): any {
  // ToDo:親子関係のあるgetterが存在する場合は、外部依存から取得
/*
  if (handler.engine.stateOutput.startsWith(ref.info) && handler.engine.pathManager.getters.intersection(ref.info.cumulativePathSet).size === 0) {
    return handler.engine.stateOutput.get(ref);
  }
*/
  if (address.pathInfo.path in target) {
    // getterの中で参照の可能性があるので、addressをプッシュする
    if (stateElement.getterPaths.has(address.pathInfo.path)) {
      handler.pushAddress(address);
      try {
        return Reflect.get(target, address.pathInfo.path, receiver);
      } finally {
        handler.popAddress();
      }
    } else {
      return Reflect.get(target, address.pathInfo.path);
    }
  } else {
    const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
    const parentValue = getByAddress(target, parentAddress, receiver, handler);
    const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
    if (lastSegment === WILDCARD) {
      const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
      return Reflect.get(parentValue, index);
    } else {
      return Reflect.get(parentValue, lastSegment);
    }
  }
}

function _getByAddressWithCache(
  target   : Object, 
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement,
  listable: boolean,
): any {
  let value: any;
  let lastCacheEntry = stateElement.cache.get(address) ?? null;
  // Updateで変更が必要な可能性があるパスのバージョン情報
  const mightChangeByPath = handler.stateElement.mightChangeByPath;
  const versionRevision = mightChangeByPath.get(address.pathInfo.path);
  if (lastCacheEntry !== null) {
    const lastVersionInfo = lastCacheEntry.versionInfo;
    if (typeof versionRevision === "undefined") {
      // 更新なし
      return lastCacheEntry.value;
    } else {
      if (lastVersionInfo.version > handler.updater.versionInfo.version) {
        // これは非同期更新が発生した場合にありえる
        return lastCacheEntry.value;
      }
      if (lastVersionInfo.version < versionRevision.version || lastVersionInfo.revision < versionRevision.revision) {
        // 更新あり
      } else {
        return lastCacheEntry.value;
      }
    }
  }
  try {
    return value = _getByAddress(target, address, receiver, handler, stateElement);
  } finally {
    let newListIndexes = null;
    if (listable) {
      // 古いリストからリストインデックスを取得し、新しいリスト用に作成し直す（差分更新）
      const oldList = lastCacheEntry?.value;
      const oldListIndexes = (Array.isArray(oldList)) ? (getListIndexesByList(oldList) ?? []) : [];
      newListIndexes = createListIndexes(address.listIndex, lastCacheEntry?.value, value, oldListIndexes);
      setListIndexesByList(value, newListIndexes);
    }
    const cacheEntry: ICacheEntry = {
      ...(lastCacheEntry ?? {}),
      value: value,
      versionInfo: { ...handler.updater.versionInfo },
    };
    stateElement.cache.set(address, cacheEntry);
  }
}

export function getByAddress(
  target   : Object, 
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler
): any {
  checkDependency(handler, address);
  const stateElement = handler.stateElement;
  // リストはキャッシュ対象とする。前回の値をもとにListIndexesの差分更新を行うため
  const listable = stateElement.listPaths.has(address.pathInfo.path);
  const cacheable = address.pathInfo.wildcardCount > 0 || 
                    stateElement.getterPaths.has(address.pathInfo.path);
  if (cacheable || listable) {
    return _getByAddressWithCache(
      target, address, receiver, handler, stateElement, listable
    );
  } else {
    return _getByAddress(target, address, receiver, handler, stateElement);
  }
}
