import { getAbsolutePathInfo } from "../../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../../address/AbsoluteStateAddress";
import { getResolvedAddress } from "../../address/ResolvedAddress";
import { createStateAddress } from "../../address/StateAddress";
import { IStateAddress } from "../../address/types";
import { dirtyCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
import { dispatchBindableEvent } from "../../dcc/dispatchBindableEvent";
import { walkDependency } from "../../dependency/walkDependency";
import { getUpdater } from "../../updater/updater";
import { getListIndex } from "../methods/getListIndex";
import { IStateHandler, IStateProxy } from "../types";


type PostFunction = (path: string) => void;

export function postUpdate(
  target: object, 
  _prop: PropertyKey, 
  receiver: any,
  handler: IStateHandler
): PostFunction {
  const stateElement = handler.stateElement;
  return (path: string): void => {
    const resolvedAddress = getResolvedAddress(path);
    const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
    const address = createStateAddress(resolvedAddress.pathInfo, listIndex);
    const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
    const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
    const updater = getUpdater();
    updater.enqueueAbsoluteAddress(absAddress);
    // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
    walkDependency(
      handler.stateName,
      handler.stateElement,
      address,
      handler.stateElement.staticDependency,
      handler.stateElement.dynamicDependency,
      handler.stateElement.listPaths,
      receiver as IStateProxy,
      "new",
      (depAddress: IStateAddress) => {
        // キャッシュを無効化（ダーティ）
        const absDepPathInfo = getAbsolutePathInfo(stateElement, depAddress.pathInfo);
        const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
        dirtyCacheEntryByAbsoluteStateAddress(absDepAddress);
        // 更新対象として登録
        updater.enqueueAbsoluteAddress(absDepAddress);
      }
    );
    // DCC bindable イベントディスパッチ。$postUpdate は in-place 変異を通知する正規の idiom で、
    // set トラップを通らない変更が観測面に出る唯一の経路なので、ここでも撃つ
    // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.1）。
    dispatchBindableEvent(stateElement, address.pathInfo);
  }
}