import { getPathInfo } from "../address/PathInfo.js";
import { BINDING_SEPARATOR, PROP_VALUE_SEPARATOR } from "../define.js";
import { raiseError } from "../raiseError.js";
import { STRUCTURAL_BINDING_TYPE_SET } from "../structural/define.js";
import { parsePropPart } from "./parsePropPart.js";
import { parseStatePart } from "./parseStatePart.js";
import { ParseBindTextResult } from "./types.js";
import { trimFn } from "./utils.js";

// format: propPart:statePart; propPart:statePart; ...
// special-propPart:
//   if: statePart (single binding for conditional rendering)
//   else: (single binding for conditional rendering, and statePart is ignored)
//   elseif: statePart only (single binding for conditional rendering)
//   for: statePart only (single binding for loop rendering)
//   onclick: statePart, onchange: statePart etc. (event listeners)
//   ...: statePart (spread — expand wcBindable properties+inputs of target object)

export function parseBindTextsForElement(bindText: string): ParseBindTextResult[] {
  const [ ...bindTexts ] = bindText.split(BINDING_SEPARATOR).map(trimFn).filter(s => s.length > 0);
  const results = bindTexts.map((bindText): ParseBindTextResult => {
    const separatorIndex = bindText.indexOf(PROP_VALUE_SEPARATOR);
    if (separatorIndex === -1) {
      raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
    }
    const propPart = bindText.slice(0, separatorIndex).trim();
    const statePart = bindText.slice(separatorIndex + 1).trim();
    if (propPart === 'else') {
      const pathInfo = getPathInfo('#else');
      return {
        propName: 'else',
        propSegments: ['else'],
        propModifiers: [],
        statePathName: '#else',
        statePathInfo: pathInfo,
        stateName: '',
        inFilters: [],
        outFilters: [],
        bindingType: 'else',
      };
    } else if (propPart === '...') {
      const stateResult = parseStatePart(statePart);
      if (stateResult.outFilters.length > 0) {
        raiseError(`Invalid spread binding "${bindText}": filters are not allowed on spread targets.`);
      }
      if (stateResult.statePathName.length === 0) {
        raiseError(`Invalid spread binding "${bindText}": spread target path is required.`);
      }
      return {
        propName: '...',
        propSegments: ['...'],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: 'spread',
      };
    } else if (propPart === 'if'
      || propPart === 'elseif'
      || propPart === 'for'
      || propPart === 'radio'
      || propPart === 'checkbox'
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
    } else {
      const stateResult = parseStatePart(statePart);
      const propResult = parsePropPart(propPart);
      // eventToken.<prop>: <name> は要素 dispatch を state へ流す pub/sub 配線。
      // 値適用ではないため bindingType 'event' として listener attach 経路に乗せる。
      if (propResult.propSegments[0] === 'eventToken') {
        return {
          ...propResult,
          ...stateResult,
          bindingType: 'event',
        };
      }
      if (propResult.propSegments[0].startsWith('on')) {
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
      raiseError(`Invalid bindText: "${bindText}". 'if', 'elseif', 'else', and 'for' bindings must be single binding.`);
    }
  }
  return results;
}

