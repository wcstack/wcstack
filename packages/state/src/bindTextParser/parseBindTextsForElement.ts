import { raiseError } from "../raiseError.js";
import { STRUCTURAL_BINDING_TYPE_SET } from "../structural/define.js";
import { IBindingInfo } from "../types.js";
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

export function parseBindTextsForElement(bindText: string): ParseBindTextResult[] {
  const [ ...bindTexts ] = bindText.split(';').map(trimFn).filter(s => s.length > 0);
  const results = bindTexts.map((bindText): ParseBindTextResult => {
    const separatorIndex = bindText.indexOf(':');
    if (separatorIndex === -1) {
      raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
    }
    const propPart = bindText.slice(0, separatorIndex).trim();
    const statePart = bindText.slice(separatorIndex + 1).trim();
    if (propPart === 'else') {
      return {
        propName: 'else',
        propSegments: ['else'],
        propModifiers: [],
        statePathName: '',
        statePathInfo: null,
        stateName: '',
        filterTexts: [],
        bindingType: 'else',
      };
    } else if (propPart === 'if' || propPart === 'elseif' || propPart === 'for') {
      const stateResult = parseStatePart(statePart);
      return {
        propName: propPart,
        propSegments: [propPart],
        propModifiers: [],
        ...stateResult,
        bindingType: propPart,
      };
    } else {
      const stateResult = parseStatePart(statePart);
      const propResult = parsePropPart(propPart);
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

