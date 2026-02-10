const config = {
    bindAttributeName: 'data-bind-state',
    commentTextPrefix: 'wcs-text',
    commentForPrefix: 'wcs-for',
    commentIfPrefix: 'wcs-if',
    commentElseIfPrefix: 'wcs-elseif',
    commentElsePrefix: 'wcs-else',
    tagNames: {
        state: 'wcs-state',
    },
    locale: 'en',
    debug: true,
    enableMustache: true,
};

async function loadFromInnerScript(script, name) {
    let scriptModule = null;
    const uniq_comment = `\n//# sourceURL=${name}\n`;
    if (typeof URL.createObjectURL === 'function') {
        // Create a blob URL for the script and dynamically import it
        const blob = new Blob([script.text + uniq_comment], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        try {
            scriptModule = await import(url);
        }
        finally {
            // Clean up blob URL to prevent memory leak
            URL.revokeObjectURL(url);
        }
    }
    else {
        // Fallback: Base64 encoding method (for test environment)
        // Convert script to Base64 and import via data: URL
        const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(script.text + uniq_comment)));
        scriptModule = await import(`data:application/javascript;base64,${b64}`);
    }
    return (scriptModule && typeof scriptModule.default === 'object') ? scriptModule.default : {};
}

function raiseError(message) {
    throw new Error(`[@wcstack/state] ${message}`);
}

