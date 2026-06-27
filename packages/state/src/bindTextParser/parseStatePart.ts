import { getPathInfo } from "../address/PathInfo";
import { FILTER_SEPARATOR, STATE_NAME_SEPARATOR } from "../define";
import { IBindingInfo, IFilterInfo } from "../types";
import { parseFilters } from "./parseFilters";
import { trimFn } from "./utils";

type StatePartParseResult = Pick<IBindingInfo, 
  'stateName' | 'statePathName' | 'statePathInfo' | 'outFilters'>;

const cacheFilterInfos = new Map<string, IFilterInfo[]>();

// format: statePath@stateName|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// stateName: optional, default is 'default'
// filters-format: filterName or filterName(arg1,arg2)
export function parseStatePart(statePart: string): StatePartParseResult {
  const pos = statePart.indexOf(FILTER_SEPARATOR);
  let stateAndPath: string = '';
  let filterTexts: string[] = [];
  let filtersText = '';
  let filters: IFilterInfo[] = [];
  if (pos !== -1) {
    stateAndPath = statePart.slice(0, pos).trim();
    filtersText = statePart.slice(pos + 1).trim();
    if (cacheFilterInfos.has(filtersText)) {
      filters = cacheFilterInfos.get(filtersText)!;
    } else {
      filterTexts = filtersText.split(FILTER_SEPARATOR).map(trimFn);
      filters = parseFilters(filterTexts, "output");
      cacheFilterInfos.set(filtersText, filters);
    }
  } else {
    stateAndPath = statePart.trim();
  }
  const [statePathName, stateName = 'default'] = stateAndPath.split(STATE_NAME_SEPARATOR).map(trimFn);
  const pathInfo = getPathInfo(statePathName);
  return {
    stateName,
    statePathName,
    statePathInfo: pathInfo,
    outFilters: filters,
  };
}
