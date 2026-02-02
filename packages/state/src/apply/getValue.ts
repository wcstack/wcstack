import { getStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo";
import { IBindingInfo } from "../binding/types";
import { IStateProxy } from "../proxy/types";

export function getValue(state: IStateProxy, bindingInfo: IBindingInfo): any {
  const stateAddress = getStateAddressByBindingInfo(bindingInfo);
  return state.$$getByAddress(stateAddress);
}
  