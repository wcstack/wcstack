import { IBindingInfo } from "../types";
import { ParseBindTextResult } from "../bindTextParser/types";

export function getBindingInfos(node: Node, parseBindingTextResults: ParseBindTextResult[]): IBindingInfo[] {
  const bindingInfos: IBindingInfo[] = [];
  for (const parseBindingTextResult of parseBindingTextResults) {
    if (parseBindingTextResult.bindingType !== 'text') {
      bindingInfos.push({
        ...parseBindingTextResult,
        node: node,
        replaceNode: node,
      });
    } else {
      // フラグメント登録時に事前正規化済みの Text ノードはそのまま replaceNode に
      // 使う（node === replaceNode なら replaceToReplaceNode は no-op）。
      // 実 DOM 上の wcs-text コメント（非フラグメント経路）は従来どおり
      // 空 Text を生成して実行時に差し替える。
      const replaceNode = node.nodeType === Node.TEXT_NODE
        ? node
        : document.createTextNode('');
      bindingInfos.push({
        ...parseBindingTextResult,
        node: node,
        replaceNode: replaceNode,
      });
    }
  }
  return bindingInfos;
}
