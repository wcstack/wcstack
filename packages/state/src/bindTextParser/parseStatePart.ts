import { getPathInfo } from "../address/PathInfo";
import { raiseError } from "../raiseError";
import { FILTER_SEPARATOR } from "../define";
import { IParsedBinding, IParsedFilter } from "../types";
import { parseFilters } from "./parseFilters";
import { indexOfOutsideQuotes, splitOutsideQuotes, trimFn } from "./utils";

// 解析の段の形（フィルタは名前と引数だけ — 実関数は束縛計画の段で引く。要件 D16）
type StatePartParseResult = Pick<IParsedBinding,
  'statePathName' | 'statePathInfo' | 'outFilters'>;

const cacheFilterInfos = new Map<string, IParsedFilter[]>();

/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
export function clearStatePartCacheForTooling(): void {
  cacheFilterInfos.clear();
}

// format: statePath|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// filters-format: filterName or filterName(arg1,arg2)
export function parseStatePart(statePart: string): StatePartParseResult {
  // 引用符の中の `|` はフィルタの区切りではない（要件 B1 — `join('|')`）
  const pos = indexOfOutsideQuotes(statePart, FILTER_SEPARATOR);
  let stateAndPath: string = '';
  let filterTexts: string[] = [];
  let filtersText = '';
  let filters: IParsedFilter[] = [];
  if (pos !== -1) {
    stateAndPath = statePart.slice(0, pos).trim();
    filtersText = statePart.slice(pos + 1).trim();
    if (cacheFilterInfos.has(filtersText)) {
      filters = cacheFilterInfos.get(filtersText)!;
    } else {
      filterTexts = splitOutsideQuotes(filtersText, FILTER_SEPARATOR).map(trimFn);
      // 診断に埋める原文は**右辺の全文**（`parsePropPart` と同じ理由 — `a|` が空文字になる）
      filters = parseFilters(filterTexts, "output", statePart);
      cacheFilterInfos.set(filtersText, filters);
    }
  } else {
    stateAndPath = statePart.trim();
  }
  if (stateAndPath.indexOf("@") !== -1) {
    // 名前次元は v2 で撤去（docs/state-mount-design.md D16 / §9）。パスは 1 本のツリー。
    raiseError(
      `"${stateAndPath}": the "@name" selector was removed in v2 — there is a single state tree. ` +
      `Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.`,
    );
  }
  const statePathName = stateAndPath;
  const pathInfo = getPathInfo(statePathName);
  return {
    statePathName,
    statePathInfo: pathInfo,
    outFilters: filters,
  };
}
