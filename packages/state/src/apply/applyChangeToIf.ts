import { initializeBindingsByFragment } from "../bindings/initializeBindings";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { createContent } from "../structural/createContent";
import { getFragmentInfoByUUID } from "../structural/fragmentInfoByUUID";
import { IContent } from "../structural/types";

const lastValueByNode: WeakMap<Node, boolean> = new WeakMap();
const contentByNode: WeakMap<Node, IContent> = new WeakMap();

export function applyChangeToIf(node: Node, uuid: string, _newValue: any): void {
  const fragmentInfo = getFragmentInfoByUUID(uuid);
  if (!fragmentInfo) {
    raiseError(`Fragment with UUID "${uuid}" not found.`);
  }
  const oldValue = lastValueByNode.get(node) ?? false;
  const newValue = Boolean(_newValue);
  let content = contentByNode.get(node);
  if (typeof content === "undefined") {
    const loopContext = getLoopContextByNode(node);
    const cloneFragment = document.importNode(fragmentInfo.fragment, true);
    initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, loopContext);
    content = createContent(cloneFragment);
    contentByNode.set(node, content);
  }

  if (oldValue === newValue) {
    return;
  }
  if (oldValue) {
    content.unmount();
  }
  if (newValue) {
    content.mountAfter(node);
  }
  lastValueByNode.set(node, newValue);
}