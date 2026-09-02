import { getPathInfo } from "../address/PathInfo";
import { raiseError } from "../raiseError";
import { FILTER_SEPARATOR, STATE_NAME_SEPARATOR } from "../define";
import { IBindingInfo, IFilterInfo } from "../types";
import { parseFilters } from "./parseFilters";
import { trimFn } from "./utils";

type StatePartParseResult = Pick<IBindingInfo, 
  'stateName' | 'statePathName' | 'statePathInfo' | 'outFilters'>;

const cacheFilterInfos = new Map<string, IFilterInfo[]>();

/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
export function clearStatePartCacheForTooling(): void {
  cacheFilterInfos.clear();
}

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
  if (stateAndPath.indexOf(STATE_NAME_SEPARATOR) !== -1) {
    // 名前次元は v2 で撤去（docs/state-mount-design.md D16 / §9）。パスは 1 本のツリー。
    raiseError(
      `"${stateAndPath}": the "@name" selector was removed in v2 — there is a single state tree. ` +
      `Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.`,
    );
  }
  const statePathName = stateAndPath;
  const stateName = 'default';
  const pathInfo = getPathInfo(statePathName);
  return {
    stateName,
    statePathName,
    statePathInfo: pathInfo,
    outFilters: filters,
  };
}
