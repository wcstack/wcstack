import { getPathInfo } from "../address/PathInfo";
import { IBindingInfo } from "../types";
import { trimFn } from "./utils";

type StatePartParseResult = Pick<IBindingInfo, 
  'stateName' | 'statePathName' | 'statePathInfo' | 'filterTexts'>;

// format: statePath@stateName|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// stateName: optional, default is 'default'
// filters-format: filterName or filterName(arg1,arg2)
export function parseStatePart(statePart: string): StatePartParseResult {
  const [stateAndPath, ...filterTexts] = statePart.split('|').map(trimFn);
  const [statePathName, stateName = 'default'] = stateAndPath.split('@').map(trimFn);
  return {
    stateName,
    statePathName,
    statePathInfo: getPathInfo(statePathName),
    filterTexts,
  };
}
