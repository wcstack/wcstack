/**
 * get.ts
 *
 * StateClassのProxyトラップとして、プロパティアクセス時の値取得処理を担う関数（get）の実装です。
 *
 * 主な役割:
 * - 文字列プロパティの場合、特殊プロパティ（$1〜$9, $resolve, $getAll, $navigate）に応じた値やAPIを返却
 * - 通常のプロパティはgetResolvedPathInfoでパス情報を解決し、getListIndexでリストインデックスを取得
 * - getByRefで構造化パス・リストインデックスに対応した値を取得
 * - シンボルプロパティの場合はhandler.callableApi経由でAPIを呼び出し
 * - それ以外はReflect.getで通常のプロパティアクセスを実行
 *
 * 設計ポイント:
 * - $1〜$9は直近のStatePropertyRefのリストインデックス値を返す特殊プロパティ
 * - $resolve, $getAll, $navigateはAPI関数やルーターインスタンスを返す
 * - 通常のプロパティアクセスもバインディングや多重ループに対応
 * - シンボルAPIやReflect.getで拡張性・互換性も確保
 */

import { getResolvedAddress } from "../../address/ResolvedAddress";
import { createStateAddress } from "../../address/StateAddress";
import { IAbsoluteStateAddress, IStateAddress } from "../../address/types";
import { INDEX_BY_INDEX_NAME } from "../../define";
import { raiseError } from "../../raiseError";
import { connectedCallback } from "../apis/connectedCallback";
import { disconnectedCallback } from "../apis/disconnectedCallback";
import { getAll } from "../apis/getAll";
import { postUpdate } from "../apis/postUpdate";
import { resolve } from "../apis/resolve";
import { trackDependency } from "../apis/trackDependency";
import { updatedCallback } from "../apis/updatedCallback";
import { getByAddress } from "../methods/getByAddress";
import { getListIndex } from "../methods/getListIndex";
import { setLoopContext, setLoopContextAsync } from "../methods/setLoopContext";
import { connectedCallbackSymbol, disconnectedCallbackSymbol, getByAddressSymbol, setLoopContextAsyncSymbol, setLoopContextSymbol, updatedCallbackSymbol } from "../symbols";
import { IStateHandler } from "../types";

export function get(
  target  : object, 
  prop    : PropertyKey, 
  receiver: any,
  handler : IStateHandler
): any {
  const index = INDEX_BY_INDEX_NAME[prop];
  if (typeof index !== "undefined") {
    if (handler.addressStackLength === 0) {
      raiseError(`No active state reference to get list index for "${prop.toString()}".`);
    }
    const listIndex = handler.lastAddressStack?.listIndex;
    return listIndex?.indexes[index] ?? raiseError(`ListIndex not found: ${prop.toString()}`);
  }
  if (typeof prop === "string") {
    if (prop[0] === '$') {
      switch (prop) {
        case "$stateElement": {
          return handler.stateElement;
        }
        case "$getAll": {
          return (path: string, indexes?: number[]): any[] => {
            return getAll(
              target, 
              prop, 
              receiver,
              handler
            )(path, indexes);
          }
        }
        case "$postUpdate": {
          return (path: string): void => {
            return postUpdate(
              target, 
              prop, 
              receiver,
              handler
            )(path);
          }
        }
        case "$resolve": {
          return (path: string, indexes: number[], value?: any): any => {
            return resolve(
              target, 
              prop, 
              receiver,
              handler
            )(path, indexes, value);
          }
        }
        case "$trackDependency": {
          return (path: string): void => {
            return trackDependency(
              target, 
              prop, 
              receiver,
              handler
            )(path);
          }
        }
      }
    } else {
      const resolvedAddress = getResolvedAddress(prop);
      const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
      const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
      return getByAddress(
        target, 
        stateAddress,
        receiver,
        handler
      );
    }
  } else if (typeof prop === "symbol") {
    switch (prop) {
      case setLoopContextAsyncSymbol: {
        return (loopContext: any, callback = async (): Promise<any> => {}): Promise<any> => {
          return setLoopContextAsync(handler, loopContext, callback);
        };
      }
      case setLoopContextSymbol: {
        return (loopContext: any, callback = (): any => {}): any => {
          return setLoopContext(handler, loopContext, callback);
        };
      }
      case getByAddressSymbol: {
        return (address: IStateAddress): any => {
          return getByAddress(
            target,
            address,
            receiver,
            handler
          );
        }
      }
      case connectedCallbackSymbol: {
        return (): Promise<void> => {
          return connectedCallback(
            target,
            prop,
            receiver,
            handler
          );
        }
      }
      case disconnectedCallbackSymbol: {
        return (): void => {
          return disconnectedCallback(
            target,
            prop,
            receiver,
            handler
          );
        }
      }
      case updatedCallbackSymbol: {
        return (
          refs: IAbsoluteStateAddress[]
        ): unknown => {
          return updatedCallback(
            target,
            refs,
            receiver,
            handler
          );
        }
      }
    }

    return Reflect.get(
      target, 
      prop, 
      receiver
    );
  }
}
