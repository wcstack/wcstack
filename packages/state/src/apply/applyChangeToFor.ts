import { initializeBindings } from "../bindings/initializeBindings";
import { getListIndexesByList } from "../list/listIndexesByList";
import { raiseError } from "../raiseError";
import { createContent } from "../structural/createContent";
import { getFragmentByUUID } from "../structural/fragmentByUUID";
import { IContent } from "../structural/types";

const lastValueByNode = new WeakMap<Node, any>();
const lastContentsByNode = new WeakMap<Node, IContent[]>();

export function applyChangeToFor(node: Node, uuid: string, _newValue: any): void {
  const fragment = getFragmentByUUID(uuid);
  if (!fragment) {
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
  for(const index of listIndexes) {
    const cloneFragment = document.importNode(fragment, true);
    initializeBindings(cloneFragment, index);
    const content = createContent(cloneFragment);
    content.mountAfter(lastNode);
    lastNode = content.lastNode || lastNode;
  }
  lastContentsByNode.set(node, newContents);
  lastValueByNode.set(node, newValue);
}