import { IBindingInfo } from "../types";
import { ParseBindTextResult } from "../bindTextParser/types";

export function getBindingInfos(node: Node, parseBindingTextResults: ParseBindTextResult[]): IBindingInfo[] {
  const bindingInfos: IBindingInfo[] = [];
  for (const parseBindingTextResult of parseBindingTextResults) {
    if (parseBindingTextResult.bindingType !== 'text') {
      bindingInfos.push({
        ...parseBindingTextResult,
        node: node,
        placeHolderNode: node as Element,
      });
    } else {
      const placeHolderNode = document.createTextNode('');
      bindingInfos.push({
        ...parseBindingTextResult,
        node: node,
        placeHolderNode: placeHolderNode,
      });
    }
  }
  return bindingInfos;
}