async function loadFromJsonFile(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            raiseError(`Failed to fetch JSON file: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    }
    catch (e) {
        console.error('Failed to load JSON file:', e);
        return {};
    }
}

async function loadFromScriptFile(url) {
    try {
        const module = await import(/* @vite-ignore */ url);
        return module.default || {};
    }
    catch (e) {
        raiseError(`Failed to load script file: ${e}`);
    }
}

function loadFromScriptJson(id) {
    const script = document.getElementById(id);
    if (script && script.type === 'application/json') {
        try {
            const data = JSON.parse(script.textContent || '{}');
            return data;
        }
        catch (e) {
            raiseError('Failed to parse JSON from script element:' + e);
        }
    }
    return {};
}

const stateElementByNameByNode = new WeakMap();
function getStateElementByName(rootNode, name) {
    let stateElementByName = stateElementByNameByNode.get(rootNode);
    if (!stateElementByName) {
        return null;
    }
    return stateElementByName.get(name) || null;
}
function setStateElementByName(rootNode, name, element) {
    let stateElementByName = stateElementByNameByNode.get(rootNode);
    if (!stateElementByName) {
        stateElementByName = new Map();
        stateElementByNameByNode.set(rootNode, stateElementByName);
    }
    if (element === null) {
        stateElementByName.delete(name);
        {
            console.debug(`State element unregistered: name="${name}"`);
        }
    }
    else {
        if (stateElementByName.has(name)) {
            raiseError(`State element with name "${name}" is already registered.`);
        }
        stateElementByName.set(name, element);
        {
            console.debug(`State element registered: name="${name}"`, element);
        }
    }
}

const DELIMITER = '.';
const WILDCARD = '*';
const MAX_WILDCARD_DEPTH = 128;
const MAX_LOOP_DEPTH = 128;
/**
 * stackIndexByIndexName
 * インデックス名からスタックインデックスへのマッピング
 * $1 => 0
 * $2 => 1
 * :
 * ${i + 1} => i
 * i < MAX_WILDCARD_DEPTH
 */
const tmpIndexByIndexName = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
    tmpIndexByIndexName[`$${i + 1}`] = i;
}
const INDEX_BY_INDEX_NAME = Object.freeze(tmpIndexByIndexName);
const NO_SET_TIMEOUT = 60 * 1000; // 1分

class LoopContextStack {
    _loopContextStack = Array(MAX_LOOP_DEPTH).fill(undefined);
    _length = 0;
    createLoopContext(elementStateAddress, callback) {
        if (elementStateAddress.listIndex === null) {
            raiseError(`Cannot create loop context for a state address that does not have a list index.`);
        }
        const loopContext = elementStateAddress;
        if (this._length >= MAX_LOOP_DEPTH) {
            raiseError(`Exceeded maximum loop context stack depth of ${MAX_LOOP_DEPTH}. Possible infinite loop.`);
        }
        const lastLoopContext = this._loopContextStack[this._length - 1];
        if (typeof lastLoopContext !== "undefined") {
            if (lastLoopContext.pathInfo.wildcardCount + 1 !== loopContext.pathInfo.wildcardCount) {
                raiseError(`Cannot push loop context for a list whose wildcard count is not exactly one more than the current active loop context.`);
            }
            // 
            const prevWildcardPathInfo = loopContext.pathInfo.wildcardPathInfos[loopContext.pathInfo.wildcardPathInfos.length - 2];
            if (lastLoopContext.pathInfo !== prevWildcardPathInfo) {
                raiseError(`Cannot push loop context for a list whose parent wildcard path info does not match the current active loop context.`);
            }
        }
        else {
            if (loopContext.pathInfo.wildcardCount !== 1) {
                raiseError(`Cannot push loop context for a list with wildcard positions when there is no active loop context.`);
            }
        }
        this._loopContextStack[this._length] = loopContext;
        this._length++;
        let retValue = void 0;
        try {
            retValue = callback(loopContext);
        }
        finally {
            if (retValue instanceof Promise) {
                retValue.finally(() => {
                    this._length--;
                    this._loopContextStack[this._length] = undefined;
                });
            }
            else {
                this._length--;
                this._loopContextStack[this._length] = undefined;
            }
        }
        return retValue;
    }
}
function createLoopContextStack() {
    return new LoopContextStack();
}

const _cache$4 = {};
let id = 0;
function getPathInfo(path) {
    if (_cache$4[path]) {
        return _cache$4[path];
    }
    const pathInfo = Object.freeze(new PathInfo(path));
    _cache$4[path] = pathInfo;
    return pathInfo;
}
class PathInfo {
    id = ++id;
    path;
    segments;
    lastSegment;
    cumulativePaths;
    cumulativePathSet;
    cumulativePathInfos;
    cumulativePathInfoSet;
    parentPath;
    wildcardPaths;
    wildcardPathSet;
    indexByWildcardPath;
    wildcardPathInfos;
    wildcardPathInfoSet;
    wildcardParentPaths;
    wildcardParentPathSet;
    wildcardParentPathInfos;
    wildcardParentPathInfoSet;
    wildcardPositions;
    lastWildcardPath;
    lastWildcardInfo;
    wildcardCount;
    parentPathInfo;
    constructor(path) {
        // Helper to get or create StructuredPathInfo instances, avoiding redundant creation for self-reference
        const getPattern = (_path) => {
            return (path === _path) ? this : getPathInfo(_path);
        };
        // Split the pattern into individual path segments (e.g., "items.*.name" → ["items", "*", "name"])
        const segments = path.split(".");
        // Arrays to track all cumulative paths from root to each segment
        const cumulativePaths = [];
        const cumulativePathInfos = [];
        // Arrays to track wildcard-specific information
        const wildcardPaths = [];
        const indexByWildcardPath = {}; // Maps wildcard path to its index position
        const wildcardPathInfos = [];
        const wildcardParentPaths = []; // Paths of parent segments for each wildcard
        const wildcardParentPathInfos = [];
        const wildcardPositions = [];
        let currentPatternPath = "", prevPatternPath = "";
        let wildcardCount = 0;
        // Iterate through each segment to build cumulative paths and identify wildcards
        for (let i = 0; i < segments.length; i++) {
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

/**
 * Cache for resolved path information.
 * Uses Map to safely handle property names including reserved words like "constructor" and "toString".
 */
const _cache$3 = new Map();
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
function getResolvedAddress(name) {
    let nameInfo;
    // Return cached value or create, cache, and return new instance
    return _cache$3.get(name) ?? (_cache$3.set(name, nameInfo = new ResolvedAddress(name)), nameInfo);
}

const _cache$2 = new WeakMap();
const _cacheNullListIndex$1 = new WeakMap();
class StateAddress {
    pathInfo;
    listIndex;
    _parentAddress;
    constructor(pathInfo, listIndex) {
        this.pathInfo = pathInfo;
        this.listIndex = listIndex;
    }
    get parentAddress() {
        if (typeof this._parentAddress !== 'undefined') {
            return this._parentAddress;
        }
        const parentPathInfo = this.pathInfo.parentPathInfo;
        if (parentPathInfo === null) {
            return null;
        }
        const lastSegment = this.pathInfo.segments[this.pathInfo.segments.length - 1];
        let parentListIndex = null;
        if (lastSegment === WILDCARD) {
            parentListIndex = this.listIndex?.parentListIndex ?? null;
        }
        else {
            parentListIndex = this.listIndex;
        }
        return this._parentAddress = createStateAddress(parentPathInfo, parentListIndex);
    }
}
function createStateAddress(pathInfo, listIndex) {
    if (listIndex === null) {
        let cached = _cacheNullListIndex$1.get(pathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new StateAddress(pathInfo, null);
        _cacheNullListIndex$1.set(pathInfo, cached);
        return cached;
    }
    else {
        let cacheByPathInfo = _cache$2.get(listIndex);
        if (typeof cacheByPathInfo === "undefined") {
            cacheByPathInfo = new WeakMap();
            _cache$2.set(listIndex, cacheByPathInfo);
        }
        let cached = cacheByPathInfo.get(pathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new StateAddress(pathInfo, listIndex);
        cacheByPathInfo.set(pathInfo, cached);
        return cached;
    }
}

if (!Set.prototype.difference) {
    Set.prototype.difference = function (other) {
        const result = new Set(this);
        for (const elem of other) {
            result.delete(elem);
        }
        return result;
    };
}
if (!Set.prototype.intersection) {
    Set.prototype.intersection = function (other) {
        const result = new Set();
        for (const elem of other) {
            if (this.has(elem)) {
                result.add(elem);
            }
        }
        return result;
    };
}

let count = 0;
function getUUID() {
    return `u${(count++).toString(36)}`;
}

let version = 0;
class ListIndex {
    uuid = getUUID();
    parentListIndex;
    position;
    length;
    _index;
    _version;
    _indexes;
    _listIndexes;
    /**
     * Creates a new ListIndex instance.
     *
     * @param parentListIndex - Parent list index for nested loops, or null for top-level
     * @param index - Current index value in the loop
     */
    constructor(parentListIndex, index) {
        this.parentListIndex = parentListIndex;
        this.position = parentListIndex ? parentListIndex.position + 1 : 0;
        this.length = this.position + 1;
        this._index = index;
        this._version = version;
    }
    /**
     * Gets current index value.
     *
     * @returns Current index number
     */
    get index() {
        return this._index;
    }
    /**
     * Sets index value and updates version.
     *
     * @param value - New index value
     */
    set index(value) {
        this._index = value;
        this._version = ++version;
        this.indexes[this.position] = value;
    }
    /**
     * Gets current version number for change detection.
     *
     * @returns Version number
     */
    get version() {
        return this._version;
    }
    /**
     * Checks if parent indexes have changed since last access.
     *
     * @returns true if parent has newer version, false otherwise
     */
    get dirty() {
        if (this.parentListIndex === null) {
            return false;
        }
        else {
            return this.parentListIndex.dirty || this.parentListIndex.version > this._version;
        }
    }
    /**
     * Gets array of all index values from root to current level.
     * Rebuilds array if parent indexes have changed (dirty).
     *
     * @returns Array of index values
     */
    get indexes() {
        if (this.parentListIndex === null) {
            if (typeof this._indexes === "undefined") {
                this._indexes = [this._index];
            }
        }
        else {
            if (typeof this._indexes === "undefined" || this.dirty) {
                this._indexes = [...this.parentListIndex.indexes, this._index];
                this._version = version;
            }
        }
        return this._indexes;
    }
    /**
     * Gets array of WeakRef to all ListIndex instances from root to current level.
     *
     * @returns Array of WeakRef<IListIndex>
     */
    get listIndexes() {
        if (this.parentListIndex === null) {
            if (typeof this._listIndexes === "undefined") {
                this._listIndexes = [new WeakRef(this)];
            }
        }
        else {
            if (typeof this._listIndexes === "undefined") {
                this._listIndexes = [...this.parentListIndex.listIndexes, new WeakRef(this)];
            }
        }
        return this._listIndexes;
    }
    /**
     * Gets variable name for this loop index ($1, $2, etc.).
     *
     * @returns Variable name string
     */
    get varName() {
        return `$${this.position + 1}`;
    }
    /**
     * Gets ListIndex at specified position in hierarchy.
     * Supports negative indexing from end.
     *
     * @param pos - Position index (0-based, negative for from end)
     * @returns ListIndex at position or null if not found/garbage collected
     */
    at(pos) {
        if (pos >= 0) {
            return this.listIndexes[pos]?.deref() || null;
        }
        else {
            return this.listIndexes[this.listIndexes.length + pos]?.deref() || null;
        }
    }
}
/**
 * Factory function to create ListIndex instance.
 *
 * @param parentListIndex - Parent list index for nested loops, or null for top-level
 * @param index - Current index value in the loop
 * @returns New IListIndex instance
 */
function createListIndex(parentListIndex, index) {
    return new ListIndex(parentListIndex, index);
}

const listIndexesByList = new WeakMap();
function getListIndexesByList(list) {
    return listIndexesByList.get(list) || null;
}
function setListIndexesByList(list, listIndexes) {
    if (listIndexes === null) {
        listIndexesByList.delete(list);
        return;
    }
    listIndexesByList.set(list, listIndexes);
}

const listDiffByOldListByNewList = new WeakMap();
const EMPTY_LIST = Object.freeze([]);
const EMPTY_SET = new Set();
function getListDiff(rawOldList, rawNewList) {
    const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
    const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
    let diffByNewList = listDiffByOldListByNewList.get(oldList);
    if (!diffByNewList) {
        return null;
    }
    return diffByNewList.get(newList) || null;
}
function setListDiff(oldList, newList, diff) {
    let diffByNewList = listDiffByOldListByNewList.get(oldList);
    if (!diffByNewList) {
        diffByNewList = new WeakMap();
        listDiffByOldListByNewList.set(oldList, diffByNewList);
    }
    diffByNewList.set(newList, diff);
}
/**
 * Checks if two lists are identical by comparing length and each element.
 * @param oldList - Previous list to compare
 * @param newList - New list to compare
 * @returns True if lists are identical, false otherwise
 */
function isSameList(oldList, newList) {
    if (oldList.length !== newList.length) {
        return false;
    }
    for (let i = 0; i < oldList.length; i++) {
        if (oldList[i] !== newList[i]) {
            return false;
        }
    }
    return true;
}
/**
 * Creates or updates list indexes by comparing old and new lists.
 * Optimizes by reusing existing list indexes when values match.
 * @param parentListIndex - Parent list index for nested lists, or null for top-level
 * @param oldList - Previous list (will be normalized to array)
 * @param newList - New list (will be normalized to array)
 * @param oldIndexes - Array of existing list indexes to potentially reuse
 * @returns Array of list indexes for the new list
 */
function createListDiff(parentListIndex, rawOldList, rawNewList) {
    // Normalize inputs to arrays (handles null/undefined)
    const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
    const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
    const cachedDiff = getListDiff(oldList, newList);
    if (cachedDiff) {
        return cachedDiff;
    }
    const oldIndexes = getListIndexesByList(oldList) || [];
    let retValue;
    try {
        // Early return for empty list
        if (newList.length === 0) {
            return retValue = {
                oldIndexes: oldIndexes,
                newIndexes: [],
                changeIndexSet: EMPTY_SET,
                deleteIndexSet: new Set(oldIndexes),
                addIndexSet: EMPTY_SET,
            };
        }
        // If old list was empty, create all new indexes
        const newIndexes = [];
        if (oldList.length === 0) {
            for (let i = 0; i < newList.length; i++) {
                const newListIndex = createListIndex(parentListIndex, i);
                newIndexes.push(newListIndex);
            }
            return retValue = {
                oldIndexes: oldIndexes,
                newIndexes: newIndexes,
                changeIndexSet: EMPTY_SET,
                deleteIndexSet: EMPTY_SET,
                addIndexSet: new Set(newIndexes),
            };
        }
        // If lists are identical, return existing indexes unchanged (optimization)
        if (isSameList(oldList, newList)) {
            return retValue = {
                oldIndexes: oldIndexes,
                newIndexes: oldIndexes,
                changeIndexSet: EMPTY_SET,
                deleteIndexSet: EMPTY_SET,
                addIndexSet: EMPTY_SET,
            };
        }
        // Use index-based map for efficiency
        // Supports duplicate values by storing array of indexes
        const indexByValue = new Map();
        for (let i = 0; i < oldList.length; i++) {
            const val = oldList[i];
            let indexes = indexByValue.get(val);
            if (!indexes) {
                indexes = [];
                indexByValue.set(val, indexes);
            }
            indexes.push(i);
        }
        // Build new indexes array by matching values with old list
        const changeIndexSet = new Set();
        const addIndexSet = new Set();
        for (let i = 0; i < newList.length; i++) {
            const newValue = newList[i];
            const existingIndexes = indexByValue.get(newValue);
            const oldIndex = existingIndexes && existingIndexes.length > 0 ? existingIndexes.shift() : undefined;
            if (typeof oldIndex === "undefined") {
                // New element
                const newListIndex = createListIndex(parentListIndex, i);
                newIndexes.push(newListIndex);
                addIndexSet.add(newListIndex);
            }
            else {
                // Reuse existing element
                const existingListIndex = oldIndexes[oldIndex];
                // Update index if position changed
                if (existingListIndex.index !== i) {
                    existingListIndex.index = i;
                    changeIndexSet.add(existingListIndex);
                }
                newIndexes.push(existingListIndex);
            }
        }
        const deleteIndexSet = (new Set(oldIndexes)).difference(new Set(newIndexes));
        return retValue = {
            oldIndexes: oldIndexes,
            newIndexes: newIndexes,
            changeIndexSet: changeIndexSet,
            deleteIndexSet: deleteIndexSet,
            addIndexSet: addIndexSet,
        };
    }
    finally {
        if (typeof retValue !== "undefined") {
            setListDiff(oldList, newList, retValue);
            setListIndexesByList(newList, retValue.newIndexes);
        }
    }
}

const _cache$1 = {};
function makeKey(stateName, path) {
    return `${path}@${stateName}`;
}
function getAbsolutePathInfo(stateName, pathInfo) {
    const key = makeKey(stateName, pathInfo.path);
    if (_cache$1[key]) {
        return _cache$1[key];
    }
    const absolutePathInfo = Object.freeze(new AbsolutePathInfo(stateName, pathInfo));
    _cache$1[key] = absolutePathInfo;
    return absolutePathInfo;
}
class AbsolutePathInfo {
    pathInfo;
    stateName;
    parentAbsolutePathInfo;
    constructor(stateName, pathInfo) {
        this.pathInfo = pathInfo;
        this.stateName = stateName;
        if (pathInfo.parentPathInfo === null) {
            this.parentAbsolutePathInfo = null;
        }
        else {
            this.parentAbsolutePathInfo = getAbsolutePathInfo(stateName, pathInfo.parentPathInfo);
        }
    }
}

const _cache = new WeakMap();
const _cacheNullListIndex = new WeakMap();
class AbsoluteStateAddress {
    absolutePathInfo;
    listIndex;
    _parentAbsoluteAddress;
    constructor(absolutePathInfo, listIndex) {
        this.absolutePathInfo = absolutePathInfo;
        this.listIndex = listIndex;
    }
    get parentAbsoluteAddress() {
        if (typeof this._parentAbsoluteAddress !== 'undefined') {
            return this._parentAbsoluteAddress;
        }
        const parentAbsolutePathInfo = this.absolutePathInfo.parentAbsolutePathInfo;
        if (parentAbsolutePathInfo === null) {
            return null;
        }
        const lastSegment = this.absolutePathInfo.pathInfo.segments[this.absolutePathInfo.pathInfo.segments.length - 1];
        let parentListIndex = null;
        if (lastSegment === WILDCARD) {
            parentListIndex = this.listIndex?.parentListIndex ?? null;
        }
        else {
            parentListIndex = this.listIndex;
        }
        return this._parentAbsoluteAddress = createAbsoluteStateAddress(parentAbsolutePathInfo, parentListIndex);
    }
}
function createAbsoluteStateAddress(absolutePathInfo, listIndex) {
    if (listIndex === null) {
        let cached = _cacheNullListIndex.get(absolutePathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new AbsoluteStateAddress(absolutePathInfo, null);
        _cacheNullListIndex.set(absolutePathInfo, cached);
        return cached;
    }
    else {
        let cacheByAbsolutePathInfo = _cache.get(listIndex);
        if (typeof cacheByAbsolutePathInfo === "undefined") {
            cacheByAbsolutePathInfo = new WeakMap();
            _cache.set(listIndex, cacheByAbsolutePathInfo);
        }
        let cached = cacheByAbsolutePathInfo.get(absolutePathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new AbsoluteStateAddress(absolutePathInfo, listIndex);
        cacheByAbsolutePathInfo.set(absolutePathInfo, cached);
        return cached;
    }
}

const cacheEntryByAbsoluteStateAddress = new WeakMap();
function getCacheEntryByAbsoluteStateAddress(address) {
    return cacheEntryByAbsoluteStateAddress.get(address) ?? null;
}
function setCacheEntryByAbsoluteStateAddress(address, cacheEntry) {
    if (cacheEntry === null) {
        cacheEntryByAbsoluteStateAddress.delete(address);
    }
    else {
        cacheEntryByAbsoluteStateAddress.set(address, cacheEntry);
    }
}

function checkDependency(handler, address) {
    // 動的依存関係の登録
    if (handler.addressStackLength > 0) {
        const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
        const stateElement = handler.stateElement;
        if (lastInfo !== null) {
            if (stateElement.getterPaths.has(lastInfo.path) &&
                lastInfo.path !== address.pathInfo.path) {
                // lastInfo.pathはgetterの名前であり、address.pathInfo.pathは
                // そのgetterが参照している値のパスである
                stateElement.addDynamicDependency(address.pathInfo.path, lastInfo.path);
            }
        }
    }
}

/**
 * getByAddress.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（checkDependencyで登録）
 * - キャッシュ機構（リストもキャッシュ対象）
 * - getter経由で値取得時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathAddressやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - checkDependencyで依存追跡を実行
 * - キャッシュ有効時はstateAddressで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */
function _getByAddress(target, address, receiver, handler, stateElement) {
    if (address.pathInfo.path in target) {
        // getterの中で参照の可能性があるので、addressをプッシュする
        if (stateElement.getterPaths.has(address.pathInfo.path)) {
            handler.pushAddress(address);
            try {
                return Reflect.get(target, address.pathInfo.path, receiver);
            }
            finally {
                handler.popAddress();
            }
        }
        else {
            return Reflect.get(target, address.pathInfo.path);
        }
    }
    else {
        const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
        const parentValue = getByAddress(target, parentAddress, receiver, handler);
        const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
        if (lastSegment === WILDCARD) {
            const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
            return Reflect.get(parentValue, index);
        }
        else {
            return Reflect.get(parentValue, lastSegment);
        }
    }
}
function _getByAddressWithCache(target, address, receiver, handler, stateElement) {
    const absPathInfo = getAbsolutePathInfo(stateElement.name, address.pathInfo);
    const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
    const cacheEntry = getCacheEntryByAbsoluteStateAddress(absAddress);
    if (cacheEntry !== null) {
        return cacheEntry.value;
    }
    const value = _getByAddress(target, address, receiver, handler, stateElement);
    setCacheEntryByAbsoluteStateAddress(absAddress, {
        value: value
    });
    return value;
}
function getByAddress(target, address, receiver, handler) {
    checkDependency(handler, address);
    const stateElement = handler.stateElement;
    const cacheable = address.pathInfo.wildcardCount > 0 ||
        stateElement.getterPaths.has(address.pathInfo.path);
    if (cacheable) {
        return _getByAddressWithCache(target, address, receiver, handler, stateElement);
    }
    else {
        return _getByAddress(target, address, receiver, handler, stateElement);
    }
}

/**
 * getContextListIndex.ts
 *
 * Stateの内部APIとして、現在のプロパティ参照スコープにおける
 * 指定したstructuredPath（ワイルドカード付きプロパティパス）に対応する
 * リストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - handlerの最後にアクセスされたAddressから、指定パスに対応するリストインデックスを取得
 * - ワイルドカード階層に対応し、多重ループやネストした配列バインディングにも利用可能
 *
 * 設計ポイント:
 * - 直近のプロパティ参照情報を取得
 * - info.indexByWildcardPathからstructuredPathのインデックスを特定
 * - listIndex.at(index)で該当階層のリストインデックスを取得
 * - パスが一致しない場合や参照が存在しない場合はnullを返す
 */
function getContextListIndex(handler, structuredPath) {
    if (handler.addressStackLength === 0) {
        return null;
    }
    const address = handler.lastAddressStack;
    if (address === null) {
        return null;
    }
    const index = address.pathInfo.indexByWildcardPath[structuredPath];
    if (typeof index === "undefined") {
        return null;
    }
    return address.listIndex?.at(index) ?? null;
}

function applyChangeToAttribute(binding, _context, newValue) {
    const element = binding.node;
    const attrName = binding.propSegments[1];
    if (element.getAttribute(attrName) !== newValue) {
        element.setAttribute(attrName, newValue);
    }
}

function applyChangeToClass(binding, _context, newValue) {
    const element = binding.node;
    const className = binding.propSegments[1];
    if (typeof newValue !== 'boolean') {
        raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
    }
    element.classList.toggle(className, newValue);
}

const indexBindingsByContent = new WeakMap();
function getIndexBindingsByContent(content) {
    return indexBindingsByContent.get(content) ?? [];
}
function setIndexBindingsByContent(content, bindings) {
    indexBindingsByContent.set(content, bindings);
}

const cacheCalcWildcardLen = new WeakMap();
function calcWildcardLen(pathInfo, targetPathInfo) {
    let path1;
    let path2;
    if (pathInfo.wildcardCount === 0 || targetPathInfo.wildcardCount === 0) {
        return 0;
    }
    if (pathInfo.wildcardCount === 1
        && targetPathInfo.wildcardCount > 0
        && targetPathInfo.wildcardPathSet.has(pathInfo.path)) {
        return 1;
    }
    if (pathInfo.id < targetPathInfo.id) {
        path1 = pathInfo;
        path2 = targetPathInfo;
    }
    else {
        path1 = targetPathInfo;
        path2 = pathInfo;
    }
    let cacheByPath2 = cacheCalcWildcardLen.get(path1);
    if (typeof cacheByPath2 === "undefined") {
        cacheByPath2 = new WeakMap();
        cacheCalcWildcardLen.set(path1, cacheByPath2);
    }
    else {
        const cached = cacheByPath2.get(path2);
        if (typeof cached !== "undefined") {
            return cached;
        }
    }
    const matchPath = path1.wildcardPathSet.intersection(path2.wildcardPathSet);
    const retValue = matchPath.size;
    cacheByPath2.set(path2, retValue);
    return retValue;
}

const loopContextByNode = new WeakMap();
function getLoopContextByNode(node) {
    let paramNode = node;
    while (paramNode) {
        const loopContext = loopContextByNode.get(paramNode);
        if (loopContext) {
            return loopContext;
        }
        paramNode = paramNode.parentNode;
    }
    return null;
}
function setLoopContextByNode(node, loopContext) {
    if (loopContext === null) {
        loopContextByNode.delete(node);
        return;
    }
    loopContextByNode.set(node, loopContext);
}

const listIndexByBindingInfoByLoopContext = new WeakMap();
function getListIndexByBindingInfo(bindingInfo) {
    const loopContext = getLoopContextByNode(bindingInfo.node);
    if (loopContext === null) {
        return null;
    }
    let listIndexByBindingInfo = listIndexByBindingInfoByLoopContext.get(loopContext);
    if (typeof listIndexByBindingInfo === "undefined") {
        listIndexByBindingInfo = new WeakMap();
        listIndexByBindingInfoByLoopContext.set(loopContext, listIndexByBindingInfo);
    }
    else {
        const listIndex = listIndexByBindingInfo.get(bindingInfo);
        if (typeof listIndex !== "undefined") {
            return listIndex;
        }
    }
    let listIndex = null;
    try {
        const wildcardLen = calcWildcardLen(loopContext.pathInfo, bindingInfo.statePathInfo);
        if (wildcardLen > 0) {
            listIndex = loopContext.listIndex.at(wildcardLen - 1);
        }
        return listIndex;
    }
    finally {
        listIndexByBindingInfo.set(bindingInfo, listIndex);
    }
}

const absoluteStateAddressByBindingInfo = new WeakMap();
function getAbsoluteStateAddressByBindingInfo(bindingInfo) {
    let absoluteStateAddress = null;
    absoluteStateAddress = absoluteStateAddressByBindingInfo.get(bindingInfo) || null;
    if (absoluteStateAddress !== null) {
        return absoluteStateAddress;
    }
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    absoluteStateAddress =
        createAbsoluteStateAddress(bindingInfo.stateAbsolutePathInfo, listIndex);
    absoluteStateAddressByBindingInfo.set(bindingInfo, absoluteStateAddress);
    return absoluteStateAddress;
}
function clearAbsoluteStateAddressByBindingInfo(bindingInfo) {
    absoluteStateAddressByBindingInfo.delete(bindingInfo);
}

const bindingInfosByAbsoluteStateAddress = new WeakMap();
function getBindingInfosByAbsoluteStateAddress(absoluteStateAddress) {
    let bindingInfos = null;
    bindingInfos = bindingInfosByAbsoluteStateAddress.get(absoluteStateAddress) || null;
    if (bindingInfos === null) {
        bindingInfos = [];
        bindingInfosByAbsoluteStateAddress.set(absoluteStateAddress, bindingInfos);
    }
    return bindingInfos;
}
function addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, bindingInfo) {
    const bindingInfos = getBindingInfosByAbsoluteStateAddress(absoluteStateAddress);
    bindingInfos.push(bindingInfo);
}
function removeBindingInfoByAbsoluteStateAddress(absoluteStateAddress, bindingInfo) {
    const bindingInfos = getBindingInfosByAbsoluteStateAddress(absoluteStateAddress);
    const index = bindingInfos.indexOf(bindingInfo);
    if (index !== -1) {
        bindingInfos.splice(index, 1);
    }
}

const stateAddressByBindingInfo = new WeakMap();
function getStateAddressByBindingInfo(bindingInfo) {
    let stateAddress = null;
    stateAddress = stateAddressByBindingInfo.get(bindingInfo) || null;
    if (stateAddress !== null) {
        return stateAddress;
    }
    if (bindingInfo.statePathInfo.wildcardCount > 0) {
        const listIndex = getListIndexByBindingInfo(bindingInfo);
        if (listIndex === null) {
            raiseError(`Cannot resolve state address for binding with wildcard statePathName "${bindingInfo.statePathName}" because list index is null.`);
        }
        stateAddress = createStateAddress(bindingInfo.statePathInfo, listIndex);
    }
    else {
        stateAddress = createStateAddress(bindingInfo.statePathInfo, null);
    }
    stateAddressByBindingInfo.set(bindingInfo, stateAddress);
    return stateAddress;
}
// call for change loopContext
function clearStateAddressByBindingInfo(bindingInfo) {
    stateAddressByBindingInfo.delete(bindingInfo);
}

const bindingsByContent = new WeakMap();
function getBindingsByContent(content) {
    return bindingsByContent.get(content) ?? [];
}
function setBindingsByContent(content, bindings) {
    bindingsByContent.set(content, bindings);
}

const nodesByContent = new WeakMap();
function getNodesByContent(content) {
    return nodesByContent.get(content) ?? [];
}
function setNodesByContent(content, nodes) {
    nodesByContent.set(content, nodes);
}

function bindLoopContextToContent(content, loopContext) {
    const nodes = getNodesByContent(content);
    for (const node of nodes) {
        setLoopContextByNode(node, loopContext);
    }
}
function unbindLoopContextToContent(content) {
    const nodes = getNodesByContent(content);
    for (const node of nodes) {
        setLoopContextByNode(node, null);
    }
}

function activateContent(content, loopContext, context) {
    bindLoopContextToContent(content, loopContext);
    const bindings = getBindingsByContent(content);
    for (const binding of bindings) {
        const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
        addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
        applyChange(binding, context);
    }
}
function deactivateContent(content) {
    const bindings = getBindingsByContent(content);
    for (const binding of bindings) {
        const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
        removeBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
        clearAbsoluteStateAddressByBindingInfo(binding);
        clearStateAddressByBindingInfo(binding);
    }
    unbindLoopContextToContent(content);
}

function replaceToReplaceNode(bindingInfo) {
    const node = bindingInfo.node;
    const replaceNode = bindingInfo.replaceNode;
    if (node === replaceNode) {
        return;
    }
    if (node.parentNode === null) {
        // already replaced
        return;
    }
    node.parentNode.replaceChild(replaceNode, node);
}

function resolveNodePath(root, path) {
    let currentNode = root;
    if (path.length === 0)
        return currentNode;
    // path.reduce()だと途中でnullになる可能性があるので、
    for (let i = 0; i < path.length; i++) {
        currentNode = currentNode?.childNodes[path[i]] ?? null;
        if (currentNode === null)
            break;
    }
    return currentNode;
}

function getBindingInfos(node, parseBindingTextResults) {
    const bindingInfos = [];
    for (const parseBindingTextResult of parseBindingTextResults) {
        if (parseBindingTextResult.bindingType !== 'text') {
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                replaceNode: node,
            });
        }
        else {
            const replaceNode = document.createTextNode('');
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                replaceNode: replaceNode,
            });
        }
    }
    return bindingInfos;
}

const bindingsByNode = new WeakMap();
function getBindingsByNode(node) {
    return bindingsByNode.get(node) || null;
}
function setBindingsByNode(node, bindings) {
    bindingsByNode.set(node, bindings);
}

const STRUCTURAL_BINDING_TYPE_SET = new Set([
    "if",
    "elseif",
    "else",
    "for",
]);

/**
 * errorMessages.ts
 *
 * Error message generation utilities used by filter functions.
 *
 * Main responsibilities:
 * - Throws clear error messages when filter options or value type checks fail
 * - Takes function name as argument to specify which filter caused the error
 *
 * Design points:
 * - optionsRequired: Error when required option is not specified
 * - optionMustBeNumber: Error when option value is not a number
 * - valueMustBeNumber: Error when value is not a number
 * - valueMustBeBoolean: Error when value is not boolean
 * - valueMustBeDate: Error when value is not a Date
 */
/**
 * Throws error when filter requires at least one option but none provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function optionsRequired(fnName) {
    raiseError(`filter ${fnName} requires at least one option`);
}
/**
 * Throws error when filter option must be a number but invalid value provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function optionMustBeNumber(fnName) {
    raiseError(`filter ${fnName} requires a number as option`);
}
/**
 * Throws error when filter requires numeric value but non-number provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function valueMustBeNumber(fnName) {
    raiseError(`filter ${fnName} requires a number value`);
}
/**
 * Throws error when filter requires boolean value but non-boolean provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function valueMustBeBoolean(fnName) {
    raiseError(`filter ${fnName} requires a boolean value`);
}
/**
 * Throws error when filter requires Date value but non-Date provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function valueMustBeDate(fnName) {
    raiseError(`filter ${fnName} requires a date value`);
}

/**
 * builtinFilters.ts
 *
 * Implementation file for built-in filter functions available in Structive.
 *
 * Main responsibilities:
 * - Provides filters for conversion, comparison, formatting, and validation of numbers, strings, dates, booleans, etc.
 * - Defines functions with options for each filter name, enabling flexible use during binding
 * - Designed for common use as both input and output filters
 *
 * Design points:
 * - Comprehensive coverage of diverse filters: eq, ne, lt, gt, inc, fix, locale, uc, lc, cap, trim, slice, pad, int, float, round, date, time, ymd, falsy, truthy, defaults, boolean, number, string, null, etc.
 * - Rich type checking and error handling for option values
 * - Centralized management of filter functions with FilterWithOptions type, easy to extend
 * - Dynamic retrieval of filter functions from filter names and options via builtinFilterFn
 */
function validateNumberString(value) {
    if (!value || isNaN(Number(value))) {
        return false;
    }
    return true;
}
/**
 * Equality filter - compares value with option.
 *
 * @param options - Array with comparison value as first element
 * @returns Filter function that returns boolean
 */
const eq = (options) => {
    const opt = options?.[0] ?? optionsRequired('eq');
    return (value) => {
        // Align types for comparison
        if (typeof value === 'number') {
            if (!validateNumberString(opt)) {
                optionMustBeNumber('eq');
            }
            return value === Number(opt);
        }
        if (typeof value === 'string') {
            return value === opt;
        }
        // Strict equality for others
        return value === opt;
    };
};
/**
 * Inequality filter - compares value with option.
 *
 * @param options - Array with comparison value as first element
 * @returns Filter function that returns boolean
 */
const ne = (options) => {
    const opt = options?.[0] ?? optionsRequired('ne');
    return (value) => {
        // Align types for comparison
        if (typeof value === 'number') {
            if (!validateNumberString(opt)) {
                optionMustBeNumber('ne');
            }
            return value !== Number(opt);
        }
        if (typeof value === 'string') {
            return value !== opt;
        }
        // Strict equality for others
        return value !== opt;
    };
};
/**
 * Boolean NOT filter - inverts boolean value.
 *
 * @param options - Unused
 * @returns Filter function that returns inverted boolean
 */
const not = (_options) => {
    return (value) => {
        if (typeof value !== 'boolean') {
            valueMustBeBoolean('not');
        }
        return !value;
    };
};
/**
 * Less than filter - checks if value is less than option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const lt = (options) => {
    const opt = options?.[0] ?? optionsRequired('lt');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('lt');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('lt');
        }
        return value < Number(opt);
    };
};
/**
 * Less than or equal filter - checks if value is less than or equal to option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const le = (options) => {
    const opt = options?.[0] ?? optionsRequired('le');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('le');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('le');
        }
        return value <= Number(opt);
    };
};
/**
 * Greater than filter - checks if value is greater than option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const gt = (options) => {
    const opt = options?.[0] ?? optionsRequired('gt');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('gt');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('gt');
        }
        return value > Number(opt);
    };
};
/**
 * Greater than or equal filter - checks if value is greater than or equal to option.
 *
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const ge = (options) => {
    const opt = options?.[0] ?? optionsRequired('ge');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('ge');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('ge');
        }
        return value >= Number(opt);
    };
};
/**
 * Increment filter - adds option value to input value.
 *
 * @param options - Array with increment number as first element
 * @returns Filter function that returns incremented number
 */
const inc = (options) => {
    const opt = options?.[0] ?? optionsRequired('inc');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('inc');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('inc');
        }
        return value + Number(opt);
    };
};
/**
 * Decrement filter - subtracts option value from input value.
 *
 * @param options - Array with decrement number as first element
 * @returns Filter function that returns decremented number
 */
const dec = (options) => {
    const opt = options?.[0] ?? optionsRequired('dec');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('dec');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('dec');
        }
        return value - Number(opt);
    };
};
/**
 * Multiply filter - multiplies value by option.
 *
 * @param options - Array with multiplier number as first element
 * @returns Filter function that returns multiplied number
 */
const mul = (options) => {
    const opt = options?.[0] ?? optionsRequired('mul');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('mul');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('mul');
        }
        return value * Number(opt);
    };
};
/**
 * Divide filter - divides value by option.
 *
 * @param options - Array with divisor number as first element
 * @returns Filter function that returns divided number
 */
const div = (options) => {
    const opt = options?.[0] ?? optionsRequired('div');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('div');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('div');
        }
        return value / Number(opt);
    };
};
/**
 * Modulo filter - returns remainder of division.
 *
 * @param options - Array with divisor number as first element
 * @returns Filter function that returns remainder
 */
const mod = (options) => {
    const opt = options?.[0] ?? optionsRequired('mod');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('mod');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('mod');
        }
        return value % Number(opt);
    };
};
/**
 * Fixed decimal filter - formats number to fixed decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns formatted string
 */
const fix = (options) => {
    const opt = options?.[0] ?? "0";
    if (!validateNumberString(opt)) {
        optionMustBeNumber('fix');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('fix');
        }
        return value.toFixed(Number(opt));
    };
};
/**
 * Locale number filter - formats number according to locale.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns localized number string
 */
const locale = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('locale');
        }
        return value.toLocaleString(opt);
    };
};
/**
 * Uppercase filter - converts string to uppercase.
 *
 * @param options - Unused
 * @returns Filter function that returns uppercase string
 */
const uc = (_options) => {
    return (value) => {
        return String(value).toUpperCase();
    };
};
/**
 * Lowercase filter - converts string to lowercase.
 *
 * @param options - Unused
 * @returns Filter function that returns lowercase string
 */
const lc = (_options) => {
    return (value) => {
        return String(value).toLowerCase();
    };
};
/**
 * Capitalize filter - capitalizes first character of string.
 *
 * @param options - Unused
 * @returns Filter function that returns capitalized string
 */
const cap = (_options) => {
    return (value) => {
        const v = String(value);
        if (v.length === 0) {
            return v;
        }
        if (v.length === 1) {
            return v.toUpperCase();
        }
        return v.charAt(0).toUpperCase() + v.slice(1);
    };
};
/**
 * Trim filter - removes whitespace from both ends of string.
 *
 * @param options - Unused
 * @returns Filter function that returns trimmed string
 */
const trim = (_options) => {
    return (value) => {
        return String(value).trim();
    };
};
/**
 * Slice filter - extracts portion of string from specified index.
 *
 * @param options - Array with start index as first element
 * @returns Filter function that returns sliced string
 */
const slice = (options) => {
    const opt = options?.[0] ?? optionsRequired('slice');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('slice');
    }
    return (value) => {
        return String(value).slice(Number(opt));
    };
};
/**
 * Substring filter - extracts substring from specified position and length.
 *
 * @param options - Array with start index and length
 * @returns Filter function that returns substring
 */
const substr = (options) => {
    const opt1 = options?.[0] ?? optionsRequired('substr');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('substr');
    }
    const opt2 = options?.[1] ?? optionsRequired('substr');
    if (!validateNumberString(opt2)) {
        optionMustBeNumber('substr');
    }
    return (value) => {
        return String(value).substr(Number(opt1), Number(opt2));
    };
};
/**
 * Pad filter - pads string to specified length from start.
 *
 * @param options - Array with target length and pad string (default: '0')
 * @returns Filter function that returns padded string
 */
const pad = (options) => {
    const opt1 = options?.[0] ?? optionsRequired('pad');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('pad');
    }
    const opt2 = options?.[1] ?? '0';
    return (value) => {
        return String(value).padStart(Number(opt1), opt2);
    };
};
/**
 * Repeat filter - repeats string specified number of times.
 *
 * @param options - Array with repeat count as first element
 * @returns Filter function that returns repeated string
 */
const rep = (options) => {
    const opt = options?.[0] ?? optionsRequired('rep');
    if (!validateNumberString(opt)) {
        optionMustBeNumber('rep');
    }
    return (value) => {
        return String(value).repeat(Number(opt));
    };
};
/**
 * Reverse filter - reverses character order in string.
 *
 * @param options - Unused
 * @returns Filter function that returns reversed string
 */
const rev = (_options) => {
    return (value) => {
        return String(value).split('').reverse().join('');
    };
};
/**
 * Integer filter - parses value to integer.
 *
 * @param options - Unused
 * @returns Filter function that returns integer
 */
const int = (_options) => {
    return (value) => {
        return parseInt(String(value), 10);
    };
};
/**
 * Float filter - parses value to floating point number.
 *
 * @param options - Unused
 * @returns Filter function that returns float
 */
const float = (_options) => {
    return (value) => {
        return parseFloat(String(value));
    };
};
/**
 * Round filter - rounds number to specified decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns rounded number
 */
const round = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('round');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('round');
        }
        const optValue = Math.pow(10, Number(opt));
        return Math.round(value * optValue) / optValue;
    };
};
/**
 * Floor filter - rounds number down to specified decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns floored number
 */
const floor = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('floor');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('floor');
        }
        const optValue = Math.pow(10, Number(opt));
        return Math.floor(value * optValue) / optValue;
    };
};
/**
 * Ceiling filter - rounds number up to specified decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns ceiled number
 */
const ceil = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('ceil');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('ceil');
        }
        const optValue = Math.pow(10, Number(opt));
        return Math.ceil(value * optValue) / optValue;
    };
};
/**
 * Percent filter - formats number as percentage string.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns percentage string with '%'
 */
const percent = (options) => {
    const opt = options?.[0] ?? '0';
    if (!validateNumberString(opt)) {
        optionMustBeNumber('percent');
    }
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('percent');
        }
        return `${(value * 100).toFixed(Number(opt))}%`;
    };
};
/**
 * Date filter - formats Date object as localized date string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns date string
 */
const date = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('date');
        }
        return value.toLocaleDateString(opt);
    };
};
/**
 * Time filter - formats Date object as localized time string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns time string
 */
const time = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('time');
        }
        return value.toLocaleTimeString(opt);
    };
};
/**
 * DateTime filter - formats Date object as localized date and time string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns datetime string
 */
const datetime = (options) => {
    const opt = options?.[0] ?? config.locale;
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('datetime');
        }
        return value.toLocaleString(opt);
    };
};
/**
 * Year-Month-Day filter - formats Date object as YYYY-MM-DD string.
 *
 * @param options - Array with separator string as first element (default: '-')
 * @returns Filter function that returns formatted date string
 */
const ymd = (options) => {
    const opt = options?.[0] ?? '-';
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('ymd');
        }
        const year = value.getFullYear().toString();
        const month = (value.getMonth() + 1).toString().padStart(2, '0');
        const day = value.getDate().toString().padStart(2, '0');
        return `${year}${opt}${month}${opt}${day}`;
    };
};
/**
 * Falsy filter - checks if value is falsy.
 *
 * @param options - Unused
 * @returns Filter function that returns true for false/null/undefined/0/''/NaN
 */
const falsy = (_options) => {
    return (value) => value === false || value === null || value === undefined || value === 0 || value === '' || Number.isNaN(value);
};
/**
 * Truthy filter - checks if value is truthy.
 *
 * @param options - Unused
 * @returns Filter function that returns true for non-falsy values
 */
const truthy = (_options) => {
    return (value) => value !== false && value !== null && value !== undefined && value !== 0 && value !== '' && !Number.isNaN(value);
};
/**
 * Default filter - returns default value if input is falsy.
 *
 * @param options - Array with default value as first element
 * @returns Filter function that returns value or default
 */
const defaults = (options) => {
    const opt = options?.[0] ?? optionsRequired('defaults');
    return (value) => {
        if (value === false || value === null || value === undefined || value === 0 || value === '' || Number.isNaN(value)) {
            return opt;
        }
        return value;
    };
};
/**
 * Boolean filter - converts value to boolean.
 *
 * @param options - Unused
 * @returns Filter function that returns boolean
 */
const boolean = (_options) => {
    return (value) => {
        return Boolean(value);
    };
};
/**
 * Number filter - converts value to number.
 *
 * @param options - Unused
 * @returns Filter function that returns number
 */
const number = (_options) => {
    return (value) => {
        return Number(value);
    };
};
/**
 * String filter - converts value to string.
 *
 * @param options - Unused
 * @returns Filter function that returns string
 */
const string = (_options) => {
    return (value) => {
        return String(value);
    };
};
/**
 * Null filter - converts empty string to null.
 *
 * @param options - Unused
 * @returns Filter function that returns null for empty string, otherwise original value
 */
const _null = (_options) => {
    return (value) => {
        return (value === "") ? null : value;
    };
};
const builtinFilters = {
    "eq": eq,
    "ne": ne,
    "not": not,
    "lt": lt,
    "le": le,
    "gt": gt,
    "ge": ge,
    "inc": inc,
    "dec": dec,
    "mul": mul,
    "div": div,
    "mod": mod,
    "fix": fix,
    "locale": locale,
    "uc": uc,
    "lc": lc,
    "cap": cap,
    "trim": trim,
    "slice": slice,
    "substr": substr,
    "pad": pad,
    "rep": rep,
    "rev": rev,
    "int": int,
    "float": float,
    "round": round,
    "floor": floor,
    "ceil": ceil,
    "percent": percent,
    "date": date,
    "time": time,
    "datetime": datetime,
    "ymd": ymd,
    "falsy": falsy,
    "truthy": truthy,
    "defaults": defaults,
    "boolean": boolean,
    "number": number,
    "string": string,
    "null": _null,
};
const outputBuiltinFilters = builtinFilters;
const inputBuiltinFilters = builtinFilters;
const builtinFiltersByFilterIOType = {
    "input": inputBuiltinFilters,
    "output": outputBuiltinFilters,
};
/**
 * Retrieves built-in filter function by name and options.
 *
 * @param name - Filter name
 * @param options - Array of option strings
 * @returns Function that takes FilterWithOptions and returns filter function
 */
const builtinFilterFn = (name, options) => (filters) => {
    const filter = filters[name];
    if (!filter) {
        raiseError(`filter not found: ${name}`);
    }
    return filter(options);
};

function parseFilterArgs(argsText) {
    const args = [];
    let current = '';
    let inQuote = null;
    for (let i = 0; i < argsText.length; i++) {
        const char = argsText[i];
        if (inQuote) {
            if (char === inQuote) {
                inQuote = null;
            }
            else {
                current += char;
            }
        }
        else if (char === '"' || char === "'") {
            inQuote = char;
        }
        else if (char === ',') {
            args.push(current.trim());
            current = '';
        }
        else {
            current += char;
        }
    }
    if (current.trim()) {
        args.push(current.trim());
    }
    return args;
}

const filterFnByKey = new Map();
// format: filterName(arg1,arg2) or filterName
function parseFilters(filterTextList, filterIOType) {
    const builtinFilters = builtinFiltersByFilterIOType[filterIOType];
    const filters = filterTextList.map((filterText) => {
        const openParenIndex = filterText.indexOf('(');
        const closeParenIndex = filterText.lastIndexOf(')');
        // check parentheses
        if (openParenIndex !== -1 && closeParenIndex === -1) {
            raiseError(`Invalid filter format: missing closing parenthesis in "${filterText}"`);
        }
        if (closeParenIndex !== -1 && openParenIndex === -1) {
            raiseError(`Invalid filter format: missing opening parenthesis in "${filterText}"`);
        }
        if (openParenIndex === -1) {
            // no arguments
            const filterName = filterText.trim();
            const filterKey = `${filterName}():${filterIOType}`;
            let filterFn = filterFnByKey.get(filterKey);
            if (typeof filterFn === 'undefined') {
                filterFn = builtinFilterFn(filterName, [])(builtinFilters);
                filterFnByKey.set(filterKey, filterFn);
            }
            return {
                filterName: filterName,
                args: [],
                filterFn: filterFn,
            };
        }
        else {
            const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
            const filterName = filterText.substring(0, openParenIndex).trim();
            const args = parseFilterArgs(argsText);
            const filterKey = `${filterName}(${args.join(',')}):${filterIOType}`;
            let filterFn = filterFnByKey.get(filterKey);
            if (typeof filterFn === 'undefined') {
                filterFn = builtinFilterFn(filterName, args)(builtinFilters);
                filterFnByKey.set(filterKey, filterFn);
            }
            return {
                filterName,
                args,
                filterFn,
            };
        }
    });
    return filters;
}

const trimFn = (s) => s.trim();

const cacheFilterInfos$1 = new Map();
// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners
function parsePropPart(propPart) {
    const pos = propPart.indexOf('|');
    let propText = '';
    let filterTexts = [];
    let filtersText = '';
    let filters = [];
    if (pos !== -1) {
        propText = propPart.slice(0, pos).trim();
        filtersText = propPart.slice(pos + 1).trim();
        if (cacheFilterInfos$1.has(filtersText)) {
            filters = cacheFilterInfos$1.get(filtersText);
        }
        else {
            filterTexts = filtersText.split('|').map(trimFn);
            filters = parseFilters(filterTexts, "input");
            cacheFilterInfos$1.set(filtersText, filters);
        }
    }
    else {
        propText = propPart.trim();
    }
    const [propName, propModifiersText] = propText.split('#').map(trimFn);
    const propSegments = propName.split('.').map(trimFn);
    const propModifiers = propModifiersText
        ? propModifiersText.split(',').map(trimFn)
        : [];
    return {
        propName,
        propSegments,
        propModifiers,
        inFilters: filters,
    };
}

const cacheFilterInfos = new Map();
// format: statePath@stateName|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// stateName: optional, default is 'default'
// filters-format: filterName or filterName(arg1,arg2)
function parseStatePart(statePart) {
    const pos = statePart.indexOf('|');
    let stateAndPath = '';
    let filterTexts = [];
    let filtersText = '';
    let filters = [];
    if (pos !== -1) {
        stateAndPath = statePart.slice(0, pos).trim();
        filtersText = statePart.slice(pos + 1).trim();
        if (cacheFilterInfos.has(filtersText)) {
            filters = cacheFilterInfos.get(filtersText);
        }
        else {
            filterTexts = filtersText.split('|').map(trimFn);
            filters = parseFilters(filterTexts, "output");
            cacheFilterInfos.set(filtersText, filters);
        }
    }
    else {
        stateAndPath = statePart.trim();
    }
    const [statePathName, stateName = 'default'] = stateAndPath.split('@').map(trimFn);
    const pathInfo = getPathInfo(statePathName);
    const absolutePathInfo = getAbsolutePathInfo(stateName, pathInfo);
    return {
        stateName,
        statePathName,
        statePathInfo: pathInfo,
        stateAbsolutePathInfo: absolutePathInfo,
        outFilters: filters,
    };
}

// format: propPart:statePart; propPart:statePart; ...
// special-propPart:
//   if: statePart (single binding for conditional rendering)
//   else: (single binding for conditional rendering, and statePart is ignored)
//   elseif: statePart only (single binding for conditional rendering)
//   for: statePart only (single binding for loop rendering)
//   onclick: statePart, onchange: statePart etc. (event listeners)
function parseBindTextsForElement(bindText) {
    const [...bindTexts] = bindText.split(';').map(trimFn).filter(s => s.length > 0);
    const results = bindTexts.map((bindText) => {
        const separatorIndex = bindText.indexOf(':');
        if (separatorIndex === -1) {
            raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
        }
        const propPart = bindText.slice(0, separatorIndex).trim();
        const statePart = bindText.slice(separatorIndex + 1).trim();
        if (propPart === 'else') {
            const pathInfo = getPathInfo('#else');
            const absolutePathInfo = getAbsolutePathInfo('', pathInfo);
            return {
                propName: 'else',
                propSegments: ['else'],
                propModifiers: [],
                statePathName: '#else',
                statePathInfo: pathInfo,
                stateAbsolutePathInfo: absolutePathInfo,
                stateName: '',
                inFilters: [],
                outFilters: [],
                bindingType: 'else',
            };
        }
        else if (propPart === 'if' || propPart === 'elseif' || propPart === 'for') {
            const stateResult = parseStatePart(statePart);
            return {
                propName: propPart,
                propSegments: [propPart],
                propModifiers: [],
                inFilters: [],
                ...stateResult,
                bindingType: propPart,
            };
        }
        else {
            const stateResult = parseStatePart(statePart);
            const propResult = parsePropPart(propPart);
            if (propResult.propSegments[0].startsWith('on')) {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'event',
                };
            }
            else {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'prop',
                };
            }
        }
    });
    // check for sigle binding for 'if', 'elseif', 'else', 'for'
    if (results.length > 1) {
        const isIncludeSingleBinding = results.some(r => STRUCTURAL_BINDING_TYPE_SET.has(r.bindingType));
        if (isIncludeSingleBinding) {
            raiseError(`Invalid bindText: "${bindText}". 'if', 'elseif', 'else', and 'for' bindings must be single binding.`);
        }
    }
    return results;
}

const bindTextByNode = new WeakMap();
// format: <!--@@wcs-text:path-->
// bind-stateはconfig.commentTextPrefixで変更可能
// format: <!--@@wcs-for:UUID-->
// bind-stateはconfig.commentForPrefixで変更可能
// format: <!--@@wcs-if:UUID-->
// bind-stateはconfig.commentIfPrefixで変更可能
// format: <!--@@wcs-else:UUID-->
// bind-stateはconfig.commentElsePrefixで変更可能
// format: <!--@@wcs-elseif:UUID-->
// bind-stateはconfig.commentElseIfPrefixで変更可能
const bindingTypeKeywordSet = new Set([
    config.commentTextPrefix,
    config.commentForPrefix,
    config.commentIfPrefix,
    config.commentElseIfPrefix,
    config.commentElsePrefix,
]);
// format: <!--@@:path-->は<!--@@wcs-text:path-->と同義にする
const EMBEDDED_REGEX = new RegExp(`^\\s*@@\\s*(.*?)\\s*:\\s*(.+?)\\s*$`);
function parseCommentNode(node) {
    const savedText = bindTextByNode.get(node);
    if (typeof savedText === "string") {
        return savedText;
    }
    if (node.nodeType !== Node.COMMENT_NODE) {
        return null;
    }
    const commentNode = node;
    const text = commentNode.data.trim();
    const match = EMBEDDED_REGEX.exec(text);
    if (match === null) {
        return null;
    }
    // 空の場合は wcs-text として扱う
    const keyword = match[1] || config.commentTextPrefix;
    if (!bindingTypeKeywordSet.has(keyword)) {
        return null;
    }
    bindTextByNode.set(node, match[2]);
    return match[2];
}

function parseBindTextForEmbeddedNode(bindText) {
    const stateResult = parseStatePart(bindText);
    return {
        propName: 'textContent',
        propSegments: ['textContent'],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: 'text',
    };
}

const fragmentInfoByUUID = new Map();
function setFragmentInfoByUUID(uuid, rootNode, fragmentInfo) {
    if (fragmentInfo === null) {
        fragmentInfoByUUID.delete(uuid);
    }
    else {
        fragmentInfoByUUID.set(uuid, fragmentInfo);
        const bindingPartial = fragmentInfo.parseBindTextResult;
        const stateElement = getStateElementByName(rootNode, bindingPartial.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingPartial.stateName}" not found for fragment info.`);
        }
        stateElement.setPathInfo(bindingPartial.statePathName, bindingPartial.bindingType);
        for (const nodeInfo of fragmentInfo.nodeInfos) {
            for (const nodeBindingPartial of nodeInfo.parseBindTextResults) {
                const nodeStateElement = getStateElementByName(rootNode, nodeBindingPartial.stateName);
                if (nodeStateElement === null) {
                    raiseError(`State element with name "${nodeBindingPartial.stateName}" not found for fragment info node.`);
                }
                nodeStateElement.setPathInfo(nodeBindingPartial.statePathName, nodeBindingPartial.bindingType);
            }
        }
    }
}
function getFragmentInfoByUUID(uuid) {
    return fragmentInfoByUUID.get(uuid) || null;
}

