import { DELIMITER, MAX_PATH_SEGMENTS, RECURSION_WILDCARD, WILDCARD } from "../define.js";
import { raiseError } from "../raiseError.js";
import { IPathInfo } from "./types.js";

const _cache: Map<string, IPathInfo> = new Map();

/**
 * **tooling 専用**（`@wcstack/state/parser` の clearParserCaches からのみ呼ぶ）。
 * ランタイム文脈で呼んではならない — PathInfo のインスタンス同一性は正規化キー
 * （依存グラフ・アドレス比較）の前提であり、クリアすると同一パスの新旧インスタンスが
 * 併存して identity 比較が黙って壊れる。言語サーバー等の長時間プロセスが、編集中の
 * 中間パス（`user.n` 等）の恒久 intern によるメモリ単調増加を断つための出口。
 */
export function clearPathInfoCacheForTooling(): void {
  _cache.clear();
}

let id: number = 0;
export function getPathInfo(path: string): IPathInfo {
  let pathInfo = _cache.get(path);
  if (typeof pathInfo !== "undefined") {
    return pathInfo;
  }
  // 再帰ワイルドカードはオーサリング層の記号で、ここへ降りてきてはならない
  // （降ろすと wildcardCount が不定になり ListIndex 連鎖長・$1..$n・$resolve の
  //  厳密一致・走査の段数が同時に壊れる。設計書 D2）。到達したということは、
  // `**` を解釈しない消費者に `**` パスが渡ったということ。通常のパスはこの検査を
  // 初回 intern のときにしか払わない（`**` パスは intern されないので読むたびに落ちる）。
  if (path.indexOf(RECURSION_WILDCARD) !== -1) {
    raiseError(
      `[wcs/recursion-unsupported] "${path}" uses "${RECURSION_WILDCARD}", which is not accepted here. ` +
      `It is only meaningful in a $recursion declaration, in a recursive getter key, and in the path ` +
      `argument of $getAll / $setAll — and only when the state declares a $recursion anchor.`
    );
  }
  // 深さの上限（初回 intern のときだけ払う）。`PathInfo` は**全ての接頭辞**を intern するので
  // 深さ N のパス 1 本で時間もメモリも O(N²) になり、上限が無いと約 4KB の属性値 1 つで
  // タブが落ちた（実測値は `MAX_PATH_SEGMENTS` の注記）。
  //
  // **ワイルドカードの段数はここでは見ない。** 段数の上限（`MAX_WILDCARD_DEPTH` ＝ manifest の
  // `indexParam.maxDepth`）は `$1..$N` の表が引けるかという別の話で、`recursion/expand.ts` の
  // `[wcs/recursion-depth-exceeded]` と `proxy/traps/get.ts` の `$N` 範囲外診断が、原因を
  // 名指しできる場所で受け持っている（番人: `integration.recursionPrerequisites.test.ts` が
  // 「PathInfo 自体には段数の上限が無い」を固定している）。ここで先に落とすと、深さ超過か
  // 循環かの切り分けが効かなくなる
  const segmentCount = countSegments(path);
  if (segmentCount > MAX_PATH_SEGMENTS) {
    raiseError(
      `[wcs/binding-syntax] "${path}" has ${segmentCount} path segments — the limit is ${MAX_PATH_SEGMENTS}. ` +
      `Every prefix of a path is interned, so the cost grows with the square of the depth.`,
    );
  }
  pathInfo = Object.freeze(new PathInfo(path));
  _cache.set(path, pathInfo);
  return pathInfo;
}

/** `.` の数 + 1。`split` の配列を作らずに数える（初回 intern のときだけ通る） */
function countSegments(path: string): number {
  let count = 1;
  for (let i = 0; i < path.length; i++) {
    if (path[i] === DELIMITER) {
      count++;
    }
  }
  return count;
}

