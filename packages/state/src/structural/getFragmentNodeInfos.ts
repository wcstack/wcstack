import { getParseBindTextResults } from "../bindings/getParseBindTextResults";
import { getSubscriberNodes } from "../bindings/getSubscriberNodes";
import { getNodePath } from "./getNodePath";
import { IFragmentNodeInfo } from "./types";

export function getFragmentNodeInfos(fragment: DocumentFragment): IFragmentNodeInfo[] {
  const fragmnentNodeInfos: IFragmentNodeInfo[] = [];
  const subscriberNodes = getSubscriberNodes(fragment);
  for(const subscriberNode of subscriberNodes) {
    const parseBindingTextResults = getParseBindTextResults(subscriberNode);
    fragmnentNodeInfos.push({
      nodePath: getNodePath(subscriberNode),
      parseBindTextResults: parseBindingTextResults,
    });
  }
  return fragmnentNodeInfos;
}