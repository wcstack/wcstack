import { IStateAddress } from "../../address/types";
import { IStateHandler } from "../types";

export function checkDependency(
  handler: IStateHandler,
  address: IStateAddress,
): void {
  // 動的依存関係の登録
  if (handler.addressStackIndex >= 0) {
    const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
    const stateElement = handler.stateElement;
    if (lastInfo !== null) {
      if (stateElement.getterPaths.has(lastInfo.path) &&
        lastInfo.path !== address.pathInfo.path) {
        stateElement.addDynamicDependency(lastInfo.path, address.pathInfo.path);
      }
    }
  }
}