function getParseBindTextResults(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        const bindText = element.getAttribute(config.bindAttributeName) || '';
        return parseBindTextsForElement(bindText);
    }
    else if (node.nodeType === Node.COMMENT_NODE) {
        const bindTextOrUUID = parseCommentNode(node);
        if (bindTextOrUUID === null) {
            raiseError(`Comment node binding text not found.`);
        }
        const fragmentInfo = getFragmentInfoByUUID(bindTextOrUUID);
        let parseBindingTextResult = fragmentInfo?.parseBindTextResult ?? null;
        let uuid = null;
        if (parseBindingTextResult === null) {
            // It is not a structural fragment UUID, so treat it as bindText
            parseBindingTextResult = parseBindTextForEmbeddedNode(bindTextOrUUID);
            uuid = null;
        }
        else {
            uuid = bindTextOrUUID;
        }
        return [{
                ...parseBindingTextResult,
                uuid: uuid,
            }];
    }
    return [];
}

/**
 * data-bind-state 属性または埋め込みノード<!--{{}}-->を持つノードをすべて取得する
 * @param root
 * @returns
 */
function getSubscriberNodes(root) {
    const subscriberNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, {
        acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const hasBinding = element.hasAttribute(config.bindAttributeName);
                return hasBinding
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
            else {
                // Comment node
                return parseCommentNode(node) !== null
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        }
    });
    while (walker.nextNode()) {
        subscriberNodes.push(walker.currentNode);
    }
    return subscriberNodes;
}

