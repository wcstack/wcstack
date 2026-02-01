import { getBindingsByContent, setBindingsByContent } from "../bindings/bindingsByContent";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { getContentByNode } from "../structural/contentByNode";
import { createContent } from "../structural/createContent";
import { IBindingInfo } from "../types";
import { applyChangeFromBindings } from "./applyChangeFromBindings";

const lastValueByNode: WeakMap<Node, boolean> = new WeakMap();

export function applyChangeToIf(bindingInfo: IBindingInfo, _newValue: any): void {
  const oldValue = lastValueByNode.get(bindingInfo.node) ?? false;
  const newValue = Boolean(_newValue);
  let content = getContentByNode(bindingInfo.node);
  let initiaized = false;
  if (content === null) {
    const loopContext = getLoopContextByNode(bindingInfo.node);
    content = createContent(bindingInfo, loopContext);
    initiaized = true;
  }

  if (oldValue === newValue && content.mounted) {
    return;
  }
  if (!newValue) {
    content.unmount();
  }
  if (newValue) {
    content.mountAfter(bindingInfo.node);
    if (!initiaized) {
      const bindings = getBindingsByContent(content);
      applyChangeFromBindings(bindings);
    }
  }
  lastValueByNode.set(bindingInfo.node, newValue);
}

