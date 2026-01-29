import { initializeBindings, initializeBindingsByFragment } from "../bindings/initializeBindings";
import { getListIndexesByList } from "../list/listIndexesByList";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { createContent } from "../structural/createContent";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { IContent } from "../structural/types";

const lastValueByNode = new WeakMap<Node, any>();
const lastContentsByNode = new WeakMap<Node, IContent[]>();

export function applyChangeToFor(node: Node, uuid: string, _newValue: any): void {
  const fragmentInfo = getFragmentInfoByUUID(uuid);
  if (!fragmentInfo) {
    raiseError(`Fragment with UUID "${uuid}" not found.`);
  }
  const lastValue = lastValueByNode.get(node) ?? [];
  const newValue = Array.isArray(_newValue) ? _newValue : [];
  const listIndexes = getListIndexesByList(newValue) || [];

  const lastContents = lastContentsByNode.get(node) || [];
  for(const content of lastContents) {
    content.unmount();
  }
  const newContents: IContent[] = [];
  let lastNode = node;
  const listPathInfo = fragmentInfo.parseBindTextResult.statePathInfo;
  if (!listPathInfo) {
    raiseError(`List path info not found in fragment bind text result.`);
  }
  const stateName = fragmentInfo.parseBindTextResult.stateName;
  const stateElement = getStateElementByName(stateName);
  if (!stateElement) {
    raiseError(`State element with name "${stateName}" not found.`);
  }
  const loopContextStack = stateElement.loopContextStack;
  for(const index of listIndexes) {
    loopContextStack.createLoopContext(listPathInfo, index, (_loopContext) => {
      const cloneFragment = document.importNode(fragmentInfo.fragment, true);
      initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, index);
      const content = createContent(cloneFragment);
      content.mountAfter(lastNode);
      lastNode = content.lastNode || lastNode;
      newContents.push(content);
    });
  }
  lastContentsByNode.set(node, newContents);
  lastValueByNode.set(node, newValue);
}