const bindingPromiseByNode = new WeakMap();
function getInitializeBindingPromiseByNode(node) {
    let bindingPromise = bindingPromiseByNode.get(node) || null;
    if (bindingPromise !== null) {
        return bindingPromise;
    }
    let resolveFn = undefined;
    const promise = new Promise((resolve) => {
        resolveFn = resolve;
    });
    bindingPromise = {
        promise,
        resolve: resolveFn
    };
    bindingPromiseByNode.set(node, bindingPromise);
    return bindingPromise;
}
async function waitInitializeBinding(node) {
    const bindingPromise = getInitializeBindingPromiseByNode(node);
    await bindingPromise.promise;
}
function resolveInitializedBinding(node) {
    const bindingPromise = getInitializeBindingPromiseByNode(node);
    bindingPromise.resolve();
}

const registeredNodeSet = new WeakSet();
function collectNodesAndBindingInfos(root) {
    const subscriberNodes = getSubscriberNodes(root);
    const allBindings = [];
    for (const node of subscriberNodes) {
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            const parseBindingTextResults = getParseBindTextResults(node);
            const bindings = getBindingInfos(node, parseBindingTextResults);
            setBindingsByNode(node, bindings);
            resolveInitializedBinding(node);
            allBindings.push(...bindings);
        }
    }
    return [subscriberNodes, allBindings];
}
function collectNodesAndBindingInfosByFragment(root, nodeInfos) {
    const nodes = [];
    const allBindings = [];
    for (const nodeInfo of nodeInfos) {
        const node = resolveNodePath(root, nodeInfo.nodePath);
        if (node === null) {
            raiseError(`Node not found by path [${nodeInfo.nodePath.join(', ')}] in fragment.`);
        }
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            const bindings = getBindingInfos(node, nodeInfo.parseBindTextResults);
            setBindingsByNode(node, bindings);
            resolveInitializedBinding(node);
            allBindings.push(...bindings);
            nodes.push(node);
        }
    }
    return [nodes, allBindings];
}

const handlerByHandlerKey$1 = new Map();
const bindingInfoSetByHandlerKey$1 = new Map();
function getHandlerKey$1(bindingInfo) {
    const modifierKey = bindingInfo.propModifiers.filter(m => m === 'prevent' || m === 'stop').sort().join(',');
    return `${bindingInfo.stateName}::${bindingInfo.statePathName}::${modifierKey}`;
}
const stateEventHandlerFunction = (stateName, handlerName, modifiers) => (event) => {
    if (modifiers.includes('prevent'))
        event.preventDefault();
    if (modifiers.includes('stop'))
        event.stopPropagation();
    const node = event.target;
    const rootNode = node.getRootNode();
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for event handler.`);
    }
    const loopContext = getLoopContextByNode(node);
    stateElement.createStateAsync("writable", async (state) => {
        state.$$setLoopContext(loopContext, () => {
            const handler = state[handlerName];
            if (typeof handler !== "function") {
                raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
            }
            return Reflect.apply(handler, state, [event, ...(loopContext?.listIndex.indexes ?? [])]);
        });
    });
};
function attachEventHandler(bindingInfo) {
    if (!bindingInfo.propName.startsWith("on")) {
        return false;
    }
    const key = getHandlerKey$1(bindingInfo);
    let stateEventHandler = handlerByHandlerKey$1.get(key);
    if (typeof stateEventHandler === "undefined") {
        stateEventHandler = stateEventHandlerFunction(bindingInfo.stateName, bindingInfo.statePathName, bindingInfo.propModifiers);
        handlerByHandlerKey$1.set(key, stateEventHandler);
    }
    const eventName = bindingInfo.propName.slice(2);
    bindingInfo.node.addEventListener(eventName, stateEventHandler);
    let bindingInfoSet = bindingInfoSetByHandlerKey$1.get(key);
    if (typeof bindingInfoSet === "undefined") {
        bindingInfoSet = new Set([bindingInfo]);
        bindingInfoSetByHandlerKey$1.set(key, bindingInfoSet);
    }
    else {
        bindingInfoSet.add(bindingInfo);
    }
    return true;
}

const CHECK_TYPES = new Set(['radio', 'checkbox']);
const DEFAULT_VALUE_PROP_NAMES = new Set(['value', 'valueAsNumber', 'valueAsDate']);
function isPossibleTwoWay(node, propName) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    const element = node;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input') {
        const inputType = (element.getAttribute('type') || 'text').toLowerCase();
        if (inputType === 'button') {
            return false;
        }
        if (CHECK_TYPES.has(inputType) && propName === 'checked') {
            return true;
        }
        if (DEFAULT_VALUE_PROP_NAMES.has(propName)) {
            return true;
        }
    }
    if (tagName === 'select' && propName === 'value') {
        return true;
    }
    if (tagName === 'textarea' && propName === 'value') {
        return true;
    }
    return false;
}

const handlerByHandlerKey = new Map();
const bindingInfoSetByHandlerKey = new Map();
function getHandlerKey(bindingInfo, eventName) {
    const filterKey = bindingInfo.inFilters.map(f => f.filterName + '(' + f.args.join(',') + ')').join('|');
    return `${bindingInfo.stateName}::${bindingInfo.propName}::${bindingInfo.statePathName}::${eventName}::${filterKey}`;
}
function getEventName(bindingInfo) {
    const tagName = bindingInfo.node.tagName.toLowerCase();
    let eventName = (tagName === 'select') ? 'change' : 'input';
    for (const modifier of bindingInfo.propModifiers) {
        if (modifier.startsWith('on')) {
            eventName = modifier.slice(2);
        }
    }
    return eventName;
}
const twowayEventHandlerFunction = (stateName, propName, statePathName, inFilters) => (event) => {
    const node = event.target;
    if (typeof node === "undefined") {
        console.warn(`[@wcstack/state] event.target is undefined.`);
        return;
    }
    if (!(propName in node)) {
        console.warn(`[@wcstack/state] Property "${propName}" does not exist on target element.`);
        return;
    }
    const newValue = node[propName];
    let filteredNewValue = newValue;
    for (const filter of inFilters) {
        filteredNewValue = filter.filterFn(filteredNewValue);
    }
    const rootNode = node.getRootNode();
    const stateElement = getStateElementByName(rootNode, stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for two-way binding.`);
    }
    const loopContext = getLoopContextByNode(node);
    stateElement.createState("writable", (state) => {
        state.$$setLoopContext(loopContext, () => {
            state[statePathName] = filteredNewValue;
        });
    });
};
function attachTwowayEventHandler(bindingInfo) {
    if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(bindingInfo);
        const key = getHandlerKey(bindingInfo, eventName);
        let twowayEventHandler = handlerByHandlerKey.get(key);
        if (typeof twowayEventHandler === "undefined") {
            twowayEventHandler = twowayEventHandlerFunction(bindingInfo.stateName, bindingInfo.propName, bindingInfo.statePathName, bindingInfo.inFilters);
            handlerByHandlerKey.set(key, twowayEventHandler);
        }
        bindingInfo.node.addEventListener(eventName, twowayEventHandler);
        let bindingInfoSet = bindingInfoSetByHandlerKey.get(key);
        if (typeof bindingInfoSet === "undefined") {
            bindingInfoSet = new Set([bindingInfo]);
            bindingInfoSetByHandlerKey.set(key, bindingInfoSet);
        }
        else {
            bindingInfoSet.add(bindingInfo);
        }
        return true;
    }
    return false;
}

function _initializeBindings(allBindings) {
    for (const binding of allBindings) {
        // replace node
        replaceToReplaceNode(binding);
        // event
        if (attachEventHandler(binding)) {
            continue;
        }
        // two-way binding
        attachTwowayEventHandler(binding);
    }
}
function initializeBindings(root, parentLoopContext) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
    for (const node of subscriberNodes) {
        setLoopContextByNode(node, parentLoopContext);
    }
    _initializeBindings(allBindings);
    // create absolute state address and register binding infos
    for (const binding of allBindings) {
        const absoluteStateAddress = getAbsoluteStateAddressByBindingInfo(binding);
        addBindingInfoByAbsoluteStateAddress(absoluteStateAddress, binding);
        const rootNode = binding.replaceNode.getRootNode();
        const stateElement = getStateElementByName(rootNode, binding.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${binding.stateName}" not found for binding.`);
        }
        if (binding.bindingType !== 'event') {
            stateElement.setPathInfo(binding.statePathName, binding.bindingType);
        }
    }
    // apply all at once
    applyChangeFromBindings(allBindings);
}
function initializeBindingsByFragment(root, nodeInfos) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
    _initializeBindings(allBindings);
    return {
        nodes: subscriberNodes,
        bindingInfos: allBindings,
    };
}

