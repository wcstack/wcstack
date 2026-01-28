import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { config } from "../config";
import { getUUID } from "../getUUID";
import { BindingType } from "../types";
import { setFragmentInfoByUUID } from "./fragmentInfoByUUID";
import { getFragmentNodeInfos } from "./getFragmentNodeInfos";

const keywordByBindingType: Map<BindingType, string> = new Map<BindingType, string>([
  ["for",  config.commentForPrefix],
  ["if",  config.commentIfPrefix],
  ["elseif", config.commentElseIfPrefix],
  ["else", config.commentElsePrefix],
]);

export function collectStructuralFragments(root: Document | Element | DocumentFragment): void {
  const walker = document.createTreeWalker(
    root, 
    NodeFilter.SHOW_ELEMENT, 
    {
      acceptNode(node: Node) {
        const element = node as Element;
        if (element instanceof HTMLTemplateElement) {
          const bindText = element.getAttribute(config.bindAttributeName) || '';
          if (bindText.length > 0) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  while (walker.nextNode()) {
    const template = walker.currentNode as HTMLTemplateElement;
    const bindText = template.getAttribute(config.bindAttributeName) || '';
    const parseBindTextResults = parseBindTextsForElement(bindText);
    const parseBindTextResult = parseBindTextResults[0];
    const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
    if (typeof keyword === 'undefined') {
      continue;
    }

    const fragment = template.content;
    const uuid = getUUID();

    const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
    template.replaceWith(placeHolder);
    collectStructuralFragments(fragment);

    // after replacing and collect node infos on child fragment
    setFragmentInfoByUUID(uuid, {
      fragment: fragment,
      parseBindTextResult: parseBindTextResult,
      nodeInfos: getFragmentNodeInfos(fragment),
    });

  }
}