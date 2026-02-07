import { getStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { IBindingInfo } from "../binding/types";
import { INDEX_BY_INDEX_NAME } from "../define";
import { getIndexValueByLoopContext } from "../list/getIndexValueByLoopContext";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IStateProxy } from "../proxy/types";
import { raiseError } from "../raiseError";

export function getValue(state: IStateProxy, binding: IBindingInfo): any {
  const stateAddress = getStateAddressByBindingInfo(binding);
  if (stateAddress.pathInfo.path in INDEX_BY_INDEX_NAME) {
    const loopContext = getLoopContextByNode(binding.node);
    if (loopContext === null) {
      raiseError(`ListIndex not found for binding: ${binding.statePathName}`);
    }
    return getIndexValueByLoopContext(loopContext, stateAddress.pathInfo.path);
  } else {
    return state.$$getByAddress(stateAddress);
  }
}
