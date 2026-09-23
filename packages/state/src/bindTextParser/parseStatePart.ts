import { getPathInfo } from "../address/PathInfo";
import { raiseError } from "../raiseError";
import { DELIMITER, FILTER_SEPARATOR } from "../define";
import { LINT_HINT } from "../errorGuidance";
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
  // 右辺も左辺（`parsePropPart`）と同じ規準で空セグメントを弾く（要件 B1）。放っておくと
  // `a.` / `a..b` は診断ゼロで `["a","",""]` のまま intern され、`textContent:` /
  // `textContent: |uc` は適用の段で「`Path ""` が無い」というパス名が空の診断になる。
  //
  // **判定の前にループ相対の短縮形を正規化する。** `.` で始まる右辺は `for` 行の相対パスで
  // （`structural/expandShorthandPaths.ts` / `bindTextParser/expandSpread.ts` が生成し、正本の
  // パーサは展開前の原文も解析する）、先頭の空セグメント 1 つは正当。とくに **`.` 単独は
  // 「行そのもの」を指す正規の書き方**で、README と `examples/recursive-tree/index.html` の
  // `state: .` がそれ — 「先頭は許すが末尾は拒否」と素朴に書くと `"."` は
  // `["", ""]` ＝ 先頭かつ末尾なので落ちる。取り除いた残りが空でも通すこと
  const isLoopRelative = statePathName.startsWith(DELIMITER);
  const body = isLoopRelative ? statePathName.slice(DELIMITER.length) : statePathName;
  const hasEmptySegment = body.length > 0 && body.split(DELIMITER).some((segment) => segment.length === 0);
  if (hasEmptySegment || (!isLoopRelative && body.length === 0)) {
    raiseError(
      `[wcs/binding-syntax] "${statePart}": the right side of a binding must name a state path — ` +
      `write "<property>: <path>" (a path segment cannot be empty; "." alone and a leading "." are ` +
      `the loop-relative shorthand).${LINT_HINT}`,
    );
  }
  const pathInfo = getPathInfo(statePathName);
  return {
    statePathName,
    statePathInfo: pathInfo,
    outFilters: filters,
  };
}
