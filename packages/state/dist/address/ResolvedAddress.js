import { getPathInfo } from './PathInfo';
/**
 * Cache for resolved path information.
 * Uses Map to safely handle property names including reserved words like "constructor" and "toString".
 */
const _cache = new Map();
/**
 * Class that parses and stores resolved path information.
 *
 * Analyzes property path strings to extract:
 * - Path segments and their hierarchy
 * - Wildcard locations and types
 * - Numeric indexes vs unresolved wildcards
 * - Wildcard type classification (none/context/all/partial)
 */
class ResolvedAddress {
    path;
    segments;
    paths;
    wildcardCount;
    wildcardType;
    wildcardIndexes;
    pathInfo;
    /**
     * Constructs resolved path information from a property path string.
     *
     * Parses the path to identify wildcards (*) and numeric indexes,
     * classifies the wildcard type, and generates structured path information.
     *
     * @param name - Property path string (e.g., "items.*.name" or "data.0.value")
     */
    constructor(path) {
        // Split path into individual segments
        const segments = path.split(".");
        const tmpPatternSegments = segments.slice();
        const paths = [];
        let incompleteCount = 0; // Count of unresolved wildcards (*)
        let completeCount = 0; // Count of resolved wildcards (numeric indexes)
        let lastPath = "";
        let wildcardCount = 0;
        let wildcardType = "none";
        const wildcardIndexes = [];
        // Process each segment to identify wildcards and indexes
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            if (segment === "*") {
                // Unresolved wildcard
                tmpPatternSegments[i] = "*";
                wildcardIndexes.push(null);
                incompleteCount++;
                wildcardCount++;
            }
            else {
                const number = Number(segment);
                if (!Number.isNaN(number)) {
                    // Numeric index - treat as resolved wildcard
                    tmpPatternSegments[i] = "*";
                    wildcardIndexes.push(number);
                    completeCount++;
                    wildcardCount++;
                }
            }
            // Build cumulative path array
            lastPath += segment;
            paths.push(lastPath);
            lastPath += (i < segment.length - 1 ? "." : "");
        }
        // Generate pattern string with wildcards normalized
        const structuredPath = tmpPatternSegments.join(".");
        const pathInfo = getPathInfo(structuredPath);
        // Classify wildcard type based on resolved vs unresolved counts
        if (incompleteCount > 0 || completeCount > 0) {
            if (incompleteCount === wildcardCount) {
                // All wildcards are unresolved - need context to resolve
                wildcardType = "context";
            }
            else if (completeCount === wildcardCount) {
                // All wildcards are resolved with numeric indexes
                wildcardType = "all";
            }
            else {
                // Mix of resolved and unresolved wildcards
                wildcardType = "partial";
            }
        }
        this.path = path;
        this.segments = segments;
        this.paths = paths;
        this.wildcardCount = wildcardCount;
        this.wildcardType = wildcardType;
        this.wildcardIndexes = wildcardIndexes;
        this.pathInfo = pathInfo;
    }
}
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
export function getResolvedAddress(name) {
    let nameInfo;
    // Return cached value or create, cache, and return new instance
    return _cache.get(name) ?? (_cache.set(name, nameInfo = new ResolvedAddress(name)), nameInfo);
}
//# sourceMappingURL=ResolvedAddress.js.map