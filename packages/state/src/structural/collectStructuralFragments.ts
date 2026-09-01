import { getParseBindTextResults } from "../bindings/getParseBindTextResults";
import { findNestedLightDomComponents } from "../bindings/lightDomComponentScope";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { ParseBindTextResult } from "../bindTextParser/types";
import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { BindingType } from "../types";
import { createNotFilter } from "./createNotFilter";
import { expandShorthandInBindAttribute, expandShorthandPaths } from "./expandShorthandPaths";
import { setFragmentInfoByUUID } from "./fragmentInfoByUUID";
import { getFragmentNodeInfos } from "./getFragmentNodeInfos";
import { getNodePath } from "./getNodePath";
import { optimizeFragment } from "./optimizeFragment";
import { IFragmentInfo } from "./types";

const keywordByBindingType: Map<BindingType, string> = new Map<BindingType, string>([
  ["for",  config.commentForPrefix],
  ["if",  config.commentIfPrefix],
  ["elseif", config.commentElseIfPrefix],
  ["else", config.commentElsePrefix],
]);

const notFilter = createNotFilter();

function cloneNotParseBindTextResult(
  bindingType: BindingType,
  parseBindTextResult: ParseBindTextResult
): ParseBindTextResult {
  const filters = parseBindTextResult.outFilters;
  return {
    ...parseBindTextResult,
    outFilters: [...filters, notFilter],
    bindingType: bindingType,
  };
}

/**
 * パース結果の変換フック（Phase 2 のマウント — impl-plan §3-0 の 1）。
 *
 * マウントされたスコープでは、フラグメントのパース結果（テンプレート自身の for/if と
 * nodeInfos の中身）を**登録時にここで**親ツリーの絶対パスへ書き換える。行の実体化
 * （collectNodesAndBindingInfosByFragment）は変換済みの nodeInfos をそのまま使うので、
 * 行生成のホットパスに変換コストは載らない。
 *
 * shorthand 展開（`.name` → `<forPath>.*.name`）は**変換前の**内側パスで行う —
 * 変換後のパスを forPath に使うと、展開結果が絶対パスになり二重変換の判別が
 * つかなくなるため。したがって入れ子のフラグメントも常に「スコープ相対のパース結果 →
 * 変換」の順を保ち、変換は各レベルで一度だけ掛かる。
 *
 * `uuid` を持つ nodeInfo エントリ（入れ子フラグメントの参照 — 再帰で変換済み）には
 * 掛けない（collectNodesAndBindingInfos.applyTransform と同じ規則）。
 */
export type FragmentParseTransform = (parsed: ParseBindTextResult) => ParseBindTextResult;

function transformNodeInfos(
  nodeInfos: IFragmentInfo["nodeInfos"],
  transform: FragmentParseTransform,
): void {
  for (const nodeInfo of nodeInfos) {
    for (let i = 0; i < nodeInfo.parseBindTextResults.length; i++) {
      const parsed = nodeInfo.parseBindTextResults[i];
      if (parsed.uuid != null) continue;
      nodeInfo.parseBindTextResults[i] = transform(parsed);
    }
  }
}

function _getFragmentInfo(
  rootNode: Node,
  fragment: DocumentFragment,
  parseBindingTextResult: ParseBindTextResult,
  forPath?: string,
  transform?: FragmentParseTransform,
  // else 節はテンプレート自身の結果を if の**変換済み**結果から clone するため、
  // そこだけ再変換しない（nodeInfos は通常どおり変換する）
  transformOwnResult: boolean = true,
): IFragmentInfo {
  optimizeFragment(fragment);
  if (typeof forPath === "string") {
    expandShorthandPaths(fragment, forPath);
  }
  collectStructuralFragments(rootNode, fragment, forPath, transform);
  // after replacing and collect node infos on child fragment
  const fragmentInfo = {
    fragment: fragment,
    parseBindTextResult: typeof transform === "undefined" || !transformOwnResult
      ? parseBindingTextResult
      : transform(parseBindingTextResult),
    nodeInfos: getFragmentNodeInfos(fragment),
  }
  if (typeof transform !== "undefined") {
    transformNodeInfos(fragmentInfo.nodeInfos, transform);
  }
  return fragmentInfo;
}


