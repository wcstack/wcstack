import { applyChange } from "../apply/applyChange";
import { IApplyContext } from "../apply/types";
import { clearAbsoluteStateAddressByBindingInfo, getAbsoluteStateAddressByBindingInfo } from "../binding/getAbsoluteStateAddressByBindingInfo";
import { addBindingInfoByAbsoluteStateAddress, removeBindingInfoByAbsoluteStateAddress } from "../binding/getBindingInfosByAbsoluteStateAddress";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { bindLoopContextToContent, unbindLoopContextToContent } from "../bindings/bindLoopContextToContent";
import { ILoopContext } from "../list/types";
import { IContent } from "./types";

export function activateContent(
  content: IContent, 
  loopContext: ILoopContext | null,
  context: IApplyContext,
): void {
  bindLoopContextToContent(content, loopContext);
  const bindings = getBindingsByContent(content);
  for(const binding of bindings) {
    const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
    addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
    applyChange(binding, context);
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

