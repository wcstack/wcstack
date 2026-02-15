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

import { getAbsolutePathInfo } from "../../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../../address/AbsoluteStateAddress";
import { IStateAddress } from "../../address/types";
import { getCacheEntryByAbsoluteStateAddress, setCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
import { IStateElement } from "../../components/types";
import { WILDCARD } from "../../define";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";
import { checkDependency } from "./checkDependency";

function _getByAddress(
  target   : object, 
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement,
): any {
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
  target   : object, 
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement
): any {
  const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
  const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
  const cacheEntry = getCacheEntryByAbsoluteStateAddress(absAddress);
  if (cacheEntry !== null && cacheEntry.dirty === false) {
    return cacheEntry.value;
  }
  const value = _getByAddress(target, address, receiver, handler, stateElement);
  setCacheEntryByAbsoluteStateAddress(absAddress, {
    value: value,
    dirty: false
  });
  return value;
}

export function getByAddress(
  target   : object,
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler
): any {
  checkDependency(handler, address);
  const stateElement = handler.stateElement;
  const cacheable = address.pathInfo.wildcardCount > 0 || 
                    stateElement.getterPaths.has(address.pathInfo.path);
  if (cacheable) {
    return _getByAddressWithCache(target, address, receiver, handler, stateElement);
  } else {
    return _getByAddress(target, address, receiver, handler, stateElement);
  }
}