class PathInfo implements IPathInfo {
  readonly id: number = ++id;
  readonly path: string;
  readonly segments: string[];
  readonly lastSegment: string;
  readonly cumulativePaths: string[];
  readonly cumulativePathSet: Set<string>;
  readonly cumulativePathInfos: IPathInfo[];
  readonly cumulativePathInfoSet: Set<IPathInfo>;
  readonly parentPath: string | null;
  readonly wildcardPaths: string[];
  readonly wildcardPathSet: Set<string>;
  readonly indexByWildcardPath: Record<string, number>;
  readonly wildcardPathInfos: IPathInfo[];
  readonly wildcardPathInfoSet: Set<IPathInfo>;
  readonly wildcardParentPaths: string[];
  readonly wildcardParentPathSet: Set<string>;
  readonly wildcardParentPathInfos: IPathInfo[];
  readonly wildcardParentPathInfoSet: Set<IPathInfo>;
  readonly wildcardPositions: number[];
  readonly lastWildcardPath: string | null;
  readonly lastWildcardInfo: IPathInfo | null;
  readonly wildcardCount: number;
  readonly parentPathInfo: IPathInfo | null;
  constructor(path: string) {
    // Helper to get or create StructuredPathInfo instances, avoiding redundant creation for self-reference
    const getPattern = (_path: string): IPathInfo => {
      return (path === _path) ? this : getPathInfo(_path);
    };
    
    // Split the pattern into individual path segments (e.g., "items.*.name" → ["items", "*", "name"])
    const segments = path.split(".");
    
    // Arrays to track all cumulative paths from root to each segment
    const cumulativePaths = [];
    const cumulativePathInfos: IPathInfo[] = [];
    
    // Arrays to track wildcard-specific information
    const wildcardPaths = [];
    const indexByWildcardPath: Record<string, number> = {}; // Maps wildcard path to its index position
    const wildcardPathInfos = [];
    const wildcardParentPaths = []; // Paths of parent segments for each wildcard
    const wildcardParentPathInfos = [];
    const wildcardPositions = [];
    
    let currentPatternPath = "", prevPatternPath = "";
    let wildcardCount = 0;
    
    // Iterate through each segment to build cumulative paths and identify wildcards
    for(let i = 0; i < segments.length; i++) {
      currentPatternPath += segments[i];
      
      // If this segment is a wildcard, track it with all wildcard-specific metadata
      if (segments[i] === WILDCARD) {
        wildcardPaths.push(currentPatternPath);
        indexByWildcardPath[currentPatternPath] = wildcardCount; // Store wildcard's ordinal position
        wildcardPathInfos.push(getPattern(currentPatternPath));
        wildcardParentPaths.push(prevPatternPath); // Parent path is the previous cumulative path
        wildcardParentPathInfos.push(getPattern(prevPatternPath));
        wildcardPositions.push(i);
        wildcardCount++;
      }
      
      // Track all cumulative paths for hierarchical navigation (e.g., "items", "items.*", "items.*.name")
      cumulativePaths.push(currentPatternPath);
      cumulativePathInfos.push(getPattern(currentPatternPath));
      
      // Save current path as previous for next iteration, then add separator
      prevPatternPath = currentPatternPath;
      currentPatternPath += ".";
    }
    
    // Determine the deepest (last) wildcard path and the parent path of the entire pattern
    const lastWildcardPath = wildcardPaths.length > 0 ? wildcardPaths[wildcardPaths.length - 1] : null;
    const parentPath = cumulativePaths.length > 1 ? cumulativePaths[cumulativePaths.length - 2] : null;
    
    // Assign all analyzed data to readonly properties
    this.path = path;
    this.segments = segments;
    this.lastSegment = segments[segments.length - 1];
    this.cumulativePaths = cumulativePaths;
    this.cumulativePathSet = new Set(cumulativePaths); // Set for fast lookup
    this.cumulativePathInfos = cumulativePathInfos;
    this.cumulativePathInfoSet = new Set(cumulativePathInfos);
    this.wildcardPaths = wildcardPaths;
    this.wildcardPathSet = new Set(wildcardPaths);
    this.indexByWildcardPath = indexByWildcardPath;
    this.wildcardPathInfos = wildcardPathInfos;
    this.wildcardPathInfoSet = new Set(wildcardPathInfos);
    this.wildcardParentPaths = wildcardParentPaths;
    this.wildcardParentPathSet = new Set(wildcardParentPaths);
    this.wildcardParentPathInfos = wildcardParentPathInfos;
    this.wildcardParentPathInfoSet = new Set(wildcardParentPathInfos);
    this.wildcardPositions = wildcardPositions;
    this.lastWildcardPath = lastWildcardPath;
    this.lastWildcardInfo = lastWildcardPath ? getPattern(lastWildcardPath) : null;
    this.parentPath = parentPath;
    this.parentPathInfo = parentPath ? getPattern(parentPath) : null;
    this.wildcardCount = wildcardCount;
  }
}