const contentByNode = new WeakMap();
function setContentByNode(node, content) {
    if (content === null) {
        contentByNode.delete(node);
    }
    else {
        contentByNode.set(node, content);
    }
}
function getContentByNode(node) {
    let currentNode = node;
    while (currentNode) {
        const loopContext = contentByNode.get(currentNode);
        if (loopContext) {
            return loopContext;
        }
        currentNode = currentNode.parentNode;
    }
    return null;
}

class Content {
    _content;
    _childNodeArray = [];
    _firstNode = null;
    _lastNode = null;
    _mounted = false;
    constructor(content) {
        this._content = content;
        this._childNodeArray = Array.from(this._content.childNodes);
        this._firstNode = this._childNodeArray.length > 0 ? this._childNodeArray[0] : null;
        this._lastNode = this._childNodeArray.length > 0 ? this._childNodeArray[this._childNodeArray.length - 1] : null;
    }
    get firstNode() {
        return this._firstNode;
    }
    get lastNode() {
        return this._lastNode;
    }
    get mounted() {
        return this._mounted;
    }
    appendTo(targetNode) {
        for (const node of this._childNodeArray) {
            targetNode.appendChild(node);
        }
        this._mounted = true;
    }
    mountAfter(targetNode) {
        const parentNode = targetNode.parentNode;
        const nextSibling = targetNode.nextSibling;
        if (parentNode) {
            for (const node of this._childNodeArray) {
                parentNode.insertBefore(node, nextSibling);
            }
        }
        this._mounted = true;
    }
    unmount() {
        for (const node of this._childNodeArray) {
            if (node.parentNode !== null) {
                node.parentNode.removeChild(node);
            }
        }
        const bindings = getBindingsByContent(this);
        for (const binding of bindings) {
            if (binding.bindingType === 'if' || binding.bindingType === 'elseif' || binding.bindingType === 'else') {
                const content = getContentByNode(binding.node);
                if (content !== null) {
                    content.unmount();
                }
            }
            clearStateAddressByBindingInfo(binding);
            clearAbsoluteStateAddressByBindingInfo(binding);
        }
        this._mounted = false;
    }
}
function createContent(bindingInfo) {
    if (typeof bindingInfo.uuid === 'undefined' || bindingInfo.uuid === null) {
        raiseError(`BindingInfo.uuid is null.`);
    }
    const fragmentInfo = getFragmentInfoByUUID(bindingInfo.uuid);
    if (!fragmentInfo) {
        raiseError(`Fragment with UUID "${bindingInfo.uuid}" not found.`);
    }
    const cloneFragment = document.importNode(fragmentInfo.fragment, true);
    const initialInfo = initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos);
    const content = new Content(cloneFragment);
    setBindingsByContent(content, initialInfo.bindingInfos);
    const indexBindings = [];
    for (const binding of initialInfo.bindingInfos) {
        if (binding.statePathName in INDEX_BY_INDEX_NAME) {
            indexBindings.push(binding);
        }
    }
    setIndexBindingsByContent(content, indexBindings);
    setNodesByContent(content, initialInfo.nodes);
    setContentByNode(bindingInfo.node, content);
    return content;
}

const rootNodeByFragment = new WeakMap();
function setRootNodeByFragment(fragment, rootNode) {
    if (rootNode === null) {
        rootNodeByFragment.delete(fragment);
    }
    else {
        rootNodeByFragment.set(fragment, rootNode);
    }
}
function getRootNodeByFragment(fragment) {
    return rootNodeByFragment.get(fragment) || null;
}

const lastValueByNode = new WeakMap();
const lastNodeByNode = new WeakMap();
const contentByListIndex = new WeakMap();
const pooledContentsByNode = new WeakMap();
const isOnlyNodeInParentContentByNode = new WeakMap();
function getPooledContents(bindingInfo) {
    return pooledContentsByNode.get(bindingInfo.node) || [];
}
function setPooledContent(bindingInfo, content) {
    const contents = pooledContentsByNode.get(bindingInfo.node);
    if (typeof contents === 'undefined') {
        pooledContentsByNode.set(bindingInfo.node, [content]);
    }
    else {
        contents.push(content);
    }
}
function isOnlyNodeInParentContent(firstNode, lastNode) {
    let prevCheckNode = firstNode.previousSibling;
    let nextCheckNode = lastNode.nextSibling;
    let onlyNode = true;
    while (prevCheckNode !== null) {
        if (prevCheckNode.nodeType === Node.ELEMENT_NODE
            || (prevCheckNode.nodeType === Node.TEXT_NODE && (prevCheckNode.textContent?.trim() ?? '') !== '')) {
            onlyNode = false;
            break;
        }
        prevCheckNode = prevCheckNode.previousSibling;
    }
    while (nextCheckNode !== null) {
        if (nextCheckNode.nodeType === Node.ELEMENT_NODE
            || (nextCheckNode.nodeType === Node.TEXT_NODE && (nextCheckNode.textContent?.trim() ?? '') !== '')) {
            onlyNode = false;
            break;
        }
        nextCheckNode = nextCheckNode.nextSibling;
    }
    return onlyNode;
}
function applyChangeToFor(bindingInfo, context, newValue) {
    const listPathInfo = bindingInfo.statePathInfo;
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    const lastValue = lastValueByNode.get(bindingInfo.node);
    const diff = createListDiff(listIndex, lastValue, newValue);
    if (Array.isArray(lastValue)
        && lastValue.length === diff.deleteIndexSet.size
        && diff.deleteIndexSet.size > 0
        && bindingInfo.node.parentNode !== null) {
        let isOnlyNode = isOnlyNodeInParentContentByNode.get(bindingInfo.node);
        if (typeof isOnlyNode === 'undefined') {
            const lastNode = lastNodeByNode.get(bindingInfo.node) || bindingInfo.node;
            isOnlyNode = isOnlyNodeInParentContent(bindingInfo.node, lastNode);
            isOnlyNodeInParentContentByNode.set(bindingInfo.node, isOnlyNode);
        }
        if (isOnlyNode) {
            const parentNode = bindingInfo.node.parentNode;
            parentNode.textContent = '';
            parentNode.appendChild(bindingInfo.node);
        }
    }
    for (const deleteIndex of diff.deleteIndexSet) {
        const content = contentByListIndex.get(deleteIndex);
        if (typeof content !== 'undefined') {
            content.unmount();
            deactivateContent(content);
            setPooledContent(bindingInfo, content);
        }
    }
    let lastNode = bindingInfo.node;
    const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
    const loopContextStack = context.stateElement.loopContextStack;
    let fragment = null;
    if (diff.newIndexes.length == diff.addIndexSet.size
        && diff.newIndexes.length > 0
        && lastNode.isConnected) {
        // 全部追加の場合はまとめて処理
        fragment = document.createDocumentFragment();
        setRootNodeByFragment(fragment, context.rootNode);
    }
    for (const index of diff.newIndexes) {
        let content;
        // add
        if (diff.addIndexSet.has(index)) {
            const stateAddress = createStateAddress(elementPathInfo, index);
            loopContextStack.createLoopContext(stateAddress, (loopContext) => {
                const pooledContents = getPooledContents(bindingInfo);
                content = pooledContents.pop();
                if (typeof content === 'undefined') {
                    content = createContent(bindingInfo);
                }
                // コンテント活性化の前にDOMツリーに追加しておく必要がある
                if (fragment !== null) {
                    content.appendTo(fragment);
                }
                else {
                    // Update lastNode for next iteration to ensure correct order
                    // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
                    if (lastNode.nextSibling !== content.firstNode) {
                        content.mountAfter(lastNode);
                    }
                }
                // コンテントを活性化
                activateContent(content, loopContext, context);
            });
            if (typeof content === 'undefined') {
                raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
            }
        }
        else {
            content = contentByListIndex.get(index);
            if (diff.changeIndexSet.has(index)) {
                // change
                const indexBindings = getIndexBindingsByContent(content);
                for (const indexBinding of indexBindings) {
                    applyChange(indexBinding, context);
                }
            }
            // Update lastNode for next iteration to ensure correct order
            // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
            if (typeof content === 'undefined') {
                raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
            }
            if (lastNode.nextSibling !== content.firstNode) {
                content.mountAfter(lastNode);
            }
        }
        lastNode = content.lastNode || lastNode;
        contentByListIndex.set(index, content);
    }
    lastNodeByNode.set(bindingInfo.node, lastNode);
    if (fragment !== null) {
        // Mount all at once
        bindingInfo.node.parentNode.insertBefore(fragment, bindingInfo.node.nextSibling);
        setRootNodeByFragment(fragment, null);
    }
    lastValueByNode.set(bindingInfo.node, newValue);
}

const lastConnectedByNode = new WeakMap();
function bindingInfoText(bindingInfo) {
    return `${bindingInfo.bindingType} ${bindingInfo.statePathName} ${bindingInfo.outFilters.map(f => f.filterName).join('|')} ${bindingInfo.node.isConnected ? '(connected)' : '(disconnected)'}`;
}
function applyChangeToIf(bindingInfo, context, rawNewValue) {
    const currentConnected = bindingInfo.node.isConnected;
    const newValue = Boolean(rawNewValue);
    let content = getContentByNode(bindingInfo.node);
    if (content === null) {
        content = createContent(bindingInfo);
    }
    try {
        if (!newValue) {
            if (config.debug) {
                console.log(`unmount if content : ${bindingInfoText(bindingInfo)}`);
            }
            content.unmount();
            deactivateContent(content);
        }
        if (newValue) {
            if (config.debug) {
                console.log(`mount if content : ${bindingInfoText(bindingInfo)}`);
            }
            content.mountAfter(bindingInfo.node);
            const loopContext = getLoopContextByNode(bindingInfo.node);
            activateContent(content, loopContext, context);
        }
    }
    finally {
        lastConnectedByNode.set(bindingInfo.node, currentConnected);
    }
}

function applyChangeToProperty(binding, _context, newValue) {
    const element = binding.node;
    const propSegments = binding.propSegments;
    if (propSegments.length === 1) {
        const firstSegment = propSegments[0];
        if (element[firstSegment] !== newValue) {
            element[firstSegment] = newValue;
        }
        return;
    }
    const firstSegment = propSegments[0];
    let subObject = element[firstSegment];
    for (let i = 1; i < propSegments.length - 1; i++) {
        const segment = propSegments[i];
        if (subObject == null) {
            return;
        }
        subObject = subObject[segment];
    }
    const oldValue = subObject[propSegments[propSegments.length - 1]];
    if (oldValue !== newValue) {
        subObject[propSegments[propSegments.length - 1]] = newValue;
    }
}

function applyChangeToStyle(binding, _context, newValue) {
    const styleName = binding.propSegments[1];
    const style = binding.node.style;
    const currentValue = style[styleName];
    if (currentValue !== newValue) {
        style[styleName] = newValue;
    }
}

function applyChangeToText(binding, _context, newValue) {
    if (binding.replaceNode.nodeValue !== newValue) {
        binding.replaceNode.nodeValue = newValue;
    }
}

function getFilteredValue(value, filters) {
    let filteredValue = value;
    for (const filter of filters) {
        filteredValue = filter.filterFn(filteredValue);
    }
    return filteredValue;
}

// indexName ... $1, $2, ...
function getIndexValueByLoopContext(loopContext, indexName) {
    if (loopContext.listIndex === null) {
        raiseError(`ListIndex not found for loopContext:`);
    }
    const indexPos = INDEX_BY_INDEX_NAME[indexName];
    if (typeof indexPos === "undefined") {
        raiseError(`Invalid index name: ${indexName}`);
    }
    const listIndex = loopContext.listIndex.at(indexPos);
    if (listIndex === null) {
        raiseError(`Index not found at position ${indexPos} for loopContext:`);
    }
    return listIndex.index;
}

function getValue(state, binding) {
    const stateAddress = getStateAddressByBindingInfo(binding);
    if (stateAddress.pathInfo.path in INDEX_BY_INDEX_NAME) {
        const loopContext = getLoopContextByNode(binding.node);
        if (loopContext === null) {
            raiseError(`ListIndex not found for binding: ${binding.statePathName}`);
        }
        return getIndexValueByLoopContext(loopContext, stateAddress.pathInfo.path);
    }
    else {
        return state.$$getByAddress(stateAddress);
    }
}

