import { applyChange } from "../apply/applyChange";
import { clearAbsoluteStateAddressByBindingInfo, getAbsoluteStateAddressByBindingInfo } from "../binding/getAbsoluteStateAddressByBindingInfo";
import { addBindingInfoByAbsoluteStateAddress, removeBindingInfoByAbsoluteStateAddress } from "../binding/getBindingInfosByAbsoluteStateAddress";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { bindLoopContextToContent, unbindLoopContextToContent } from "../bindings/bindLoopContextToContent";
import { ILoopContext } from "../list/types";
import { IStateProxy } from "../proxy/types";
import { IContent } from "./types";

export function activateContent(
  content: IContent, 
  loopContext: ILoopContext | null,
  state: IStateProxy, 
  stateName: string
): void {
  bindLoopContextToContent(content, loopContext);
  const bindings = getBindingsByContent(content);
  for(const binding of bindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
    addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
    applyChange(binding, state, stateName);
  }
}

export function deactivateContent(
  content: IContent
): void {
  const bindings = getBindingsByContent(content);
  for(const binding of bindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
    removeBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
    clearAbsoluteStateAddressByBindingInfo(binding);
    clearStateAddressByBindingInfo(binding);
  }
  unbindLoopContextToContent(content);
}

