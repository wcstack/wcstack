import { liftAddress } from "../../address/liftAddress";
import { getResolvedAddress } from "../../address/ResolvedAddress";
import { createStateAddress } from "../../address/StateAddress";
import { IStateAddress } from "../../address/types";
import { dirtyCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
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
    const absAddress = liftAddress(stateElement, address);
    const updater = getUpdater();
    updater.enqueueAbsoluteAddress(absAddress);
    // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
    walkDependency(
      handler.stateElement,
      address,
      handler.stateElement.staticDependency,
      handler.stateElement.dynamicDependency,
      handler.stateElement.listPaths,
      receiver as IStateProxy,
      "new",
      (depAddress: IStateAddress) => {
        // キャッシュを無効化（ダーティ）
        const absDepAddress = liftAddress(stateElement, depAddress);
        dirtyCacheEntryByAbsoluteStateAddress(absDepAddress);
        // 更新対象として登録
        updater.enqueueAbsoluteAddress(absDepAddress);
      }
    );
    // $postUpdate は in-place 変異を通知する正規の idiom で、set トラップを通らない変更が観測面に
    // 出る唯一の経路なので、書き込み後の hook（DCC の bindable イベント等）をここでも撃つ
    // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.1）。
    const hooks = stateElement.addressHooks;
    if (hooks) {
      const written = hooks.written;
      for (let i = 0; i < written.length; i++) {
        written[i](stateElement, address.pathInfo);
      }
    }
  }
}