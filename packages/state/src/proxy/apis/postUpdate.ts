import { getAbsolutePathInfo } from "../../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../../address/AbsoluteStateAddress";
import { getResolvedAddress } from "../../address/ResolvedAddress";
import { createStateAddress } from "../../address/StateAddress";
import { IStateAddress } from "../../address/types";
import { setCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
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
    const absPathInfo = getAbsolutePathInfo(stateElement.name, address.pathInfo);
    const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
    const updater = getUpdater();
    updater.enqueueAbsoluteAddress(absAddress);
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
        const absDepPathInfo = getAbsolutePathInfo(handler.stateName, depAddress.pathInfo);
        const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
        setCacheEntryByAbsoluteStateAddress(absDepAddress, null);
        // 更新対象として登録
        updater.enqueueAbsoluteAddress(absDepAddress);
      }
    );
  }
}