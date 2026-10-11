/**
 * `getPathInfo` of `@wcstack/state/parser`: a path's segments, cumulative prefixes and wildcard
 * positions, interned per path (the same shape as 3.x). Tooling only — the engine resolves paths
 * into its own patterns.
 */
import { DELIMITER, MAX_PATH_SEGMENTS, RECURSION_WILDCARD } from "../parser/define";
import { WILDCARD } from "../pattern";
import { raise, M } from "../messages";

export interface IPathInfo {
  readonly id: number;
  readonly path: string;
  readonly segments: string[];
  readonly lastSegment: string;
  readonly cumulativePaths: string[];
  readonly cumulativePathSet: Set<string>;
  readonly cumulativePathInfos: IPathInfo[];
  readonly cumulativePathInfoSet: Set<IPathInfo>;
  readonly parentPath: string | null;
  readonly parentPathInfo: IPathInfo | null;
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
}

const cache = new Map<string, IPathInfo>();
let ids = 0;

export function clearPathInfoCache(): void {
  cache.clear();
}

export function getPathInfo(path: string): IPathInfo {
  const known = cache.get(path);
  if (known !== undefined) return known;
  if (path.includes(RECURSION_WILDCARD)) raise(M.RecursionUnsupported, [path]);
  const count = path.split(DELIMITER).length;
  if (count > MAX_PATH_SEGMENTS) raise(M.TooManySegments, [path, count]);
  const info = Object.freeze(new PathInfo(path));
  cache.set(path, info);
  return info;
}

class PathInfo implements IPathInfo {
  readonly id = ++ids;
  readonly path: string;
  readonly segments: string[];
  readonly lastSegment: string;
  readonly cumulativePaths: string[] = [];
  readonly cumulativePathSet: Set<string>;
  readonly cumulativePathInfos: IPathInfo[] = [];
  readonly cumulativePathInfoSet: Set<IPathInfo>;
  readonly parentPath: string | null;
  readonly parentPathInfo: IPathInfo | null;
  readonly wildcardPaths: string[] = [];
  readonly wildcardPathSet: Set<string>;
  readonly indexByWildcardPath: Record<string, number> = {};
  readonly wildcardPathInfos: IPathInfo[] = [];
  readonly wildcardPathInfoSet: Set<IPathInfo>;
  readonly wildcardParentPaths: string[] = [];
  readonly wildcardParentPathSet: Set<string>;
  readonly wildcardParentPathInfos: IPathInfo[] = [];
  readonly wildcardParentPathInfoSet: Set<IPathInfo>;
  readonly wildcardPositions: number[] = [];
  readonly lastWildcardPath: string | null;
  readonly lastWildcardInfo: IPathInfo | null;
  readonly wildcardCount: number;

  constructor(path: string) {
    // a prefix is interned too; the path itself is this instance (not frozen yet)
    const info = (p: string): IPathInfo => (p === path ? this : getPathInfo(p));
    const segments = path.split(DELIMITER);
    let current = "";
    let prev = "";
    for (let i = 0; i < segments.length; i++) {
      current += segments[i];
      if (segments[i] === WILDCARD) {
        this.indexByWildcardPath[current] = this.wildcardPaths.length;
        this.wildcardPaths.push(current);
        this.wildcardPathInfos.push(info(current));
        this.wildcardParentPaths.push(prev);
        this.wildcardParentPathInfos.push(info(prev));
        this.wildcardPositions.push(i);
      }
      this.cumulativePaths.push(current);
      this.cumulativePathInfos.push(info(current));
      prev = current;
      current += DELIMITER;
    }
    const last = this.wildcardPaths.length > 0 ? this.wildcardPaths[this.wildcardPaths.length - 1] : null;
    const parent = this.cumulativePaths.length > 1 ? this.cumulativePaths[this.cumulativePaths.length - 2] : null;
    this.path = path;
    this.segments = segments;
    this.lastSegment = segments[segments.length - 1];
    this.cumulativePathSet = new Set(this.cumulativePaths);
    this.cumulativePathInfoSet = new Set(this.cumulativePathInfos);
    this.wildcardPathSet = new Set(this.wildcardPaths);
    this.wildcardPathInfoSet = new Set(this.wildcardPathInfos);
    this.wildcardParentPathSet = new Set(this.wildcardParentPaths);
    this.wildcardParentPathInfoSet = new Set(this.wildcardParentPathInfos);
    this.lastWildcardPath = last;
    this.lastWildcardInfo = last !== null ? info(last) : null;
    this.parentPath = parent;
    this.parentPathInfo = parent !== null ? info(parent) : null;
    this.wildcardCount = this.wildcardPaths.length;
  }
}
