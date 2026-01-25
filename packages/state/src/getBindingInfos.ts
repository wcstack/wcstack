import { ILoopElement, IStateElement } from "./components/types";
import { config } from "./config";
import { findStateElement } from "./findStateElement";
import { getPathInfo } from "./address/PathInfo";
import { raiseError } from "./raiseError";
import { IBindingInfo, IState } from "./types";

const commentKey = `${config.bindAttributeName.replace(/^data-/, '')}:`;

export function getBindingInfos(node: Node): IBindingInfo[] {
  const bindingInfos: IBindingInfo[] = [];
  const cacheState = new Map<string, IStateElement>();
  const removeComments: Comment[] = [];
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    if (tagName === config.tagNames.loop) {
      const loopElement = element as unknown as ILoopElement;
      bindingInfos.push(loopElement.bindingInfo);
    } else {
      const bindAttributeText = element.getAttribute(config.bindAttributeName) || '';
      const bindTexts = bindAttributeText.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for(const bindText of bindTexts) {
        const [propText, stateText] = bindText.split(':').map(s => s.trim());
        const [propName, modifierText] = (propText ?? '').split('#').map(s => s.trim());
        const modifiers = modifierText ? modifierText.split(',').map(s => s.trim()) : [];
        const propSegments = (propName ?? '').split('.').map(s => s.trim());
        const [statePathNameAndStateName, ...filterTexts] = (stateText ?? propSegments.at(-1) ?? '').split('|').map(s => s.trim());
        const statePathNameParts = statePathNameAndStateName.split('@').map(s => s.trim());
        const statePathName = statePathNameParts[0] || '';
        const stateName = statePathNameParts[1] || 'default';
        const statePathInfo = getPathInfo(statePathName);
        let stateElement = cacheState.get(stateName) ?? null;
        if (stateElement === null) {
          stateElement = findStateElement(document, stateName);
          if (stateElement !== null) {
            cacheState.set(stateName, stateElement);
          }
        }
        if (stateElement === null) {
          raiseError(`State element with name "${stateName}" not found for binding "${bindText}".`);
        }
        if (propName === '' || statePathName === '') {
          raiseError(`Invalid binding syntax: "${bindText}".`);
        }
        const bindingInfo: IBindingInfo = {
          propName: propName || '',
          propSegments: propSegments,
          propModifiers: modifiers,
          statePathName: statePathName,
          statePathInfo: statePathInfo,
          stateName: stateName,
          stateElement,
          filterTexts: filterTexts,
          node: element,
        }
        bindingInfos.push(bindingInfo);
      }
    }
  } else if (node.nodeType === Node.COMMENT_NODE) {
    const commentNode = node as Comment;
    const text = commentNode.data.trim();
    const match = RegExp(`^{{\\s*${commentKey}\\s*(.+?)\\s*}}$`).exec(text);
    if (match !== null) {
      const stateText = match[1];
      const [statePathNameAndStateName, ...filterTexts] = (stateText ?? '').split('|').map(s => s.trim());
      const statePathNameParts = statePathNameAndStateName.split('@').map(s => s.trim());
      const statePathName = statePathNameParts[0] || '';
      const stateName = statePathNameParts[1] || 'default';
      const statePathInfo = getPathInfo(statePathName);
      let stateElement = cacheState.get(stateName) ?? null;
      if (stateElement === null) {
        stateElement = findStateElement(document, stateName);
        if (stateElement !== null) {
          cacheState.set(stateName, stateElement);
        }
      }
      if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for binding "${stateText}".`);
      }
      if (statePathName === '') {
        raiseError(`Invalid binding syntax: "${stateText}".`);
      }
      const textNode = document.createTextNode('');
      const parentNode = commentNode.parentNode;
      const nextSibling = commentNode.nextSibling;
      if (parentNode === null) {
        raiseError(`Comment node has no parent node.`);
      }
      parentNode.insertBefore(textNode, nextSibling);
      removeComments.push(commentNode);
      const bindingInfo: IBindingInfo = {
        propName: 'textContent',
        propSegments: ['textContent'],
        propModifiers: [],
        statePathName: statePathName,
        statePathInfo: statePathInfo,
        stateName: stateName,
        stateElement,
        filterTexts: filterTexts,
        node: textNode,
      }
      bindingInfos.push(bindingInfo);
    }
  }
  for (const commentNode of removeComments) {
    commentNode.remove();
  }
  return bindingInfos;
}