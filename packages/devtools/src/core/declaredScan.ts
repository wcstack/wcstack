/**
 * core/declaredScan.ts
 *
 * 遅延アタッチ時の declared ビュー（protocol §6）。
 *
 * binding 台帳はフック接続前の分を復元できないため、DOM に残っている
 * `data-wcs` 属性と `<!--wcs-*: -->` コメントを再スキャンして
 * 「宣言レベルの配線ビュー」を組む。ライブ台帳と違い binding 実体・
 * 接続状態は分からない（UI では "declared" バッジで区別する）。
 *
 * パースは表示目的の簡易版（`prop[#mod]: path[@state][|filters]` を
 * `;` 区切りで分解するだけ）。正確なセマンティクスの正本は
 * @wcstack/state の bindTextParser であり、ここでは追随しない。
 */

export interface IDeclaredBinding {
  /** 宣言が載っている要素（コメント由来の場合は親要素） */
  readonly element: Element;
  readonly propName: string;
  readonly path: string;
  readonly stateName: string;
  readonly filters: readonly string[];
  /** 宣言ソース: data-wcs 属性か comment ノードか */
  readonly origin: "attribute" | "comment";
  readonly raw: string;
}

const DEFAULT_BIND_ATTRIBUTE = "data-wcs";
const COMMENT_PREFIXES = ["wcs-text", "wcs-for", "wcs-if", "wcs-elseif", "wcs-else"];

function parseEntry(
  element: Element,
  raw: string,
  origin: "attribute" | "comment"
): IDeclaredBinding | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const colon = trimmed.indexOf(":");
  if (colon < 0) {
    return null;
  }
  const propName = trimmed.slice(0, colon).trim();
  const rhs = trimmed.slice(colon + 1).trim();
  if (propName.length === 0 || rhs.length === 0) {
    return null;
  }
  const [pathPart, ...filterParts] = rhs.split("|").map((part) => part.trim());
  let path = pathPart;
  let stateName = "default";
  const at = pathPart.lastIndexOf("@");
  if (at > 0) {
    path = pathPart.slice(0, at).trim();
    stateName = pathPart.slice(at + 1).trim();
  }
  return {
    element,
    propName,
    path,
    stateName,
    filters: filterParts.filter((part) => part.length > 0),
    origin,
    raw: trimmed,
  };
}

/**
 * rootNode 配下の宣言配線を列挙する。
 * @param root 走査起点（Document / ShadowRoot / Element）
 * @param bindAttributeName バインド属性名（既定 data-wcs。setConfig で変えたページ用）
 */
export function scanDeclaredBindings(
  root: ParentNode,
  bindAttributeName: string = DEFAULT_BIND_ATTRIBUTE
): IDeclaredBinding[] {
  const result: IDeclaredBinding[] = [];

  // data-wcs 属性（template の for/if 宣言もこの属性に載る）
  for (const element of root.querySelectorAll(`[${bindAttributeName}]`)) {
    // querySelectorAll の一致条件上、属性は必ず存在する
    const raw = element.getAttribute(bindAttributeName)!;
    for (const part of raw.split(";")) {
      const entry = parseEntry(element, part, "attribute");
      if (entry !== null) {
        result.push(entry);
      }
    }
  }

  // <!--wcs-text: path--> 等のコメントノード（mustache 展開後の姿）
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_COMMENT);
  let comment = walker.nextNode();
  while (comment !== null) {
    // コメントノードの textContent は常に文字列
    const text = comment.textContent!.trim();
    const prefix = COMMENT_PREFIXES.find(
      (candidate) => text === candidate || text.startsWith(candidate + ":")
    );
    if (prefix !== undefined) {
      const parentElement =
        comment.parentNode instanceof Element ? comment.parentNode : null;
      if (parentElement !== null) {
        const body = text === prefix ? "" : text.slice(prefix.length + 1).trim();
        if (body.length > 0) {
          const propName = prefix === "wcs-text" ? "textContent" : prefix.slice("wcs-".length);
          // propName / body とも非空のため parseEntry は必ず成功する
          result.push(parseEntry(parentElement, `${propName}: ${body}`, "comment")!);
        }
      }
    }
    comment = walker.nextNode();
  }

  return result;
}