const applyChangeByFirstSegment = {
    "class": applyChangeToClass,
    "attr": applyChangeToAttribute,
    "style": applyChangeToStyle,
};
const applyChangeByBindingType = {
    "text": applyChangeToText,
    "for": applyChangeToFor,
    "if": applyChangeToIf,
    "else": applyChangeToIf,
    "elseif": applyChangeToIf,
};
function _applyChange(binding, context) {
    const value = getValue(context.state, binding);
    const filteredValue = getFilteredValue(value, binding.outFilters);
    let fn = applyChangeByBindingType[binding.bindingType];
    if (typeof fn === 'undefined') {
        const firstSegment = binding.propSegments[0];
        fn = applyChangeByFirstSegment[firstSegment];
        if (typeof fn === 'undefined') {
            fn = applyChangeToProperty;
        }
    }
    fn(binding, context, filteredValue);
}
function applyChange(binding, context) {
    if (context.appliedBindingSet.has(binding)) {
        return;
    }
    context.appliedBindingSet.add(binding);
    if (binding.bindingType === "event") {
        return;
    }
    let rootNode = binding.replaceNode.getRootNode();
    if (rootNode instanceof DocumentFragment && !(rootNode instanceof ShadowRoot)) {
        rootNode = getRootNodeByFragment(rootNode);
        if (rootNode === null) {
            raiseError(`Root node for fragment not found for binding.`);
        }
    }
    if (binding.stateName !== context.stateName || rootNode !== context.rootNode) {
        const stateElement = getStateElementByName(rootNode, binding.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${binding.stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (targetState) => {
            const newContext = {
                stateName: binding.stateName,
                rootNode: rootNode,
                stateElement: stateElement,
                state: targetState,
                appliedBindingSet: context.appliedBindingSet
            };
            _applyChange(binding, newContext);
        });
    }
    else {
        _applyChange(binding, context);
    }
}

/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 最適化のため、以下のグループ化を行う:
 * 同じ stateNameとrootNode を持つバインディングをグループ化 → createState の呼び出しを削減
 */
function applyChangeFromBindings(bindings) {
    let bindingIndex = 0;
    const appliedBindingSet = new Set();
    // 外側ループ: stateName ごとにグループ化
    while (bindingIndex < bindings.length) {
        let binding = bindings[bindingIndex];
        const stateName = binding.stateName;
        let rootNode = binding.replaceNode.getRootNode();
        if (rootNode instanceof DocumentFragment && !(rootNode instanceof ShadowRoot)) {
            rootNode = getRootNodeByFragment(rootNode);
            if (rootNode === null) {
                raiseError(`Root node for fragment not found for binding.`);
            }
        }
        const stateElement = getStateElementByName(rootNode, stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (state) => {
            const context = {
                rootNode: rootNode,
                stateName: stateName,
                stateElement: stateElement,
                state: state,
                appliedBindingSet: appliedBindingSet
            };
            do {
                applyChange(binding, context);
                bindingIndex++;
                const nextBindingInfo = bindings[bindingIndex];
                if (!nextBindingInfo)
                    break; // 終端に到達
                const nextRootNode = nextBindingInfo.replaceNode.getRootNode();
                if (nextBindingInfo.stateName !== stateName || nextRootNode !== context.rootNode)
                    break; // stateName が変わった
                binding = nextBindingInfo;
            } while (true); // eslint-disable-line no-constant-condition
        });
    }
}

class Updater {
    _queueAbsoluteAddresses = [];
    constructor() {
    }
    enqueueAbsoluteAddress(absoluteAddress) {
        const requireStartProcess = this._queueAbsoluteAddresses.length === 0;
        this._queueAbsoluteAddresses.push(absoluteAddress);
        if (requireStartProcess) {
            queueMicrotask(() => {
                const absoluteAddresses = this._queueAbsoluteAddresses;
                this._queueAbsoluteAddresses = [];
                this._applyChange(absoluteAddresses);
            });
        }
    }
    // テスト用に公開
    testApplyChange(absoluteAddresses) {
        this._applyChange(absoluteAddresses);
    }
    _applyChange(absoluteAddresses) {
        // Note: AbsoluteStateAddress はキャッシュされているため、
        // 同一の (stateName, address) は同じインスタンスとなり、
        // Set による重複排除が正しく機能する    
        const absoluteAddressSet = new Set(absoluteAddresses);
        const processBindingInfos = [];
        for (const absoluteAddress of absoluteAddressSet) {
            const bindings = getBindingInfosByAbsoluteStateAddress(absoluteAddress);
            processBindingInfos.push(...bindings);
        }
        applyChangeFromBindings(processBindingInfos);
    }
}
const updater = new Updater();
function getUpdater() {
    return updater;
}

const swapInfoByStateAddress = new WeakMap();
function getSwapInfoByAddress(address) {
    return swapInfoByStateAddress.get(address) ?? null;
}
function setSwapInfoByAddress(address, swapInfo) {
    if (swapInfo === null) {
        swapInfoByStateAddress.delete(address);
    }
    else {
        swapInfoByStateAddress.set(address, swapInfo);
    }
}

const MAX_DEPENDENCY_DEPTH = 1000;
// ToDo: IAbsoluteStateAddressに変更する
const lastValueByListAddress$1 = new WeakMap();
function getIndexes(listDiff, searchType) {
    switch (searchType) {
        case "old":
            return listDiff.oldIndexes;
        case "new":
            return listDiff.newIndexes;
        case "add":
            return listDiff.addIndexSet;
        case "change":
            return listDiff.changeIndexSet;
        case "delete":
            return listDiff.deleteIndexSet;
        default:
            {
                console.log(`Invalid search type: ${searchType}`);
            }
            return [];
    }
}
function _walkExpandWildcard(context, currentWildcardIndex, parentListIndex) {
    const parentPath = context.wildcardParentPaths[currentWildcardIndex];
    const parentPathInfo = getPathInfo(parentPath);
    const parentAddress = createStateAddress(parentPathInfo, parentListIndex);
    const lastValue = lastValueByListAddress$1.get(parentAddress);
    const newValue = context.stateProxy.$$getByAddress(parentAddress);
    const listDiff = createListDiff(parentAddress.listIndex, lastValue, newValue);
    const loopIndexes = getIndexes(listDiff, context.searchType);
    if (currentWildcardIndex === context.wildcardPaths.length - 1) {
        context.targetListIndexes.push(...loopIndexes);
    }
    else {
        for (const listIndex of loopIndexes) {
            _walkExpandWildcard(context, currentWildcardIndex + 1, listIndex);
        }
    }
    context.newValueByAddress.set(parentAddress, newValue);
}
function _walkDependency(context, startAddress, callback) {
    const stack = [{ address: startAddress, depth: 0 }];
    while (stack.length > 0) {
        const { address, depth } = stack.pop();
        if (depth > MAX_DEPENDENCY_DEPTH) {
            raiseError(`Maximum dependency depth of ${MAX_DEPENDENCY_DEPTH} exceeded. Possible circular dependency detected at path: ${address.pathInfo.path}`);
        }
        if (context.visited.has(address)) {
            continue;
        }
        context.visited.add(address);
        callback(address);
        const sourcePath = address.pathInfo.path;
        const nextDepth = depth + 1;
        // 依存アドレスを逆順でpushするための一時バッファ
        const nextEntries = [];
        /**
         * パスから依存関係をたどる
         * users.*.name <= users.* <= users
         * ただし、users がリストであれば users.* の依存関係は展開する
         */
        const staticDeps = context.staticMap.get(sourcePath);
        if (staticDeps) {
            for (const dep of staticDeps) {
                const depPathInfo = getPathInfo(dep);
                if (context.listPathSet.has(sourcePath) && depPathInfo.lastSegment === WILDCARD) {
                    //expand indexes
                    const newValue = context.stateProxy.$$getByAddress(address);
                    const lastValue = lastValueByListAddress$1.get(address);
                    const listDiff = createListDiff(address.listIndex, lastValue, newValue);
                    for (const listIndex of listDiff.newIndexes) {
                        const depAddress = createStateAddress(depPathInfo, listIndex);
                        context.result.add(depAddress);
                        nextEntries.push({ address: depAddress, depth: nextDepth });
                    }
                    context.newValueByAddress.set(address, newValue);
                }
                else {
                    const depAddress = createStateAddress(depPathInfo, address.listIndex);
                    context.result.add(depAddress);
                    nextEntries.push({ address: depAddress, depth: nextDepth });
                }
            }
        }
        /**
         * 動的依存関係をたどる
         * 動的依存関係は、getterの実行時に決定される
         *
         * source,           target
         *
         * products.*.price => products.*.tax
         * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
         *
         * products.*.price => products.summary
         * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
         *
         * categories.*.name => categories.*.products.*.categoryName
         * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
         */
        const dynamicDeps = context.dynamicMap.get(sourcePath);
        if (dynamicDeps) {
            for (const dep of dynamicDeps) {
                const depPathInfo = getPathInfo(dep);
                const listIndexes = [];
                if (depPathInfo.wildcardCount > 0) {
                    // ワイルドカードを含む依存関係の処理
                    // 同じ親を持つかをパスの集合積で判定する
                    // polyfills.tsにてSetのintersectionメソッドを定義している
                    const wildcardLen = calcWildcardLen(address.pathInfo, depPathInfo);
                    const expandable = (depPathInfo.wildcardCount - wildcardLen) >= 1;
                    if (expandable) {
                        let listIndex;
                        if (wildcardLen > 0) {
                            // categories.*.name => categories.*.products.*.categoryName
                            // ワイルドカードを含む同じ親（products.*）を持つのが、
                            // さらに下位にワイルドカードがあるので展開する
                            if (address.listIndex === null) {
                                raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
                            }
                            listIndex = address.listIndex.at(wildcardLen - 1);
                        }
                        else {
                            // selectedIndex => items.*.selected
                            // 同じ親を持たない場合はnullから開始
                            listIndex = null;
                        }
                        const expandContext = {
                            targetListIndexes: [],
                            wildcardPaths: depPathInfo.wildcardPaths,
                            wildcardParentPaths: depPathInfo.wildcardParentPaths,
                            stateProxy: context.stateProxy,
                            searchType: context.searchType,
                            newValueByAddress: context.newValueByAddress,
                        };
                        _walkExpandWildcard(expandContext, wildcardLen, listIndex);
                        listIndexes.push(...expandContext.targetListIndexes);
                    }
                    else {
                        // products.*.price => products.*.tax
                        // ワイルドカードを含む同じ親（products.*）を持つので、リストインデックスは引き継ぐ
                        if (address.listIndex === null) {
                            raiseError(`Cannot expand dynamic dependency with wildcard for non-list address: ${address.pathInfo.path}`);
                        }
                        const listIndex = address.listIndex.at(wildcardLen - 1);
                        listIndexes.push(listIndex);
                    }
                }
                else {
                    // products.*.tax => currentTaxRate
                    // 同じ親を持たないので、リストインデックスはnull
                    listIndexes.push(null);
                }
                for (const listIndex of listIndexes) {
                    const depAddress = createStateAddress(depPathInfo, listIndex);
                    context.result.add(depAddress);
                    nextEntries.push({ address: depAddress, depth: nextDepth });
                }
            }
        }
        // 逆順でpushして、元の再帰と同じ探索順序を保つ
        for (let i = nextEntries.length - 1; i >= 0; i--) {
            stack.push(nextEntries[i]);
        }
    }
}
function walkDependency(startAddress, staticDependency, dynamicDependency, listPathSet, stateProxy, searchType, callback) {
    const context = {
        staticMap: staticDependency,
        dynamicMap: dynamicDependency,
        result: new Set(),
        listPathSet: listPathSet,
        visited: new Set(),
        stateProxy: stateProxy,
        searchType: searchType,
        newValueByAddress: new Map(),
    };
    try {
        _walkDependency(context, startAddress, callback);
        return Array.from(context.result);
    }
    finally {
        for (const [address, newValue] of context.newValueByAddress.entries()) {
            lastValueByListAddress$1.set(address, newValue);
        }
    }
}

/**
 * setByAddress.ts
 *
 * Stateの内部APIとして、アドレス情報（IStateAddress）を指定して
 * 状態オブジェクト（target）に値を設定するための関数（setByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を設定（多重ループやワイルドカードにも対応）
 * - getter/setter経由で値設定時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathInfoやlistIndexを辿って再帰的に値を設定
 * - 設定後はupdater.enqueueUpdateAddressで更新情報を登録
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値設定を実現
 * - finallyで必ず更新情報を登録し、再描画や依存解決に利用
 * - getter/setter経由のスコープ切り替えも考慮した設計
 */
function _setByAddress(target, address, absAddress, value, receiver, handler) {
    try {
        if (address.pathInfo.path in target) {
            if (handler.stateElement.setterPaths.has(address.pathInfo.path)) {
                // setterの中で参照の可能性があるので、addressをプッシュする
                handler.pushAddress(address);
                try {
                    return Reflect.set(target, address.pathInfo.path, value, receiver);
                }
                finally {
                    handler.popAddress();
                }
            }
            else {
                return Reflect.set(target, address.pathInfo.path, value);
            }
        }
        else {
            const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
            const parentValue = getByAddress(target, parentAddress, receiver, handler);
            const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
            if (lastSegment === WILDCARD) {
                const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
                return Reflect.set(parentValue, index, value);
            }
            else {
                return Reflect.set(parentValue, lastSegment, value);
            }
        }
    }
    finally {
        const updater = getUpdater();
        updater.enqueueAbsoluteAddress(absAddress);
        // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
        walkDependency(address, handler.stateElement.staticDependency, handler.stateElement.dynamicDependency, handler.stateElement.listPaths, receiver, "new", (depAddress) => {
            // キャッシュを無効化（ダーティ）
            if (depAddress === address)
                return;
            const absDepPathInfo = getAbsolutePathInfo(handler.stateName, depAddress.pathInfo);
            const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
            setCacheEntryByAbsoluteStateAddress(absDepAddress, null);
            // 更新対象として登録
            updater.enqueueAbsoluteAddress(absDepAddress);
        });
    }
}
function _setByAddressWithSwap(target, address, absAddress, value, receiver, handler) {
    // elementsの場合はswapInfoを準備
    let parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
    let swapInfo = getSwapInfoByAddress(parentAddress);
    if (swapInfo === null) {
        const parentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
        const listIndexes = getListIndexesByList(parentValue) ?? [];
        swapInfo = {
            value: [...parentValue], listIndexes: [...listIndexes]
        };
        setSwapInfoByAddress(parentAddress, swapInfo);
    }
    try {
        return _setByAddress(target, address, absAddress, value, receiver, handler);
    }
    finally {
        const index = swapInfo.value.indexOf(value);
        const currentParentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
        const currentListIndexes = Array.isArray(currentParentValue) ? (getListIndexesByList(currentParentValue) ?? []) : [];
        const curIndex = address.listIndex.index;
        const listIndex = (index !== -1) ?
            swapInfo.listIndexes[index] :
            createListIndex(parentAddress.listIndex, -1);
        currentListIndexes[curIndex] = listIndex;
        // 重複チェック
        // 重複していない場合、swapが完了したとみなし、インデックスを更新
        const listValueSet = new Set(currentParentValue);
        if (listValueSet.size === swapInfo.value.length) {
            for (let i = 0; i < currentListIndexes.length; i++) {
                currentListIndexes[i].index = i;
            }
            // 完了したのでswapInfoを削除
            setSwapInfoByAddress(parentAddress, null);
        }
    }
}
function setByAddress(target, address, value, receiver, handler) {
    const stateElement = handler.stateElement;
    const isSwappable = stateElement.elementPaths.has(address.pathInfo.path);
    const cacheable = address.pathInfo.wildcardCount > 0 ||
        stateElement.getterPaths.has(address.pathInfo.path);
    const absPathInfo = getAbsolutePathInfo(stateElement.name, address.pathInfo);
    const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
    try {
        if (isSwappable) {
            return _setByAddressWithSwap(target, address, absAddress, value, receiver, handler);
        }
        else {
            return _setByAddress(target, address, absAddress, value, receiver, handler);
        }
    }
    finally {
        if (cacheable) {
            const cacheEntry = getCacheEntryByAbsoluteStateAddress(absAddress);
            if (cacheEntry === null) {
                setCacheEntryByAbsoluteStateAddress(absAddress, {
                    value: value
                });
            }
            else {
                // 既存のキャッシュエントリを更新(高速化のため新規オブジェクトを作成しない)
                cacheEntry.value = value;
            }
        }
    }
}

/**
 * resolve.ts
 *
 * StateClassのAPIとして、パス（path）とインデックス（indexes）を指定して
 * Stateの値を取得・設定するための関数（resolve）の実装です。
 *
 * 主な役割:
 * - 文字列パス（path）とインデックス配列（indexes）から、該当するState値の取得・設定を行う
 * - ワイルドカードや多重ループを含むパスにも対応
 * - value未指定時は取得（getByRef）、指定時は設定（setByRef）を実行
 *
 * 設計ポイント:
 * - getStructuredPathInfoでパスを解析し、ワイルドカード階層ごとにリストインデックスを解決
 * - handler.engine.getListIndexesSetで各階層のリストインデックス集合を取得
 * - getByRef/setByRefで値の取得・設定を一元的に処理
 * - 柔軟なバインディングやAPI経由での利用が可能
 */
function resolve(target, _prop, receiver, handler) {
    return (path, indexes, value) => {
        const pathInfo = getPathInfo(path);
        if (handler.addressStackLength > 0) {
            const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
            const stateElement = handler.stateElement;
            if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
                // gettersに含まれる場合は依存関係を登録
                if (stateElement.getterPaths.has(lastInfo.path)) {
                    stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
                }
            }
        }
        if (pathInfo.wildcardParentPathInfos.length > indexes.length) {
            raiseError(`indexes length is insufficient: ${path}`);
        }
        // ワイルドカード階層ごとにListIndexを解決していく
        let listIndex = null;
        for (let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
            const wildcardParentPathInfo = pathInfo.wildcardParentPathInfos[i];
            const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
            const tmpValue = getByAddress(target, wildcardAddress, receiver, handler);
            const listIndexes = getListIndexesByList(tmpValue);
            if (listIndexes == null) {
                raiseError(`ListIndexes not found: ${wildcardParentPathInfo.path}`);
            }
            const index = indexes[i];
            listIndex = listIndexes[index] ??
                raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
        }
        // ToDo:WritableかReadonlyかを判定して適切なメソッドを呼び出す
        const address = createStateAddress(pathInfo, listIndex);
        const hasSetValue = typeof value !== "undefined";
        if (!hasSetValue) {
            return getByAddress(target, address, receiver, handler);
        }
        else {
            setByAddress(target, address, value, receiver, handler);
        }
    };
}

/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */
// ToDo: IAbsoluteStateAddressに変更する
const lastValueByListAddress = new WeakMap();
function getAll(target, prop, receiver, handler) {
    const resolveFn = resolve(target, prop, receiver, handler);
    return (path, indexes) => {
        const newValueByAddress = new Map();
        const pathInfo = getPathInfo(path);
        if (handler.addressStackLength > 0) {
            const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
            const stateElement = handler.stateElement;
            if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
                // gettersに含まれる場合は依存関係を登録
                if (stateElement.getterPaths.has(lastInfo.path)) {
                    stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
                }
            }
        }
        if (typeof indexes === "undefined") {
            for (let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
                const wildcardPattern = pathInfo.wildcardParentPathInfos[i];
                const listIndex = getContextListIndex(handler, wildcardPattern.path);
                if (listIndex) {
                    indexes = listIndex.indexes;
                    break;
                }
            }
            if (typeof indexes === "undefined") {
                indexes = [];
            }
        }
        const walkWildcardPattern = (wildcardParentPathInfos, wildcardIndexPos, listIndex, indexes, indexPos, parentIndexes, results) => {
            const wildcardParentPathInfo = wildcardParentPathInfos[wildcardIndexPos] ?? null;
            if (wildcardParentPathInfo === null) {
                results.push(parentIndexes);
                return;
            }
            const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
            const oldValue = lastValueByListAddress.get(wildcardAddress);
            const newValue = getByAddress(target, wildcardAddress, receiver, handler);
            const listDiff = createListDiff(listIndex, oldValue, newValue);
            const listIndexes = listDiff.newIndexes;
            const index = indexes[indexPos] ?? null;
            newValueByAddress.set(wildcardAddress, newValue);
            if (index === null) {
                for (let i = 0; i < listIndexes.length; i++) {
                    const listIndex = listIndexes[i];
                    walkWildcardPattern(wildcardParentPathInfos, wildcardIndexPos + 1, listIndex, indexes, indexPos + 1, parentIndexes.concat(listIndex.index), results);
                }
            }
            else {
                const listIndex = listIndexes[index] ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
                if ((wildcardIndexPos + 1) < wildcardParentPathInfos.length) {
                    walkWildcardPattern(wildcardParentPathInfos, wildcardIndexPos + 1, listIndex, indexes, indexPos + 1, parentIndexes.concat(listIndex.index), results);
                }
                else {
                    // 最終ワイルドカード層まで到達しているので、結果を確定
                    results.push(parentIndexes.concat(listIndex.index));
                }
            }
        };
        const resultIndexes = [];
        walkWildcardPattern(pathInfo.wildcardParentPathInfos, 0, null, indexes, 0, [], resultIndexes);
        const resultValues = [];
        for (let i = 0; i < resultIndexes.length; i++) {
            resultValues.push(resolveFn(pathInfo.path, resultIndexes[i]));
        }
        for (const [address, newValue] of newValueByAddress.entries()) {
            lastValueByListAddress.set(address, newValue);
        }
        return resultValues;
    };
}