export function collectStructuralFragments(rootNode: Node, walkRoot: Document | Element | DocumentFragment, forPath?: string, transform?: FragmentParseTransform): void {
  const elseKeyword = config.commentElsePrefix;
  // Light DOM の mapped コンポーネントの内側は、その子スコープが自分で処理する（§1.13）。
  // fragment info は rootNode + state 名で登録されるため、ホストのパスでここを拾うと
  // コンポーネント側の state がまだ名前登録を済ませておらず解決に失敗する。
  // コンポーネント要素自身は template ではないので、REJECT でサブツリーごと落として問題ない。
  const nestedComponents = findNestedLightDomComponents(walkRoot);
  const walker = document.createTreeWalker(
    walkRoot,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Node) {
        const element = node as Element;
        if (nestedComponents.length > 0 && nestedComponents.indexOf(element) !== -1) {
          return NodeFilter.FILTER_REJECT;
        }
        if (element.tagName.toLowerCase() === 'template') {
          const bindText = element.getAttribute(config.bindAttributeName) || '';
          if (bindText.length > 0) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  let lastIfFragmentInfo: IFragmentInfo | null = null; // for elseif chaining
  const elseFragmentInfos: IFragmentInfo[] = []; // for elseif chaining
  const templates: HTMLTemplateElement[] = [];
  while (walker.nextNode()) {
    const template = walker.currentNode as HTMLTemplateElement;
    templates.push(template);
  }

  for(const template of templates) {
    let bindText = template.getAttribute(config.bindAttributeName) || '';
    if (typeof forPath === "string") {
      bindText = expandShorthandInBindAttribute(bindText, forPath);
    }
    const parseBindTextResults = parseBindTextsForElement(bindText);
    let parseBindTextResult = parseBindTextResults[0];
    const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
    if (typeof keyword === 'undefined') {
      continue;
    }

    const bindingType = parseBindTextResult.bindingType;
    const fragment = template.content;
    const uuid = getUUID();
    let fragmentInfo: IFragmentInfo | null = null;

    // Determine childForPath for shorthand expansion
    const childForPath = bindingType === "for"
      ? parseBindTextResult.statePathName
      : forPath;

    if (bindingType === "else") {
      // check last 'if' or 'elseif' fragment info
      if (lastIfFragmentInfo === null) {
        raiseError(`'else' binding found without preceding 'if' or 'elseif' binding.`);
      }
      // else condition（if の変換済み結果の clone なので自身の再変換はしない）
      parseBindTextResult = cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult);
      fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath, transform, false);
      setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);

      const lastElseFragmentInfo = elseFragmentInfos.at(-1);
      const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
      if (typeof lastElseFragmentInfo !== "undefined") {
        template.remove();
        lastElseFragmentInfo.fragment.appendChild(placeHolder);
        lastElseFragmentInfo.nodeInfos.push({
          nodePath: getNodePath(placeHolder),
          parseBindTextResults: getParseBindTextResults(placeHolder),
        });
      } else {
        template.replaceWith(placeHolder);
      }
    } else if (bindingType === "elseif") {
      // check last 'if' or 'elseif' fragment info
      if (lastIfFragmentInfo === null) {
        raiseError(`'elseif' binding found without preceding 'if' or 'elseif' binding.`);
      }

      fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath, transform);
      setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
      const placeHolder = document.createComment(`@@${keyword}:${uuid}`);

      // create else fragment
      const elseUUID = getUUID();
      const elseFragmentInfo: IFragmentInfo = {
        fragment: document.createDocumentFragment(),
        parseBindTextResult: cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult),
        nodeInfos: [],
      };
      elseFragmentInfo.fragment.appendChild(placeHolder);
      elseFragmentInfo.nodeInfos.push({
        nodePath: getNodePath(placeHolder),
        parseBindTextResults: getParseBindTextResults(placeHolder),
      });
      setFragmentInfoByUUID(elseUUID, rootNode, elseFragmentInfo);
      const lastElseFragmentInfo = elseFragmentInfos.at(-1);
      elseFragmentInfos.push(elseFragmentInfo);
      const elsePlaceHolder = document.createComment(`@@${elseKeyword}:${elseUUID}`);

      if (typeof lastElseFragmentInfo !== "undefined") {
        template.remove();
        lastElseFragmentInfo.fragment.appendChild(elsePlaceHolder);
        lastElseFragmentInfo.nodeInfos.push({
          nodePath: getNodePath(elsePlaceHolder),
          parseBindTextResults: getParseBindTextResults(elsePlaceHolder),
        });
      } else {
        template.replaceWith(elsePlaceHolder);
      }

    } else {
      fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath, transform);
      setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
      const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
      template.replaceWith(placeHolder);
    }

    // Update lastIfFragmentInfo for if/elseif/else chaining
    if (bindingType === "if") {
      elseFragmentInfos.length = 0; // start new if chain
      lastIfFragmentInfo = fragmentInfo;
    } else if (bindingType === "elseif") {
      lastIfFragmentInfo = fragmentInfo;
    } else if (bindingType === "else") {
      lastIfFragmentInfo = null;
      elseFragmentInfos.length = 0; // end if chain
    }
  }
}
