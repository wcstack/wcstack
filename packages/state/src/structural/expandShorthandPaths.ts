import { config } from "../config.js";
import { DELIMITER, WILDCARD } from "../define.js";

const COMMENT_REGEX = /^(\s*@@\s*(?:.*?)\s*:\s*)(.+?)(\s*)$/;

function expandShorthandInStatePart(statePart: string, forPath: string): string {
  const prefix = forPath + DELIMITER + WILDCARD;
  const pipeIndex = statePart.indexOf('|');
  const atIndex = statePart.indexOf('@');
  let pathPart: string;
  let suffix: string;
  if (pipeIndex !== -1) {
    pathPart = statePart.slice(0, pipeIndex).trim();
    suffix = statePart.slice(pipeIndex);
  } else if (atIndex !== -1) {
    pathPart = statePart.slice(0, atIndex).trim();
    suffix = statePart.slice(atIndex);
  } else {
    pathPart = statePart.trim();
    suffix = '';
  }
  if (pathPart === '.') {
    pathPart = prefix;
  } else if (pathPart.startsWith('.')) {
    pathPart = prefix + DELIMITER + pathPart.slice(1);
  } else {
    return statePart;
  }
  if (suffix.length > 0) {
    return pathPart + suffix;
  }
  return pathPart;
}

function expandCommentData(data: string, forPath: string): string {
  const match = COMMENT_REGEX.exec(data);
  if (match === null) {
    return data;
  }
  const commentPrefix = match[1];
  const bindText = match[2];
  const commentSuffix = match[3];
  const expanded = expandShorthandInStatePart(bindText, forPath);
  return commentPrefix + expanded + commentSuffix;
}

function expandBindAttribute(attrValue: string, forPath: string): string {
  const parts = attrValue.split(';');
  let changed = false;
  const result = parts.map(part => {
    const trimmed = part.trim();
    if (trimmed.length === 0) return part;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) return part;
    const propPart = trimmed.slice(0, colonIndex).trim();
    const statePart = trimmed.slice(colonIndex + 1).trim();
    const expanded = expandShorthandInStatePart(statePart, forPath);
    if (expanded !== statePart) {
      changed = true;
      return `${propPart}: ${expanded}`;
    }
    return part;
  });
  if (!changed) return attrValue;
  return result.join(';');
}

export function expandShorthandInBindAttribute(attrValue: string, forPath: string): string {
  return expandBindAttribute(attrValue, forPath);
}

export function expandShorthandPaths(root: DocumentFragment, forPath: string): void {
  const bindAttr = config.bindAttributeName;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_ELEMENT,
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.COMMENT_NODE) {
      const comment = node as Comment;
      comment.data = expandCommentData(comment.data, forPath);
      continue;
    }
    const element = node as Element;
    if (element instanceof HTMLTemplateElement) {
      continue;
    }
    const attr = element.getAttribute(bindAttr);
    if (attr !== null) {
      const expanded = expandBindAttribute(attr, forPath);
      if (expanded !== attr) {
        element.setAttribute(bindAttr, expanded);
      }
    }
  }
}
