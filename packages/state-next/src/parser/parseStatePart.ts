import { DELIMITER, FILTER_SEPARATOR, LINT_HINT, MAX_PATH_SEGMENTS, RECURSION_WILDCARD } from "./define";
import { parseFilters } from "./parseFilters";
import { raiseError } from "./raiseError";
import { ParsedBinding, ParsedFilter } from "./types";
import { indexOfOutsideQuotes, splitOutsideQuotes, trimFn } from "./utils";

// 解析の段の形（フィルタは名前と引数だけ — 実関数はエンジンが引く。要件 D16）。
// `@wcstack/state` はここで `statePathInfo`（`getPathInfo` の intern 結果）も返していたが、
// 新エンジンはパスを自分で解決するので文字列だけを返す。
export type StatePartParseResult = Pick<ParsedBinding, 'statePathName' | 'outFilters'>;

/**
 * 出力フィルタ列の解析結果のキャッシュ（鍵は `|` より後ろの原文）。同じ原文は**同じ配列**を返す —
 * 消費側は返された `outFilters` を変更しないこと。落ちた解析は載らない。
 * （`@wcstack/state` の tooling 専用の解放口 `clearStatePartCacheForTooling` は移植しない）
 */
const cacheFilterInfos = new Map<string, ParsedFilter[]>();

/**
 * `getPathInfo` が初回 intern で行っていた文字列だけで決まる検査の移植（順序も同じ:
 * `**` → セグメント数）。`getPathInfo` は `**` のパスを intern しないので毎回落ち、
 * 上限超えのパスも intern されないので毎回落ちる — 状態を持たない検査と同値。
 */
function checkPathLikeGetPathInfo(path: string): void {
  if (path.indexOf(RECURSION_WILDCARD) !== -1) {
    raiseError(
      `[wcs/recursion-unsupported] "${path}" uses "${RECURSION_WILDCARD}", which is not accepted here. ` +
      `It is only meaningful in a $recursion declaration, in a recursive getter key, and in the path ` +
      `argument of $getAll / $setAll — and only when the state declares a $recursion anchor.`
    );
  }
  let segmentCount = 1;
  for (let i = 0; i < path.length; i++) {
    if (path[i] === DELIMITER) {
      segmentCount++;
    }
  }
  if (segmentCount > MAX_PATH_SEGMENTS) {
    raiseError(
      `[wcs/binding-syntax] "${path}" has ${segmentCount} path segments — the limit is ${MAX_PATH_SEGMENTS}. ` +
      `Every prefix of a path is interned, so the cost grows with the square of the depth.`,
    );
  }
}

// format: statePath|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// filters-format: filterName or filterName(arg1,arg2)

/** Port of `@wcstack/state` `src/bindTextParser/parseStatePart.ts` (no `statePathInfo`). */
export function parseStatePart(statePart: string): StatePartParseResult {
  // 引用符の中の `|` はフィルタの区切りではない（要件 B1 — `join('|')`）
  const pos = indexOfOutsideQuotes(statePart, FILTER_SEPARATOR);
  let stateAndPath: string = '';
  let filterTexts: string[] = [];
  let filtersText = '';
  let filters: ParsedFilter[] = [];
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
  // 右辺も左辺（`parsePropPart`）と同じ規準で空セグメントを弾く（要件 B1）。
  //
  // **判定の前にループ相対の短縮形を正規化する。** `.` で始まる右辺は `for` 行の相対パスで
  // （展開はエンジンの仕事 — パーサは展開前の原文をそのまま返す）、先頭の空セグメント 1 つは正当。
  // とくに **`.` 単独は「行そのもの」を指す正規の書き方**（`state: .`）— 「先頭は許すが末尾は拒否」と
  // 素朴に書くと `"."` は `["", ""]` ＝ 先頭かつ末尾なので落ちる。取り除いた残りが空でも通すこと
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
  checkPathLikeGetPathInfo(statePathName);
  return {
    statePathName,
    outFilters: filters,
  };
}
