import { calcWildcardLen } from "../address/calcWildcardLen";
import { IBindingInfo } from "../types";
import { getLoopContextByNode } from "./loopContextByNode";
import { IListIndex, ILoopContext } from "./types";

const listIndexByBindingInfoByLoopContext: WeakMap<ILoopContext, WeakMap<IBindingInfo, IListIndex | null>> = new WeakMap();

export function getListIndexByBindingInfo(bindingInfo: IBindingInfo): IListIndex | null {
  const loopContext = getLoopContextByNode(bindingInfo.node);
  if (loopContext === null) {
    return null;
  }
  let listIndexByBindingInfo = listIndexByBindingInfoByLoopContext.get(loopContext);
  if (typeof listIndexByBindingInfo === "undefined") {
    listIndexByBindingInfo = new WeakMap<IBindingInfo, IListIndex | null>();
    listIndexByBindingInfoByLoopContext.set(loopContext, listIndexByBindingInfo);
  } else {
    const listIndex = listIndexByBindingInfo.get(bindingInfo);
    if (typeof listIndex !== "undefined") {
      return listIndex;
    }
  }

  let listIndex: IListIndex | null = null;
  try {
    const wildcardLen = calcWildcardLen(loopContext.pathInfo, bindingInfo.statePathInfo);
    if (wildcardLen > 0) {
      listIndex = loopContext.listIndex.at(wildcardLen - 1);
    }
    return listIndex;
  } finally {
    listIndexByBindingInfo.set(bindingInfo, listIndex);
  }

}
