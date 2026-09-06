import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { IFragmentInfo } from "./types";

const fragmentInfoByUUID = new Map<string, IFragmentInfo>();

export function setFragmentInfoByUUID(uuid: string, rootNode: Node, fragmentInfo: IFragmentInfo | null): void {
  if (fragmentInfo === null) {
    fragmentInfoByUUID.delete(uuid);
  } else {
    fragmentInfoByUUID.set(uuid, fragmentInfo);
    // v2: ルートに 1 ツリーなので参照は 1 回でよい（名前ごとの再解決は名前次元と一緒に消えた）
    const stateElement = getStateElement(rootNode);
    if (stateElement === null) {
      raiseError(`No state tree found on this root for fragment info.`);
    }
    const bindingPartial = fragmentInfo.parseBindTextResult;
    stateElement.setPathInfo(bindingPartial.statePathName, bindingPartial.bindingType);
    for(const nodeInfo of fragmentInfo.nodeInfos) {
      for(const nodeBindingPartial of nodeInfo.parseBindTextResults) {
        stateElement.setPathInfo(nodeBindingPartial.statePathName, nodeBindingPartial.bindingType);
      }
    }
  }
}

export function getFragmentInfoByUUID(uuid: string): IFragmentInfo | null {
  return fragmentInfoByUUID.get(uuid) || null;
}

export function getAllFragmentUUIDs(): string[] {
  return Array.from(fragmentInfoByUUID.keys());
}