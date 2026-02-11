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
import { INDEX_BY_INDEX_NAME } from "../../define";
import { raiseError } from "../../raiseError";
import { getAll } from "../apis/getAll";
import { postUpdate } from "../apis/postUpdate";
import { resolve } from "../apis/resolve";
import { trackDependency } from "../apis/trackDependency";
import { getByAddress } from "../methods/getByAddress";
import { getListIndex } from "../methods/getListIndex";
import { setLoopContext, setLoopContextAsync } from "../methods/setLoopContext";
export function get(target, prop, receiver, handler) {
    const index = INDEX_BY_INDEX_NAME[prop];
    if (typeof index !== "undefined") {
        if (handler.addressStackLength === 0) {
            raiseError(`No active state reference to get list index for "${prop.toString()}".`);
        }
        const listIndex = handler.lastAddressStack?.listIndex;
        return listIndex?.indexes[index] ?? raiseError(`ListIndex not found: ${prop.toString()}`);
    }
    if (typeof prop === "string") {
        if (prop === "$stateElement") {
            return handler.stateElement;
        }
        if (prop === "$$setLoopContextAsync") {
            return (loopContext, callback = async () => { }) => {
                return setLoopContextAsync(handler, loopContext, callback);
            };
        }
        if (prop === "$$setLoopContext") {
            return (loopContext, callback = () => { }) => {
                return setLoopContext(handler, loopContext, callback);
            };
        }
        if (prop === "$$getByAddress") {
            return (address) => {
                return getByAddress(target, address, receiver, handler);
            };
        }
        if (prop === "$getAll") {
            return (path, indexes) => {
                return getAll(target, prop, receiver, handler)(path, indexes);
            };
        }
        if (prop === "$postUpdate") {
            return (path) => {
                return postUpdate(target, prop, receiver, handler)(path);
            };
        }
        if (prop === "$resolve") {
            return (path, indexes, value) => {
                return resolve(target, prop, receiver, handler)(path, indexes, value);
            };
        }
        if (prop === "$trackDependency") {
            return (path) => {
                return trackDependency(target, prop, receiver, handler)(path);
            };
        }
        const resolvedAddress = getResolvedAddress(prop);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
        return getByAddress(target, stateAddress, receiver, handler);
    }
    else if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
        /*
            if (handler.symbols.has(prop)) {
              switch (prop) {
                case GetByRefSymbol:
                  return (ref: IStatePropertyRef) =>
                    getByRef(target, ref, receiver, handler);
                case SetByRefSymbol:
                  return (ref: IStatePropertyRef, value: any) =>
                    setByRef(target, ref, value, receiver, handler);
                case GetListIndexesByRefSymbol:
                  return (ref: IStatePropertyRef) =>
                    getListIndexesByRef(target, ref, receiver, handler);
                case ConnectedCallbackSymbol:
                  return () => connectedCallback(target, prop, receiver, handler);
                case DisconnectedCallbackSymbol:
                  return () => disconnectedCallback(target, prop, receiver, handler);
              }
            } else {
              return Reflect.get(
                target,
                prop,
                receiver
              );
            }
        */
    }
}
//# sourceMappingURL=get.js.map