/**
 * getListIndex.ts
 *
 * StateClassの内部APIとして、パス情報（IResolvedAddress）から
 * 対応するリストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - パスのワイルドカード種別（context/all/partial/none）に応じてリストインデックスを解決
 * - context型は現在のループコンテキストからリストインデックスを取得
 * - all型は各階層のリストインデックス集合からインデックスを辿って取得
 * - partial型やnone型は未実装またはnullを返す
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループ、ネストした配列バインディングに柔軟に対応
 * - getListIndexesByListで各階層のリストインデックス集合を取得
 * - エラー時はraiseErrorで例外を投げる
 */
function getListIndex(target, resolvedAddress, receiver, handler) {
    const pathInfo = resolvedAddress.pathInfo;
    switch (resolvedAddress.wildcardType) {
        case "none":
            return null;
        case "context": {
            const lastWildcardPath = pathInfo.wildcardPaths.at(-1) ??
                raiseError(`lastWildcardPath is null: ${resolvedAddress.pathInfo.path}`);
            return getContextListIndex(handler, lastWildcardPath) ??
                raiseError(`ListIndex not found: ${resolvedAddress.pathInfo.path}`);
        }
        case "all": {
            let parentListIndex = null;
            for (let i = 0; i < resolvedAddress.pathInfo.wildcardCount; i++) {
                const wildcardParentPathInfo = resolvedAddress.pathInfo.wildcardParentPathInfos[i] ??
                    raiseError(`wildcardParentPathInfo is null: ${resolvedAddress.pathInfo.path}`);
                const wildcardParentAddress = createStateAddress(wildcardParentPathInfo, parentListIndex);
                const wildcardParentValue = getByAddress(target, wildcardParentAddress, receiver, handler);
                const wildcardParentListIndexes = getListIndexesByList(wildcardParentValue) ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
                const wildcardIndex = resolvedAddress.wildcardIndexes[i] ??
                    raiseError(`wildcardIndex is null: ${resolvedAddress.pathInfo.path}`);
                parentListIndex = wildcardParentListIndexes[wildcardIndex] ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
            }
            return parentListIndex;
        }
        case "partial": {
            raiseError(`Partial wildcard type is not supported yet: ${resolvedAddress.pathInfo.path}`);
        }
    }
}

function postUpdate(target, _prop, receiver, handler) {
    const stateElement = handler.stateElement;
    return (path) => {
        const resolvedAddress = getResolvedAddress(path);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const address = createStateAddress(resolvedAddress.pathInfo, listIndex);
        const absPathInfo = getAbsolutePathInfo(stateElement.name, address.pathInfo);
        const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
        const updater = getUpdater();
        updater.enqueueAbsoluteAddress(absAddress);
        // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
        walkDependency(address, handler.stateElement.staticDependency, handler.stateElement.dynamicDependency, handler.stateElement.listPaths, receiver, "new", (depAddress) => {
            // キャッシュを無効化（ダーティ）
            const absDepPathInfo = getAbsolutePathInfo(handler.stateName, depAddress.pathInfo);
            const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
            setCacheEntryByAbsoluteStateAddress(absDepAddress, null);
            // 更新対象として登録
            updater.enqueueAbsoluteAddress(absDepAddress);
        });
    };
}

/**
 * setLoopContext.ts
 *
 * StateClassの内部APIとして、ループコンテキスト（ILoopContext）を一時的に設定し、
 * 指定した同期/非同期コールバックをそのスコープ内で実行するための関数です。
 *
 * 主な役割:
 * - handler.loopContextにループコンテキストを一時的に設定
 * - 既にループコンテキストが設定されている場合はエラーを投げる
 * - 常にスコープを設定しコールバックを実行
 * - finallyで必ずloopContextをnullに戻し、スコープ外への影響を防止
 *
 * 設計ポイント:
 * - ループバインディングや多重ループ時のスコープ管理を安全に行う
 * - finallyで状態復元を保証し、例外発生時も安全
 * - 非同期処理にも対応
 */
function _setLoopContext(handler, loopContext, callback) {
    if (typeof handler.loopContext !== "undefined") {
        raiseError('already in loop context');
    }
    handler.setLoopContext(loopContext);
    try {
        handler.pushAddress(loopContext);
        try {
            return callback();
        }
        finally {
            handler.popAddress();
        }
    }
    finally {
        handler.clearLoopContext();
    }
}
function setLoopContext(handler, loopContext, callback) {
    return _setLoopContext(handler, loopContext, callback);
}
async function setLoopContextAsync(handler, loopContext, callback) {
    return await _setLoopContext(handler, loopContext, callback);
}

/**
 * get.ts
 *
 * StateClassのProxyトラップとして、プロパティアクセス時の値取得処理を担う関数（get）の実装です。
 *
 * 主な役割:
 * - 文字列プロパティの場合、特殊プロパティ（$1〜$9, $resolve, $getAll, $navigate）に応じた値やAPIを返却
 * - 通常のプロパティはgetResolvedPathInfoでパス情報を解決し、getListIndexでリストインデックスを取得
 * - getByRefで構造化パス・リストインデックスに対応した値を取得
 * - シンボルプロパティの場合はhandler.callableApi経由でAPIを呼び出し
 * - それ以外はReflect.getで通常のプロパティアクセスを実行
 *
 * 設計ポイント:
 * - $1〜$9は直近のStatePropertyRefのリストインデックス値を返す特殊プロパティ
 * - $resolve, $getAll, $navigateはAPI関数やルーターインスタンスを返す
 * - 通常のプロパティアクセスもバインディングや多重ループに対応
 * - シンボルAPIやReflect.getで拡張性・互換性も確保
 */
function get(target, prop, receiver, handler) {
    const index = INDEX_BY_INDEX_NAME[prop];
    if (typeof index !== "undefined") {
        if (handler.addressStackLength === 0) {
            raiseError(`No active state reference to get list index for "${prop.toString()}".`);
        }
        const listIndex = handler.lastAddressStack?.listIndex;
        return listIndex?.indexes[index] ?? raiseError(`ListIndex not found: ${prop.toString()}`);
    }
    if (typeof prop === "string") {
        if (prop === "$stateElement") {
            return handler.stateElement;
        }
        if (prop === "$$setLoopContextAsync") {
            return (loopContext, callback = async () => { }) => {
                return setLoopContextAsync(handler, loopContext, callback);
            };
        }
        if (prop === "$$setLoopContext") {
            return (loopContext, callback = () => { }) => {
                return setLoopContext(handler, loopContext, callback);
            };
        }
        if (prop === "$$getByAddress") {
            return (address) => {
                return getByAddress(target, address, receiver, handler);
            };
        }
        if (prop === "$getAll") {
            return (path, indexes) => {
                return getAll(target, prop, receiver, handler)(path, indexes);
            };
        }
        if (prop === "$postUpdate") {
            return (path) => {
                return postUpdate(target, prop, receiver, handler)(path);
            };
        }
        const resolvedAddress = getResolvedAddress(prop);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
        return getByAddress(target, stateAddress, receiver, handler);
    }
    else if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
        /*
            if (handler.symbols.has(prop)) {
              switch (prop) {
                case GetByRefSymbol:
                  return (ref: IStatePropertyRef) =>
                    getByRef(target, ref, receiver, handler);
                case SetByRefSymbol:
                  return (ref: IStatePropertyRef, value: any) =>
                    setByRef(target, ref, value, receiver, handler);
                case GetListIndexesByRefSymbol:
                  return (ref: IStatePropertyRef) =>
                    getListIndexesByRef(target, ref, receiver, handler);
                case ConnectedCallbackSymbol:
                  return () => connectedCallback(target, prop, receiver, handler);
                case DisconnectedCallbackSymbol:
                  return () => disconnectedCallback(target, prop, receiver, handler);
              }
            } else {
              return Reflect.get(
                target,
                prop,
                receiver
              );
            }
        */
    }
}

/**
 * set.ts
 *
 * StateClassのProxyトラップとして、プロパティ設定時の値セット処理を担う関数（set）の実装です。
 *
 * 主な役割:
 * - 文字列プロパティの場合、getResolvedPathInfoでパス情報を解決し、getListIndexでリストインデックスを取得
 * - setByRefで構造化パス・リストインデックスに対応した値設定を実行
 * - それ以外（シンボル等）の場合はReflect.setで通常のプロパティ設定を実行
 *
 * 設計ポイント:
 * - バインディングや多重ループ、ワイルドカードを含むパスにも柔軟に対応
 * - setByRefを利用することで、依存解決や再描画などの副作用も一元管理
 * - Reflect.setで標準的なプロパティ設定の互換性も確保
 */
function set(target, prop, value, receiver, handler) {
    if (typeof prop === "string") {
        const resolvedAddress = getResolvedAddress(prop);
        const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
        const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
        return setByAddress(target, stateAddress, value, receiver, handler);
    }
    else {
        return Reflect.set(target, prop, value, receiver);
    }
}

class StateHandler {
    _stateElement;
    _stateName;
    _addressStack = Array(MAX_LOOP_DEPTH).fill(undefined);
    _addressStackIndex = -1;
    _loopContext;
    _mutability;
    constructor(rootNode, stateName, mutability) {
        this._stateName = stateName;
        const stateElement = getStateElementByName(rootNode, this._stateName);
        if (stateElement === null) {
            raiseError(`StateHandler: State element with name "${this._stateName}" not found.`);
        }
        this._stateElement = stateElement;
        this._mutability = mutability;
    }
    get stateName() {
        return this._stateName;
    }
    get stateElement() {
        return this._stateElement;
    }
    get lastAddressStack() {
        let address = undefined;
        if (this._addressStackIndex >= 0) {
            address = this._addressStack[this._addressStackIndex];
        }
        if (typeof address === "undefined") {
            raiseError(`Last address stack is undefined.`);
        }
        return address;
    }
    get addressStackLength() {
        return this._addressStackIndex + 1;
    }
    get loopContext() {
        return this._loopContext;
    }
    pushAddress(address) {
        this._addressStackIndex++;
        if (this._addressStackIndex >= MAX_LOOP_DEPTH) {
            raiseError(`Exceeded maximum address stack depth of ${MAX_LOOP_DEPTH}. Possible infinite loop.`);
        }
        this._addressStack[this._addressStackIndex] = address;
    }
    popAddress() {
        if (this._addressStackIndex < 0) {
            return null;
        }
        const address = this._addressStack[this._addressStackIndex];
        if (typeof address === "undefined") {
            raiseError(`Address stack at index ${this._addressStackIndex} is undefined.`);
        }
        this._addressStack[this._addressStackIndex] = undefined;
        this._addressStackIndex--;
        return address;
    }
    setLoopContext(loopContext) {
        this._loopContext = loopContext;
    }
    clearLoopContext() {
        this._loopContext = undefined;
    }
    get(target, prop, receiver) {
        return get(target, prop, receiver, this);
    }
    set(target, prop, value, receiver) {
        if (this._mutability === "readonly") {
            raiseError(`State "${this._stateName}" is readonly.`);
        }
        return set(target, prop, value, receiver, this);
    }
    has(target, prop) {
        return Reflect.has(target, prop);
        //    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
    }
}
function createStateProxy(rootNode, state, stateName, mutability) {
    const handler = new StateHandler(rootNode, stateName, mutability);
    const stateProxy = new Proxy(state, handler);
    return stateProxy;
}

const MUSTACHE_REGEX = /\{\{\s*(.+?)\s*\}\}/g;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE"]);
function convertMustacheToComments(root) {
    convertTextNodes(root);
    const templates = root.querySelectorAll("template");
    for (const template of templates) {
        convertMustacheToComments(template.content);
    }
}
function convertTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }
    for (const textNode of textNodes) {
        if (textNode.parentElement && SKIP_TAGS.has(textNode.parentElement.tagName)) {
            continue;
        }
        replaceTextNode(textNode);
    }
}
function replaceTextNode(textNode) {
    const text = textNode.data;
    MUSTACHE_REGEX.lastIndex = 0;
    if (!MUSTACHE_REGEX.test(text)) {
        return;
    }
    MUSTACHE_REGEX.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = MUSTACHE_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const bindText = match[1];
        fragment.appendChild(document.createComment(`@@: ${bindText}`));
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(fragment, textNode);
}

let _notFilterInfo = undefined;
function createNotFilter() {
    if (_notFilterInfo) {
        return _notFilterInfo;
    }
    const filterName = "not";
    const args = [];
    const filterFn = builtinFilterFn(filterName, args)(outputBuiltinFilters);
    _notFilterInfo = {
        filterName,
        args,
        filterFn,
    };
    return _notFilterInfo;
}

const COMMENT_REGEX = /^(\s*@@\s*(?:.*?)\s*:\s*)(.+?)(\s*)$/;
function expandShorthandInStatePart(statePart, forPath) {
    const prefix = forPath + DELIMITER + WILDCARD;
    const pipeIndex = statePart.indexOf('|');
    const atIndex = statePart.indexOf('@');
    let pathPart;
    let suffix;
    if (pipeIndex !== -1) {
        pathPart = statePart.slice(0, pipeIndex).trim();
        suffix = statePart.slice(pipeIndex);
    }
    else if (atIndex !== -1) {
        pathPart = statePart.slice(0, atIndex).trim();
        suffix = statePart.slice(atIndex);
    }
    else {
        pathPart = statePart.trim();
        suffix = '';
    }
    if (pathPart === '.') {
        pathPart = prefix;
    }
    else if (pathPart.startsWith('.')) {
        pathPart = prefix + DELIMITER + pathPart.slice(1);
    }
    else {
        return statePart;
    }
    if (suffix.length > 0) {
        return pathPart + suffix;
    }
    return pathPart;
}
function expandCommentData(data, forPath) {
    const match = COMMENT_REGEX.exec(data);
    if (match === null) {
        return data;
    }
    const commentPrefix = match[1];
    const bindText = match[2];
    const commentSuffix = match[3];
    const expanded = expandShorthandInStatePart(bindText, forPath);
    return commentPrefix + expanded + commentSuffix;
}
function expandBindAttribute(attrValue, forPath) {
    const parts = attrValue.split(';');
    let changed = false;
    const result = parts.map(part => {
        const trimmed = part.trim();
        if (trimmed.length === 0)
            return part;
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1)
            return part;
        const propPart = trimmed.slice(0, colonIndex).trim();
        const statePart = trimmed.slice(colonIndex + 1).trim();
        const expanded = expandShorthandInStatePart(statePart, forPath);
        if (expanded !== statePart) {
            changed = true;
            return `${propPart}: ${expanded}`;
        }
        return part;
    });
    if (!changed)
        return attrValue;
    return result.join(';');
}
function expandShorthandInBindAttribute(attrValue, forPath) {
    return expandBindAttribute(attrValue, forPath);
}
function expandShorthandPaths(root, forPath) {
    const bindAttr = config.bindAttributeName;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === Node.COMMENT_NODE) {
            const comment = node;
            comment.data = expandCommentData(comment.data, forPath);
            continue;
        }
        const element = node;
        if (element instanceof HTMLTemplateElement) {
            continue;
        }
        const attr = element.getAttribute(bindAttr);
        if (attr !== null) {
            const expanded = expandBindAttribute(attr, forPath);
            if (expanded !== attr) {
                element.setAttribute(bindAttr, expanded);
            }
        }
    }
}

function getNodePath(node) {
    let currentNode = node;
    const path = [];
    while (currentNode.parentNode !== null) {
        const nodes = Array.from(currentNode.parentNode.childNodes);
        const index = nodes.indexOf(currentNode);
        path.unshift(index);
        currentNode = currentNode.parentNode;
    }
    return path;
}

function getFragmentNodeInfos(fragment) {
    const fragmnentNodeInfos = [];
    const subscriberNodes = getSubscriberNodes(fragment);
    for (const subscriberNode of subscriberNodes) {
        const parseBindingTextResults = getParseBindTextResults(subscriberNode);
        fragmnentNodeInfos.push({
            nodePath: getNodePath(subscriberNode),
            parseBindTextResults: parseBindingTextResults,
        });
    }
    return fragmnentNodeInfos;
}

function optimizeFragment(fragment) {
    const childNodes = Array.from(fragment.childNodes);
    for (const childNode of childNodes) {
        if (childNode.nodeType === Node.TEXT_NODE) {
            const textContent = childNode.textContent || '';
            if (textContent.trim() === '') {
                // Remove empty text nodes
                fragment.removeChild(childNode);
            }
        }
    }
}

