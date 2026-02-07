import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IFragmentInfo } from "./types";

const fragmentInfoByUUID = new Map<string, IFragmentInfo>();

export function setFragmentInfoByUUID(uuid: string, fragmentInfo: IFragmentInfo | null): void {
  if (fragmentInfo === null) {
    fragmentInfoByUUID.delete(uuid);
  } else {
    fragmentInfoByUUID.set(uuid, fragmentInfo);
    const bindingPartial = fragmentInfo.parseBindTextResult;
    const stateElement = getStateElementByName(bindingPartial.stateName);
    if (stateElement === null) {
      raiseError(`State element with name "${bindingPartial.stateName}" not found for fragment info.`);
    }
    stateElement.setPathInfo(bindingPartial.statePathName, bindingPartial.bindingType);
    for(const nodeInfo of fragmentInfo.nodeInfos) {
      for(const nodeBindingPartial of nodeInfo.parseBindTextResults) {
        const nodeStateElement = getStateElementByName(nodeBindingPartial.stateName);
        if (nodeStateElement === null) {
          raiseError(`State element with name "${nodeBindingPartial.stateName}" not found for fragment info node.`);
        }
        nodeStateElement.setPathInfo(nodeBindingPartial.statePathName, nodeBindingPartial.bindingType);
      }
    }
  }
}

export function getFragmentInfoByUUID(uuid: string): IFragmentInfo | null {
  return fragmentInfoByUUID.get(uuid) || null;
}