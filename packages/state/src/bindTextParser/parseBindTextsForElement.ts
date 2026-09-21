import { getPathInfo } from "../address/PathInfo.js";
import {
  BINDING_SEPARATOR,
  ELSE_KEYWORD,
  EVENT_PROP_PREFIX,
  FILTER_SEPARATOR,
  MODIFIER_SEPARATOR,
  EVENT_TOKEN_NAMESPACE,
  PROP_VALUE_SEPARATOR,
  SPREAD_PROP,
} from "../define.js";
import { LINT_HINT } from "../errorGuidance.js";
import { raiseError } from "../raiseError.js";
import { STRUCTURAL_BINDING_TYPE_SET } from "../structural/define.js";
import { parsePropPart } from "./parsePropPart.js";
import { parseStatePart } from "./parseStatePart.js";
import { ParseBindTextResult } from "./types.js";
import { splitOutsideQuotes, trimFn } from "./utils.js";

// format: propPart:statePart; propPart:statePart; ...
// special-propPart:
//   if: statePart (single binding for conditional rendering)
//   else: (single binding for conditional rendering, and statePart is ignored)
//   elseif: statePart only (single binding for conditional rendering)
//   for: statePart only (single binding for loop rendering)
//   onclick: statePart, onchange: statePart etc. (event listeners)
//   ...: statePart (spread — expand wcBindable properties+inputs of target object)

/** 左辺に修飾子も入力フィルタも取らない束縛（構造ディレクティブと spread）— 付いていれば拒否する（要件 B4） */
const KEYWORDS_WITHOUT_MODIFIERS = new Set<string>([ELSE_KEYWORD, 'if', 'elseif', 'for', SPREAD_PROP]);

/**
 * `data-wcs` の値をバインディングごとに区切る（前後の空白は残す — tooling が位置を数えられるように）。
 * 引用符の中の `;` は区切りではない（要件 B1 — `join(';')`）。ランタイムと tooling（`@wcstack/state/parser`）で共有する
 */
export function splitBindTexts(bindText: string): string[] {
  return splitOutsideQuotes(bindText, BINDING_SEPARATOR);
}

export function parseBindTextsForElement(bindText: string): ParseBindTextResult[] {
  const [ ...bindTexts ] = splitBindTexts(bindText).map(trimFn).filter(s => s.length > 0);
  const results = bindTexts.map((bindText): ParseBindTextResult => {
    const separatorIndex = bindText.indexOf(PROP_VALUE_SEPARATOR);
    if (separatorIndex === -1) {
      raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
    }
    const propPart = bindText.slice(0, separatorIndex).trim();
    const statePart = bindText.slice(separatorIndex + 1).trim();
    // 種別は修飾子・入力フィルタより前の名前で決める（要件 B4）。以前は左辺全体との完全一致で
    // 判定していたので、`radio#ro:` が汎用プロパティに落ちていた
    const keyword = propPart.split(MODIFIER_SEPARATOR)[0].split(FILTER_SEPARATOR)[0].trim();
    if (keyword !== propPart && KEYWORDS_WITHOUT_MODIFIERS.has(keyword)) {
      raiseError(`[wcs/binding-syntax] "${bindText}": "${keyword}" takes no modifiers or filters on its left side — write "${keyword}:".${LINT_HINT}`);
    }
    if (propPart === ELSE_KEYWORD) {
      if (statePart.length > 0) {
        // else は値を取らない（要件 B2）。以前は右辺を黙って捨てていた
        raiseError(`[wcs/binding-syntax] "${bindText}": "else" takes no value — write "else:".${LINT_HINT}`);
      }
      const pathInfo = getPathInfo('#else');
      return {
        propName: ELSE_KEYWORD,
        propSegments: [ELSE_KEYWORD],
        propModifiers: [],
        statePathName: '#else',
        statePathInfo: pathInfo,
        inFilters: [],
        outFilters: [],
        bindingType: 'else',
      };
    } else if (propPart === SPREAD_PROP) {
      const stateResult = parseStatePart(statePart);
      if (stateResult.outFilters.length > 0) {
        raiseError(`Invalid spread binding "${bindText}": filters are not allowed on spread targets.`);
      }
      if (stateResult.statePathName.length === 0) {
        raiseError(`Invalid spread binding "${bindText}": spread target path is required.`);
      }
      return {
        propName: SPREAD_PROP,
        propSegments: [SPREAD_PROP],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: 'spread',
      };
    } else if (propPart === 'if'
      || propPart === 'elseif'
      || propPart === 'for'
    ) {
      const stateResult = parseStatePart(statePart);
      return {
        propName: propPart,
        propSegments: [propPart],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: propPart,
      };
    } else if (keyword === 'radio' || keyword === 'checkbox') {
      // 修飾子（`#ro`・`#onchange` …）と入力フィルタは radio / checkbox のハンドラが読む（要件 B4）
      const stateResult = parseStatePart(statePart);
      const propResult = parsePropPart(propPart);
      return {
        ...propResult,
        ...stateResult,
        bindingType: keyword,
      };
    } else {
      const stateResult = parseStatePart(statePart);
      const propResult = parsePropPart(propPart);
      // eventToken.<prop>: <name> は要素 dispatch を state へ流す pub/sub 配線。
      // 値適用ではないため bindingType 'event' として listener attach 経路に乗せる。
      if (propResult.propSegments[0] === EVENT_TOKEN_NAMESPACE) {
        return {
          ...propResult,
          ...stateResult,
          bindingType: 'event',
        };
      }
      if (propResult.propSegments[0].startsWith(EVENT_PROP_PREFIX)) {
        return {
          ...propResult,
          ...stateResult,
          bindingType: 'event',
        };
      } else {
        return {
          ...propResult,
          ...stateResult,
          bindingType: 'prop',
        };
      }
    }
  });
  // check for sigle binding for 'if', 'elseif', 'else', 'for'
  if (results.length > 1) {
    const isIncludeSingleBinding = results.some(r => STRUCTURAL_BINDING_TYPE_SET.has(r.bindingType));
    if (isIncludeSingleBinding) {
      // lint 側の単独バインディング検査（bindingValidator の structuralMustBeSingle）が
      // 同じケースを検出するため誘導を付ける（三面同語彙）。
      raiseError(`[wcs/template-syntax] Invalid bindText: "${bindText}". 'if', 'elseif', 'else', and 'for' bindings must be single binding. Put the structural binding alone in its own data-wcs (e.g. <template data-wcs="for: items">).${LINT_HINT}`);
    }
  }
  return results;
}