const keywordByBindingType = new Map([
    ["for", config.commentForPrefix],
    ["if", config.commentIfPrefix],
    ["elseif", config.commentElseIfPrefix],
    ["else", config.commentElsePrefix],
]);
const notFilter = createNotFilter();
function cloneNotParseBindTextResult(bindingType, parseBindTextResult) {
    const filters = parseBindTextResult.outFilters;
    return {
        ...parseBindTextResult,
        outFilters: [...filters, notFilter],
        bindingType: bindingType,
    };
}
function _getFragmentInfo(rootNode, fragment, parseBindingTextResult, forPath) {
    optimizeFragment(fragment);
    if (typeof forPath === "string") {
        expandShorthandPaths(fragment, forPath);
    }
    collectStructuralFragments(rootNode, fragment, forPath);
    // after replacing and collect node infos on child fragment
    const fragmentInfo = {
        fragment: fragment,
        parseBindTextResult: parseBindingTextResult,
        nodeInfos: getFragmentNodeInfos(fragment),
    };
    return fragmentInfo;
}
function collectStructuralFragments(rootNode, walkRoot, forPath) {
    const elseKeyword = config.commentElsePrefix;
    const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const element = node;
            if (element instanceof HTMLTemplateElement) {
                const bindText = element.getAttribute(config.bindAttributeName) || '';
                if (bindText.length > 0) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
            return NodeFilter.FILTER_SKIP;
        }
    });
    let lastIfFragmentInfo = null; // for elseif chaining
    const elseFragmentInfos = []; // for elseif chaining
    const templates = [];
    while (walker.nextNode()) {
        const template = walker.currentNode;
        templates.push(template);
    }
    for (const template of templates) {
        let bindText = template.getAttribute(config.bindAttributeName) || '';
        if (typeof forPath === "string") {
            bindText = expandShorthandInBindAttribute(bindText, forPath);
        }
        const parseBindTextResults = parseBindTextsForElement(bindText);
        let parseBindTextResult = parseBindTextResults[0];
        const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
        if (typeof keyword === 'undefined') {
            continue;
        }
        const bindingType = parseBindTextResult.bindingType;
        const fragment = template.content;
        const uuid = getUUID();
        let fragmentInfo = null;
        // Determine childForPath for shorthand expansion
        const childForPath = bindingType === "for"
            ? parseBindTextResult.statePathName
            : forPath;
        if (bindingType === "else") {
            // check last 'if' or 'elseif' fragment info
            if (lastIfFragmentInfo === null) {
                raiseError(`'else' binding found without preceding 'if' or 'elseif' binding.`);
            }
            // else condition
            parseBindTextResult = cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult);
            fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
            const lastElseFragmentInfo = elseFragmentInfos.at(-1);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            if (typeof lastElseFragmentInfo !== "undefined") {
                template.remove();
                lastElseFragmentInfo.fragment.appendChild(placeHolder);
                lastElseFragmentInfo.nodeInfos.push({
                    nodePath: getNodePath(placeHolder),
                    parseBindTextResults: getParseBindTextResults(placeHolder),
                });
            }
            else {
                template.replaceWith(placeHolder);
            }
        }
        else if (bindingType === "elseif") {
            // check last 'if' or 'elseif' fragment info
            if (lastIfFragmentInfo === null) {
                raiseError(`'elseif' binding found without preceding 'if' or 'elseif' binding.`);
            }
            fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            // create else fragment
            const elseUUID = getUUID();
            const elseFragmentInfo = {
                fragment: document.createDocumentFragment(),
                parseBindTextResult: cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult),
                nodeInfos: [],
            };
            elseFragmentInfo.fragment.appendChild(placeHolder);
            elseFragmentInfo.nodeInfos.push({
                nodePath: getNodePath(placeHolder),
                parseBindTextResults: getParseBindTextResults(placeHolder),
            });
            setFragmentInfoByUUID(elseUUID, rootNode, elseFragmentInfo);
            const lastElseFragmentInfo = elseFragmentInfos.at(-1);
            elseFragmentInfos.push(elseFragmentInfo);
            const elsePlaceHolder = document.createComment(`@@${elseKeyword}:${elseUUID}`);
            if (typeof lastElseFragmentInfo !== "undefined") {
                template.remove();
                lastElseFragmentInfo.fragment.appendChild(elsePlaceHolder);
                lastElseFragmentInfo.nodeInfos.push({
                    nodePath: getNodePath(elsePlaceHolder),
                    parseBindTextResults: getParseBindTextResults(elsePlaceHolder),
                });
            }
            else {
                template.replaceWith(elsePlaceHolder);
            }
        }
        else {
            fragmentInfo = _getFragmentInfo(rootNode, fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, rootNode, fragmentInfo);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            template.replaceWith(placeHolder);
        }
        // Update lastIfFragmentInfo for if/elseif/else chaining
        if (bindingType === "if") {
            elseFragmentInfos.length = 0; // start new if chain
            lastIfFragmentInfo = fragmentInfo;
        }
        else if (bindingType === "elseif") {
            lastIfFragmentInfo = fragmentInfo;
        }
        else if (bindingType === "else") {
            lastIfFragmentInfo = null;
            elseFragmentInfos.length = 0; // end if chain
        }
    }
}

async function waitForStateInitialize(root) {
    const elements = root.querySelectorAll(config.tagNames.state);
    const promises = [];
    await customElements.whenDefined(config.tagNames.state);
    for (const element of elements) {
        const stateElement = element;
        promises.push(stateElement.initializePromise);
    }
    await Promise.all(promises);
}

const getterFn$1 = (binding) => {
    const rootNode = binding.replaceNode.getRootNode();
    const outerStateElement = getStateElementByName(rootNode, binding.stateName);
    if (outerStateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    const outerName = binding.statePathName;
    return () => {
        let value = undefined;
        const loopContext = getLoopContextByNode(binding.node);
        outerStateElement.createState("readonly", (state) => {
            state.$$setLoopContext(loopContext, () => {
                value = state[outerName];
            });
        });
        return value;
    };
};
const setterFn$1 = (binding) => {
    const rootNode = binding.replaceNode.getRootNode();
    const outerStateElement = getStateElementByName(rootNode, binding.stateName);
    if (outerStateElement === null) {
        raiseError(`State element with name "${binding.stateName}" not found for binding.`);
    }
    const outerName = binding.statePathName;
    return (v) => {
        const loopContext = getLoopContextByNode(binding.node);
        outerStateElement.createState("writable", (state) => {
            state.$$setLoopContext(loopContext, () => {
                state[outerName] = v;
            });
        });
    };
};
class InnerState {
    constructor() {
    }
    $$bind(binding) {
        const innerName = binding.propSegments.slice(1).join('.');
        Object.defineProperty(this, innerName, {
            get: getterFn$1(binding),
            set: setterFn$1(binding),
            enumerable: true,
            configurable: true,
        });
    }
}
function createInnerState() {
    return new InnerState();
}

const getterFn = (_innerStateElement, _innerName) => () => {
    /*
      let value = undefined;
      innerStateElement.createState("readonly", (state) => {
        value = state[innerName];
      });
      return value;
    */
    return undefined; // 暫定的に常に更新を発生させる
};
const setterFn = (innerStateElement, innerName) => (_v) => {
    innerStateElement.createState("readonly", (state) => {
        state.$postUpdate(innerName);
    });
};
class OuterState {
    constructor() {
    }
    $$bind(innerStateElement, binding) {
        const innerName = binding.propSegments.slice(1).join('.');
        Object.defineProperty(this, innerName, {
            get: getterFn(),
            set: setterFn(innerStateElement, innerName),
            enumerable: true,
            configurable: true,
        });
    }
}
function createOuterState() {
    return new OuterState();
}

const getOuter = (outerState) => () => outerState;
const innerStateGetter = (inner, innerName) => () => inner[innerName];
const innerStateSetter = (inner, innerName) => (v) => {
    inner[innerName] = v;
};
async function bindWebComponent(innerStateElement, component, stateProp, initialState) {
    if (component.shadowRoot === null) {
        raiseError('Component has no shadow root.');
    }
    if (!component.hasAttribute(config.bindAttributeName)) {
        raiseError(`Component has no "${config.bindAttributeName}" attribute for state binding.`);
    }
    const shadowRoot = component.shadowRoot;
    // waitForStateInitializeよりも前に呼ばないとデッドロックする
    innerStateElement.setInitialState(initialState);
    await waitForStateInitialize(shadowRoot);
    convertMustacheToComments(shadowRoot);
    collectStructuralFragments(shadowRoot, shadowRoot);
    await waitInitializeBinding(component);
    // initializeBindingsの前にinerState,outerStateの紐付けを行う
    const bindings = getBindingsByNode(component);
    if (bindings === null) {
        raiseError('Bindings not found for component node.');
    }
    const outerState = createOuterState();
    const innerState = createInnerState();
    for (const binding of bindings) {
        outerState.$$bind(innerStateElement, binding);
        innerState.$$bind(binding);
        const innerStateProp = binding.propSegments[0];
        const innerName = binding.propSegments.slice(1).join('.');
        if (stateProp !== innerStateProp) {
            raiseError(`Binding prop "${innerStateProp}" does not match stateProp "${stateProp}".`);
        }
        innerStateElement.bindProperty(innerName, {
            get: innerStateGetter(innerState, innerName),
            set: innerStateSetter(innerState, innerName),
            enumerable: true,
            configurable: true,
        });
    }
    Object.defineProperty(component, stateProp, {
        get: getOuter(outerState),
        enumerable: true,
        configurable: true,
    });
    initializeBindings(shadowRoot, null);
}

function getAllPropertyDescriptors(obj) {
    let descriptors = {};
    let proto = obj;
    while (proto && proto !== Object.prototype) {
        Object.assign(descriptors, Object.getOwnPropertyDescriptors(proto));
        proto = Object.getPrototypeOf(proto);
    }
    return descriptors;
}
function getStateInfo(state) {
    const getterPaths = new Set();
    const setterPaths = new Set();
    const descriptors = getAllPropertyDescriptors(state);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (typeof descriptor.get === "function") {
            getterPaths.add(key);
        }
        if (typeof descriptor.set === "function") {
            setterPaths.add(key);
        }
    }
    return {
        getterPaths, setterPaths
    };
}
class State extends HTMLElement {
    __state;
    _name = 'default';
    _initialized = false;
    _initializePromise;
    _resolveInitialize = null;
    _loadingPromise;
    _resolveLoading = null;
    _setStatePromise = null;
    _resolveSetState = null;
    _listPaths = new Set();
    _elementPaths = new Set();
    _getterPaths = new Set();
    _setterPaths = new Set();
    _loopContextStack = createLoopContextStack();
    _dynamicDependency = new Map();
    _staticDependency = new Map();
    _pathSet = new Set();
    _version = 0;
    _rootNode = null;
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
        this._loadingPromise = new Promise((resolve) => {
            this._resolveLoading = resolve;
        });
        this._setStatePromise = new Promise((resolve) => {
            this._resolveSetState = resolve;
        });
    }
    get _state() {
        if (typeof this.__state === "undefined") {
            raiseError(`${config.tagNames.state} _state is not initialized yet.`);
        }
        return this.__state;
    }
    set _state(value) {
        this.__state = value;
        this._listPaths.clear();
        this._elementPaths.clear();
        this._getterPaths.clear();
        this._pathSet.clear();
        const stateInfo = getStateInfo(value);
        for (const path of stateInfo.getterPaths) {
            this._getterPaths.add(path);
        }
        for (const path of stateInfo.setterPaths) {
            this._setterPaths.add(path);
        }
        this._resolveLoading?.();
    }
    get name() {
        return this._name;
    }
    async _initialize() {
        try {
            if (this.hasAttribute('state')) {
                const state = this.getAttribute('state');
                this._state = loadFromScriptJson(state);
            }
            else if (this.hasAttribute('src')) {
                const src = this.getAttribute('src');
                if (src && src.endsWith('.json')) {
                    this._state = await loadFromJsonFile(src);
                }
                else if (src && src.endsWith('.js')) {
                    this._state = await loadFromScriptFile(src);
                }
                else {
                    raiseError(`Unsupported src file type: ${src}`);
                }
            }
            else if (this.hasAttribute('json')) {
                const json = this.getAttribute('json');
                this._state = JSON.parse(json);
            }
            else {
                const script = this.querySelector('script[type="module"]');
                if (script) {
                    this._state = await loadFromInnerScript(script, `state#${this._name}`);
                }
                else {
                    const timerId = setTimeout(() => {
                        console.warn(`[@wcstack/state] Warning: No state source found for <${config.tagNames.state}> element with name="${this._name}".`);
                    }, NO_SET_TIMEOUT);
                    // 要注意！！！APIでセットする場合はここで待機する必要がある --(1)
                    this._state = await this._setStatePromise;
                    clearTimeout(timerId);
                }
            }
        }
        catch (e) {
            raiseError(`Failed to initialize state: ${e}`);
        }
        await this._loadingPromise;
        this._name = this.getAttribute('name') || 'default';
        setStateElementByName(this.rootNode, this._name, this);
    }
    async _bindWebComponent() {
        if (this.hasAttribute('bind-component')) {
            if (!(this.rootNode instanceof ShadowRoot)) {
                raiseError('bind-component can only be used inside a shadow root.');
            }
            const component = this.rootNode.host;
            const componentStateProp = this.getAttribute('bind-component');
            try {
                await customElements.whenDefined(component.tagName.toLowerCase());
                if (!(componentStateProp in component)) {
                    raiseError(`Component does not have property "${componentStateProp}" for state binding.`);
                }
                const state = component[componentStateProp];
                if (typeof state !== 'object' || state === null) {
                    raiseError(`Component property "${componentStateProp}" is not an object for state binding.`);
                }
                await this.bindWebComponent(component, componentStateProp, state);
            }
            catch (e) {
                raiseError(`Failed to bind web component: ${e}`);
            }
        }
    }
    async connectedCallback() {
        this._rootNode = this.getRootNode();
        if (!this._initialized) {
            // (1)のデッドロック回避のためにawaitしない
            this._bindWebComponent();
            await this._initialize();
            this._initialized = true;
            this._resolveInitialize?.();
        }
    }
    disconnectedCallback() {
        if (this._rootNode !== null) {
            setStateElementByName(this.rootNode, this._name, null);
            this._rootNode = null;
        }
    }
    get initializePromise() {
        return this._initializePromise;
    }
    get listPaths() {
        return this._listPaths;
    }
    get elementPaths() {
        return this._elementPaths;
    }
    get getterPaths() {
        return this._getterPaths;
    }
    get setterPaths() {
        return this._setterPaths;
    }
    get loopContextStack() {
        return this._loopContextStack;
    }
    get dynamicDependency() {
        return this._dynamicDependency;
    }
    get staticDependency() {
        return this._staticDependency;
    }
    get version() {
        return this._version;
    }
    get rootNode() {
        if (this._rootNode === null) {
            raiseError('State rootNode is not available.');
        }
        return this._rootNode;
    }
    _addDependency(map, sourcePath, targetPath) {
        const deps = map.get(sourcePath);
        if (deps === undefined) {
            map.set(sourcePath, [targetPath]);
            return true;
        }
        else if (!deps.includes(targetPath)) {
            deps.push(targetPath);
            return true;
        }
        return false;
    }
    /**
     * source,           target
     *
     * products.*.price => products.*.tax
     * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
     *
     * products.*.price => products.summary
     * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
     *
     * categories.*.name => categories.*.products.*.categoryName
     * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
     *
     * @param sourcePath
     * @param targetPath
     */
    addDynamicDependency(sourcePath, targetPath) {
        return this._addDependency(this._dynamicDependency, sourcePath, targetPath);
    }
    /**
     * source,      target
     * products => products.*
     * products.* => products.*.price
     * products.* => products.*.name
     *
     * @param sourcePath
     * @param targetPath
     */
    addStaticDependency(sourcePath, targetPath) {
        return this._addDependency(this._staticDependency, sourcePath, targetPath);
    }
    setPathInfo(path, bindingType) {
        if (bindingType === "for") {
            this._listPaths.add(path);
            this._elementPaths.add(path + '.' + WILDCARD);
        }
        if (!this._pathSet.has(path)) {
            const pathInfo = getPathInfo(path);
            this._pathSet.add(path);
            if (pathInfo.parentPath !== null) {
                let currentPathInfo = pathInfo;
                while (currentPathInfo.parentPath !== null) {
                    if (!this.addStaticDependency(currentPathInfo.parentPath, currentPathInfo.path)) {
                        break;
                    }
                    currentPathInfo = getPathInfo(currentPathInfo.parentPath);
                }
            }
        }
    }
    _createState(rootNode, mutability, callback) {
        try {
            const stateProxy = createStateProxy(rootNode, this._state, this._name, mutability);
            return callback(stateProxy);
        }
        finally {
            // cleanup if needed
        }
    }
    async createStateAsync(mutability, callback) {
        return await this._createState(this.rootNode, mutability, callback);
    }
    createState(mutability, callback) {
        this._createState(this.rootNode, mutability, callback);
    }
    nextVersion() {
        this._version++;
        return this._version;
    }
    async bindWebComponent(component, stateProp, initialState) {
        await bindWebComponent(this, component, stateProp, initialState);
    }
    bindProperty(prop, desc) {
        Object.defineProperty(this._state, prop, desc);
    }
    setInitialState(state) {
        if (this._initialized) {
            raiseError('setInitialState cannot be called after state is initialized.');
        }
        this._resolveSetState?.(state);
    }
}

function registerComponents() {
    // Register custom element
    if (!customElements.get(config.tagNames.state)) {
        customElements.define(config.tagNames.state, State);
    }
}

function registerHandler() {
    document.addEventListener("DOMContentLoaded", async () => {
        await waitForStateInitialize(document);
        convertMustacheToComments(document);
        collectStructuralFragments(document, document);
        initializeBindings(document.body, null);
    });
}

function bootstrapState() {
    registerComponents();
    registerHandler();
}

export { bootstrapState };
//# sourceMappingURL=index.esm.js.map
