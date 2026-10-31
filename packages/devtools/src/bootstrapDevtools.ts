/**
 * bootstrapDevtools.ts
 *
 * `<wcs-devtools>` の登録と自動挿入（devtools-tag-design.md §2）。
 * - 既に定義済みなら再定義しない（別のコピーが定義していれば 1 回警告する — registerComponents.ts）
 * - ページに `<wcs-devtools>` が無ければ body 末尾に 1 つ挿入
 *   （手動で書かれていれば挿入しない）
 * - SSR では何もしない
 */

import { registerComponents, TAG_NAME } from "./registerComponents";

function insertIfAbsent(): void {
  if (document.querySelector(TAG_NAME) !== null) {
    return;
  }
  document.body.appendChild(document.createElement(TAG_NAME));
}

export function bootstrapDevtools(): void {
  if (document.documentElement.hasAttribute("data-wcs-server")) {
    return;
  }
  registerComponents();
  if (document.body !== null) {
    insertIfAbsent();
  } else {
    document.addEventListener("DOMContentLoaded", insertIfAbsent, { once: true });
  }
}
