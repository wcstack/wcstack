import { indexOfOutsideQuotes, splitOutsideQuotes } from "../bindTextParser/utils.js";
import { config } from "../config.js";
import { DELIMITER, WILDCARD } from "../define.js";

const COMMENT_REGEX = /^(\s*@@\s*(?:.*?)\s*:\s*)(.+?)(\s*)$/;

/**
 * 右辺の短縮パス（`.name` / `.`）を展開する。
 *
 * ここの `|` 走査は、**現在の文法では素の `indexOf` と結果が変わらない** — 右辺で引用符が
 * 現れるのはフィルタ引数、つまり最初の `|` より後ろだけなので、「引用符の中の `|` が
 * 最初に来る」形が作れない（ゆえに変異テストでも差が出ない）。それでも正本のヘルパで
 * 走らせているのは、下の `expandBindAttribute` の `;` / `:` と規準を 1 つに揃えるため。
 * **パスそのものに引用符を許す拡張が入れば、ここだけが素の走査だと即座に破れる。**
 */
function expandShorthandInStatePart(statePart: string, forPath: string): string {
  const prefix = forPath + DELIMITER + WILDCARD;
  const pipeIndex = indexOfOutsideQuotes(statePart, '|');
  let pathPart: string;
  let suffix: string;
  if (pipeIndex !== -1) {
    pathPart = statePart.slice(0, pipeIndex).trim();
    suffix = statePart.slice(pipeIndex);
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

/**
 * `for` 行の短縮パス（`.name` / `.`）を `items.*.name` へ展開する。
 *
 * 区切りの走査は**引用符の外だけ**（要件 B1）。`splitBindTexts` と同じ正本のヘルパを使う:
 * ここで素の `split(';')` / `indexOf(':')` / `indexOf('|')` を使うと、
 * `value|defaults('00:00'): .startTime` のようなごく普通のフィルタ引数で `statePart` が
 * `00'): .startTime` になり、短縮展開が起きず `.startTime` のまま残って
 * `[wcs/binding-path-missing]` が出る — しかも `getBindingsReady` は reject しないので
 * **行が 1 つも描画されないまま無言で終わる**。lint と拡張は正しく展開するので気づけない。
 */
function expandBindAttribute(attrValue: string, forPath: string): string {
  const parts = splitOutsideQuotes(attrValue, ';');
  let changed = false;
  const result = parts.map(part => {
    const trimmed = part.trim();
    if (trimmed.length === 0) return part;
    const colonIndex = indexOfOutsideQuotes(trimmed, ':');
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
