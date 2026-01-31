/**
 * getResolvedPathInfo.ts
 *
 * Utility for parsing and generating detailed path information (IResolvedPathInfo)
 * from State property names (path strings), including wildcard and index information.
 *
 * Main responsibilities:
 * - Breaks down property names to determine presence and type of wildcards and indexes
 * - Automatically determines wildcard type: context/all/partial/none
 * - Caches by path for reusability and performance
 * - Retrieves structured path information via getStructuredPathInfo
 *
 * Design points:
 * - Caches using Map to handle reserved words like "constructor" and "toString"
 * - Flexibly determines wildcards (*) and numeric indexes, storing them in wildcardIndexes
 * - context type indicates unresolved indexes, all type indicates all resolved indexes, partial type indicates mixed
 * - ResolvedPathInfo class centralizes path parsing and information management
 */
import { IResolvedAddress } from './types';
/**
 * Retrieves or creates resolved path information for a property path.
 *
 * This function caches resolved path information for performance.
 * On first access, it parses the path and creates a ResolvedPathInfo instance.
 * Subsequent accesses return the cached result.
 *
 * @param name - Property path string (e.g., "items.*.name", "data.0.value")
 * @returns Resolved path information containing segments, wildcards, and type classification
 */
export declare function getResolvedAddress(name: string): IResolvedAddress;
//# sourceMappingURL=ResolvedAddress.d.ts.map