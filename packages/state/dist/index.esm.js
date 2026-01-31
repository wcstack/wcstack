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

const stateElementByName = new Map();
function getStateElementByName(name) {
    const result = stateElementByName.get(name) || null;
    if (result === null && name === 'default') {
        const state = document.querySelector(`${config.tagNames.state}:not([name])`);
        if (state instanceof State) {
            stateElementByName.set('default', state);
            return state;
        }
    }
    return result;
}
function setStateElementByName(name, element) {
    if (element === null) {
        stateElementByName.delete(name);
    }
    else {
        stateElementByName.set(name, element);
    }
}

class LoopContextStack {
    _loopContextStack = [];
    createLoopContext(elementPathInfo, listIndex, callback) {
        const lastLoopContext = this._loopContextStack[this._loopContextStack.length - 1];
        if (typeof lastLoopContext !== "undefined") {
            if (lastLoopContext.elementPathInfo.wildcardCount + 1 !== elementPathInfo.wildcardCount) {
                raiseError(`Cannot push loop context for a list whose wildcard count is not exactly one more than the current active loop context.`);
            }
            const lastWildcardParentPathInfo = elementPathInfo.wildcardParentPathInfos[elementPathInfo.wildcardParentPathInfos.length - 1];
            if (lastLoopContext.elementPathInfo !== lastWildcardParentPathInfo) {
                raiseError(`Cannot push loop context for a list whose parent wildcard path info does not match the current active loop context.`);
            }
        }
        else {
            if (elementPathInfo.wildcardCount !== 1) {
                raiseError(`Cannot push loop context for a list with wildcard positions when there is no active loop context.`);
            }
        }
        const loopContext = { elementPathInfo, listIndex };
        this._loopContextStack.push(loopContext);
        let retValue = void 0;
        try {
            retValue = callback(loopContext);
        }
        finally {
            if (retValue instanceof Promise) {
                return retValue.finally(() => {
                    this._loopContextStack.pop();
                });
            }
            else {
                this._loopContextStack.pop();
            }
        }
        return retValue;
    }
}
function createLoopContextStack() {
    return new LoopContextStack();
}

const WILDCARD = '*';
const MAX_WILDCARD_DEPTH = 128;

const _cache$2 = {};
function getPathInfo(path) {
    if (_cache$2[path]) {
        return _cache$2[path];
    }
    const pathInfo = new PathInfo(path);
    _cache$2[path] = pathInfo;
    return pathInfo;
}
class PathInfo {
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
const _cache$1 = new Map();
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
    return _cache$1.get(name) ?? (_cache$1.set(name, nameInfo = new ResolvedAddress(name)), nameInfo);
}

const _cache = new WeakMap();
const _cacheNullListIndex = new WeakMap();
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
        let cached = _cacheNullListIndex.get(pathInfo);
        if (typeof cached !== "undefined") {
            return cached;
        }
        cached = new StateAddress(pathInfo, null);
        _cacheNullListIndex.set(pathInfo, cached);
        return cached;
    }
    else {
        let cacheByPathInfo = _cache.get(listIndex);
        if (typeof cacheByPathInfo === "undefined") {
            cacheByPathInfo = new WeakMap();
            _cache.set(listIndex, cacheByPathInfo);
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

function getUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Simple UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
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
function createListIndexes(parentListIndex, rawOldList, rawNewList, oldIndexes) {
    // Normalize inputs to arrays (handles null/undefined)
    const oldList = Array.isArray(rawOldList) ? rawOldList : [];
    const newList = Array.isArray(rawNewList) ? rawNewList : [];
    const newIndexes = [];
    // Early return for empty list
    if (newList.length === 0) {
        return [];
    }
    // If old list was empty, create all new indexes
    if (oldList.length === 0) {
        for (let i = 0; i < newList.length; i++) {
            const newListIndex = createListIndex(parentListIndex, i);
            newIndexes.push(newListIndex);
        }
        return newIndexes;
    }
    // If lists are identical, return existing indexes unchanged (optimization)
    if (isSameList(oldList, newList)) {
        return oldIndexes;
    }
    // Use index-based map for efficiency
    const indexByValue = new Map();
    for (let i = 0; i < oldList.length; i++) {
        // For duplicate values, the last index takes precedence (maintains existing behavior)
        indexByValue.set(oldList[i], i);
    }
    // Build new indexes array by matching values with old list
    for (let i = 0; i < newList.length; i++) {
        const newValue = newList[i];
        const oldIndex = indexByValue.get(newValue);
        if (typeof oldIndex === "undefined") {
            // New element
            const newListIndex = createListIndex(parentListIndex, i);
            newIndexes.push(newListIndex);
        }
        else {
            // Reuse existing element
            const existingListIndex = oldIndexes[oldIndex];
            // Update index if position changed
            if (existingListIndex.index !== i) {
                existingListIndex.index = i;
            }
            newIndexes.push(existingListIndex);
        }
    }
    return newIndexes;
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

function checkDependency(handler, address) {
    // 動的依存関係の登録
    if (handler.addressStackIndex >= 0) {
        const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
        const stateElement = handler.stateElement;
        if (lastInfo !== null) {
            if (stateElement.getterPaths.has(lastInfo.path) &&
                lastInfo.path !== address.pathInfo.path) {
                stateElement.addDynamicDependency(lastInfo.path, address.pathInfo.path);
            }
        }
    }
}

/**
 * getByRef.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByRef）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（trackedGetters対応時はsetTrackingでラップ）
 * - キャッシュ機構（handler.cacheable時はrefKeyで値をキャッシュ）
 * - getter経由で値取得時はSetStatePropertyRefSymbolでスコープを一時設定
 * - 存在しない場合は親infoやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - handler.engine.trackedGettersに含まれる場合はsetTrackingで依存追跡を有効化
 * - キャッシュ有効時はrefKeyで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */
function _getByAddress(target, address, receiver, handler, stateElement) {
    let value;
    // 親子関係のあるgetterが存在する場合は、外部依存から取得
    /*
      if (handler.engine.stateOutput.startsWith(ref.info) && handler.engine.pathManager.getters.intersection(ref.info.cumulativePathSet).size === 0) {
        return handler.engine.stateOutput.get(ref);
      }
    */
    // パターンがtargetに存在する場合はgetter経由で取得
    if (address.pathInfo.path in target) {
        if (stateElement.getterPaths.has(address.pathInfo.path)) {
            handler.pushAddress(address);
            try {
                return value = Reflect.get(target, address.pathInfo.path, receiver);
            }
            finally {
                handler.popAddress();
            }
        }
        else {
            return value = Reflect.get(target, address.pathInfo.path);
        }
    }
    else {
        const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined`);
        const parentValue = getByAddress(target, parentAddress, receiver, handler);
        const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
        if (lastSegment === "*") {
            const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined`);
            return value = Reflect.get(parentValue, index);
        }
        else {
            return value = Reflect.get(parentValue, lastSegment);
        }
    }
}
function _getByAddressWithCache(target, address, receiver, handler, stateElement, listable) {
    let value;
    let lastCacheEntry = stateElement.cache.get(address) ?? null;
    // Updateで変更が必要な可能性があるパスのバージョン情報
    const mightChangeByPath = handler.stateElement.mightChangeByPath;
    const versionRevision = mightChangeByPath.get(address.pathInfo.path);
    if (lastCacheEntry !== null) {
        const lastVersionInfo = lastCacheEntry.versionInfo;
        if (typeof versionRevision === "undefined") {
            // 更新なし
            return lastCacheEntry.value;
        }
        else {
            if (lastVersionInfo.version > handler.updater.versionInfo.version) {
                // これは非同期更新が発生した場合にありえる
                return lastCacheEntry.value;
            }
            if (lastVersionInfo.version < versionRevision.version || lastVersionInfo.revision < versionRevision.revision) ;
            else {
                return lastCacheEntry.value;
            }
        }
    }
    try {
        return value = _getByAddress(target, address, receiver, handler, stateElement);
    }
    finally {
        let newListIndexes = null;
        if (listable) {
            // リストインデックスを計算する必要がある
            const oldListIndexes = getListIndexesByList(lastCacheEntry?.value) ?? [];
            newListIndexes = createListIndexes(address.listIndex, lastCacheEntry?.value, value, oldListIndexes);
            setListIndexesByList(value, newListIndexes);
        }
        const cacheEntry = Object.assign(lastCacheEntry ?? {}, {
            value: value,
            versionInfo: { ...handler.updater.versionInfo },
        });
        stateElement.cache.set(address, cacheEntry);
    }
}
/**
 * 構造化パス情報(info, listIndex)をもとに、状態オブジェクト(target)から値を取得する。
 *
 * - 依存関係の自動登録（trackedGetters対応時はsetTrackingでラップ）
 * - キャッシュ機構（handler.cacheable時はrefKeyでキャッシュ）
 * - ネスト・ワイルドカード対応（親infoやlistIndexを辿って再帰的に値を取得）
 * - getter経由で値取得時はSetStatePropertyRefSymbolでスコープを一時設定
 *
 * @param target    状態オブジェクト
 * @param info      構造化パス情報
 * @param listIndex リストインデックス（多重ループ対応）
 * @param receiver  プロキシ
 * @param handler   状態ハンドラ
 * @returns         対象プロパティの値
 */
function getByAddress(target, address, receiver, handler) {
    checkDependency(handler, address);
    const stateElement = handler.stateElement;
    const listable = stateElement.listPaths.has(address.pathInfo.path);
    const cacheable = address.pathInfo.wildcardCount > 0 ||
        stateElement.getterPaths.has(address.pathInfo.path);
    if (cacheable || listable) {
        return _getByAddressWithCache(target, address, receiver, handler, stateElement, listable);
    }
    else {
        return _getByAddress(target, address, receiver, handler, stateElement);
    }
}

/**
 * getContextListIndex.ts
 *
 * StateClassの内部APIとして、現在のプロパティ参照スコープにおける
 * 指定したstructuredPath（ワイルドカード付きプロパティパス）に対応する
 * リストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - handlerの最後にアクセスされたStatePropertyRefから、指定パスに対応するリストインデックスを取得
 * - ワイルドカード階層に対応し、多重ループやネストした配列バインディングにも利用可能
 *
 * 設計ポイント:
 * - 直近のプロパティ参照情報を取得
 * - info.wildcardPathsからstructuredPathのインデックスを特定
 * - listIndex.at(index)で該当階層のリストインデックスを取得
 * - パスが一致しない場合や参照が存在しない場合はnullを返す
 */
function getContextListIndex(handler, structuredPath) {
    const address = handler.lastAddressStack;
    if (address == null) {
        return null;
    }
    if (address.pathInfo == null) {
        return null;
    }
    if (address.listIndex == null) {
        return null;
    }
    const index = address.pathInfo.indexByWildcardPath[structuredPath];
    if (typeof index !== "undefined") {
        return address.listIndex.at(index);
    }
    return null;
}

/**
 * getListIndex.ts
 *
 * StateClassの内部APIとして、パス情報（IResolvedPathInfo）から
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
 * - handler.engine.getListIndexesSetで各階層のリストインデックス集合を取得
 * - エラー時はraiseErrorで詳細な例外を投げる
 */
function getListIndex(target, resolvedAddress, receiver, handler) {
    const pathInfo = resolvedAddress.pathInfo;
    switch (resolvedAddress.wildcardType) {
        case "none":
            return null;
        case "context":
            const lastWildcardPath = pathInfo.wildcardPaths.at(-1) ??
                raiseError(`lastWildcardPath is null`);
            return getContextListIndex(handler, lastWildcardPath) ??
                raiseError(`ListIndex not found: ${resolvedAddress.pathInfo.path}`);
        case "all":
            let parentListIndex = null;
            for (let i = 0; i < resolvedAddress.pathInfo.wildcardCount; i++) {
                const wildcardParentPathInfo = resolvedAddress.pathInfo.wildcardParentPathInfos[i] ??
                    raiseError('wildcardParentPathInfo is null');
                const wildcardParentAddress = createStateAddress(wildcardParentPathInfo, parentListIndex);
                const wildcardParentValue = getByAddress(target, wildcardParentAddress, receiver, handler);
                const wildcardParentListIndexes = getListIndexesByList(wildcardParentValue) ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
                const wildcardIndex = resolvedAddress.wildcardIndexes[i] ??
                    raiseError('wildcardIndex is null');
                parentListIndex = wildcardParentListIndexes[wildcardIndex] ??
                    raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
            }
            return parentListIndex;
        case "partial":
            raiseError(`Partial wildcard type is not supported yet: ${resolvedAddress.pathInfo.path}`);
    }
}

/**
 * setLoopContext.ts
 *
 * StateClassの内部APIとして、ループコンテキスト（ILoopContext）を一時的に設定し、
 * 指定した非同期コールバックをそのスコープ内で実行するための関数です。
 *
 * 主な役割:
 * - handler.loopContextにループコンテキストを一時的に設定
 * - 既にループコンテキストが設定されている場合はエラーを投げる
 * - loopContextが存在する場合はasyncSetStatePropertyRefでスコープを設定しコールバックを実行
 * - loopContextがnullの場合はそのままコールバックを実行
 * - finallyで必ずloopContextをnullに戻し、スコープ外への影響を防止
 *
 * 設計ポイント:
 * - ループバインディングや多重ループ時のスコープ管理を安全に行う
 * - finallyで状態復元を保証し、例外発生時も安全
 * - 非同期処理にも対応
 */
async function setLoopContext(handler, loopContext, callback) {
    if (typeof handler.loopContext !== "undefined") {
        raiseError('already in loop context');
    }
    handler.setLoopContext(loopContext);
    try {
        if (loopContext) {
            const stateAddress = createStateAddress(loopContext.elementPathInfo, loopContext.listIndex);
            handler.pushAddress(stateAddress);
            try {
                return await callback();
            }
            finally {
                handler.popAddress();
            }
        }
        else {
            return await callback();
        }
    }
    finally {
        handler.clearLoopContext();
    }
}

/**
 * stackIndexByIndexName
 * インデックス名からスタックインデックスへのマッピング
 * $1 => 0
 * $2 => 1
 * :
 * ${i + 1} => i
 * i < MAX_WILDCARD_DEPTH
 */
const indexByIndexName = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
    indexByIndexName[`$${i + 1}`] = i;
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
    const index = indexByIndexName[prop];
    if (typeof index !== "undefined") {
        const listIndex = handler.lastAddressStack?.listIndex;
        return listIndex?.indexes[index] ?? raiseError(`ListIndex not found: ${prop.toString()}`);
    }
    if (typeof prop === "string") {
        if (prop === "$$setLoopContext") {
            return (loopContext, callback = async () => { }) => {
                return setLoopContext(handler, loopContext, callback);
            };
        }
        if (prop === "$$getByAddress") {
            return (address) => {
                return getByAddress(target, address, receiver, handler);
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

/**
 * setByRef.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）に値を設定するための関数（setByRef）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を設定（多重ループやワイルドカードにも対応）
 * - getter/setter経由で値設定時はSetStatePropertyRefSymbolでスコープを一時設定
 * - 存在しない場合は親infoやlistIndexを辿って再帰的に値を設定
 * - 設定後はengine.updater.addUpdatedStatePropertyRefValueで更新情報を登録
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値設定を実現
 * - finallyで必ず更新情報を登録し、再描画や依存解決に利用
 * - getter/setter経由のスコープ切り替えも考慮した設計
 */
function _setByAddress(target, address, value, receiver, handler) {
    try {
        // 親子関係のあるgetterが存在する場合は、外部依存を通じて値を設定
        /*
            if (handler.engine.stateOutput.startsWith(ref.info) && handler.engine.pathManager.setters.intersection(ref.info.cumulativePathSet).size === 0) {
              return handler.engine.stateOutput.set(ref, value);
            }
        */
        if (address.pathInfo.path in target) {
            // getterの中で参照の可能性があるので、addressをプッシュする
            handler.pushAddress(address);
            try {
                return Reflect.set(target, address.pathInfo.path, value, receiver);
            }
            finally {
                handler.popAddress();
            }
        }
        else {
            const parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined`);
            const parentValue = getByAddress(target, parentAddress, receiver, handler);
            const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
            if (lastSegment === "*") {
                const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined`);
                return Reflect.set(parentValue, index, value);
            }
            else {
                return Reflect.set(parentValue, lastSegment, value);
            }
        }
    }
    finally {
        handler.updater.enqueueUpdateAddress(address); // 更新情報を登録
    }
}
function _setByAddressWithSwap(target, address, value, receiver, handler) {
    // elementsの場合はswapInfoを準備
    let parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined`);
    let swapInfo = getSwapInfoByAddress(parentAddress);
    if (swapInfo === null) {
        const value = getByAddress(target, parentAddress, receiver, handler) ?? [];
        const listIndexes = getListIndexesByList(value) ?? [];
        swapInfo = {
            value: [...value], listIndexes: [...listIndexes]
        };
        setSwapInfoByAddress(parentAddress, swapInfo);
    }
    try {
        return _setByAddress(target, address, value, receiver, handler);
    }
    finally {
        const index = swapInfo.value.indexOf(value);
        const currentParentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
        const currentListIndexes = getListIndexesByList(currentParentValue) ?? [];
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
    const isElements = stateElement.elementPaths.has(address.pathInfo.path);
    const listable = stateElement.listPaths.has(address.pathInfo.path);
    const cacheable = address.pathInfo.wildcardCount > 0 ||
        stateElement.getterPaths.has(address.pathInfo.path);
    try {
        if (isElements) {
            return _setByAddressWithSwap(target, address, value, receiver, handler);
        }
        else {
            return _setByAddress(target, address, value, receiver, handler);
        }
    }
    finally {
        if (cacheable || listable) {
            let cacheEntry = stateElement.cache.get(address) ?? null;
            if (cacheEntry === null) {
                cacheEntry = {
                    value: value,
                    versionInfo: {
                        version: handler.updater.versionInfo.version,
                        revision: handler.updater.versionInfo.revision,
                    },
                };
                stateElement.cache.set(address, cacheEntry);
            }
            else {
                cacheEntry.value = value;
                cacheEntry.versionInfo.version = handler.updater.versionInfo.version;
                cacheEntry.versionInfo.revision = handler.updater.versionInfo.revision;
            }
        }
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

function applyChangeToAttribute(element, attrName, newValue) {
    if (element.getAttribute(attrName) !== newValue) {
        element.setAttribute(attrName, newValue);
    }
}

function applyChangeToClass(element, className, newValue) {
    if (typeof newValue !== "boolean") {
        raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
    }
    element.classList.toggle(className, newValue);
}

function applyChangeToProperty(element, propName, newValue) {
    const currentValue = element[propName];
    if (currentValue !== newValue) {
        element[propName] = newValue;
    }
}

function applyChangeToStyle(node, styleName, newValue) {
    const style = node.style;
    const currentValue = style[styleName];
    if (currentValue !== newValue) {
        style[styleName] = newValue;
    }
}

function applyChangeToSubObject(element, propSegment, newValue) {
    const firstSegment = propSegment[0];
    let subObject = element[firstSegment];
    for (let i = 1; i < propSegment.length - 1; i++) {
        const segment = propSegment[i];
        if (subObject == null) {
            return;
        }
        subObject = subObject[segment];
    }
    const oldValue = subObject[propSegment[propSegment.length - 1]];
    if (oldValue !== newValue) {
        subObject[propSegment[propSegment.length - 1]] = newValue;
    }
}

function applyChangeToElement(element, propSegment, newValue) {
    if (propSegment.length === 0) {
        return;
    }
    const firstSegment = propSegment[0];
    if (firstSegment === "class") {
        applyChangeToClass(element, propSegment[1], newValue);
    }
    else if (firstSegment === "attr") {
        applyChangeToAttribute(element, propSegment[1], newValue);
    }
    else if (firstSegment === "style") {
        applyChangeToStyle(element, propSegment[1], newValue);
    }
    else {
        if (propSegment.length === 1) {
            applyChangeToProperty(element, firstSegment, newValue);
        }
        else {
            applyChangeToSubObject(element, propSegment, newValue);
        }
    }
    // const remainingSegments = propSegment.slice(1);
}

function replaceToComment(bindingInfo) {
    const node = bindingInfo.node;
    const placeHolderNode = bindingInfo.placeHolderNode;
    if (node === placeHolderNode) {
        return;
    }
    if (node.parentNode === null) {
        // already replaced
        return;
    }
    node.parentNode.replaceChild(placeHolderNode, node);
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
                placeHolderNode: node,
            });
        }
        else {
            const placeHolderNode = document.createTextNode('');
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                placeHolderNode: placeHolderNode,
            });
        }
    }
    return bindingInfos;
}

const STRUCTURAL_BINDING_TYPE_SET = new Set([
    "if",
    "elseif",
    "else",
    "for",
]);

const trimFn = (s) => s.trim();

// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners
function parsePropPart(propPart) {
    const [propName, propModifiersText] = propPart.split('#').map(trimFn);
    const propSegments = propName.split('.').map(trimFn);
    const propModifiers = propModifiersText
        ? propModifiersText.split(',').map(trimFn)
        : [];
    return {
        propName,
        propSegments,
        propModifiers,
    };
}

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

// format: filterName(arg1,arg2) or filterName
function parseFilters(filterTextList) {
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
            const filterFn = builtinFilterFn(filterName, [])(outputBuiltinFilters);
            return {
                filterName: filterName,
                args: [],
                filterFn: filterFn,
            };
        }
        else {
            const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
            const args = parseFilterArgs(argsText);
            const filterName = filterText.substring(0, openParenIndex).trim();
            const filterFn = builtinFilterFn(filterName, args)(outputBuiltinFilters);
            return {
                filterName,
                args,
                filterFn,
            };
        }
    });
    return filters;
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
            filters = parseFilters(filterTexts);
            cacheFilterInfos.set(filtersText, filters);
        }
    }
    else {
        stateAndPath = statePart.trim();
    }
    const [statePathName, stateName = 'default'] = stateAndPath.split('@').map(trimFn);
    return {
        stateName,
        statePathName,
        statePathInfo: getPathInfo(statePathName),
        filters,
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
            return {
                propName: 'else',
                propSegments: ['else'],
                propModifiers: [],
                statePathName: '',
                statePathInfo: null,
                stateName: '',
                filters: [],
                bindingType: 'else',
            };
        }
        else if (propPart === 'if' || propPart === 'elseif' || propPart === 'for') {
            const stateResult = parseStatePart(statePart);
            return {
                propName: propPart,
                propSegments: [propPart],
                propModifiers: [],
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
function isCommentNode(node) {
    if (node.nodeType !== Node.COMMENT_NODE) {
        return false;
    }
    const commentNode = node;
    const text = commentNode.data.trim();
    const match = EMBEDDED_REGEX.exec(text);
    if (match === null) {
        return false;
    }
    // 空の場合は wcs-text として扱う
    const keyword = match[1] || config.commentTextPrefix;
    if (!bindingTypeKeywordSet.has(keyword)) {
        return false;
    }
    bindTextByNode.set(node, match[2]);
    return true;
}
function getCommentNodeBindText(node) {
    return bindTextByNode.get(node) || null;
}

function parseBindTextForEmbeddedNode(bindText) {
    const stateResult = parseStatePart(bindText);
    return {
        propName: 'textContent',
        propSegments: ['textContent'],
        propModifiers: [],
        ...stateResult,
        bindingType: 'text',
    };
}

const fragmentInfoByUUID = new Map();
function setFragmentInfoByUUID(uuid, fragmentInfo) {
    if (fragmentInfo === null) {
        fragmentInfoByUUID.delete(uuid);
    }
    else {
        fragmentInfoByUUID.set(uuid, fragmentInfo);
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
        const bindTextOrUUID = getCommentNodeBindText(node);
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
                return isCommentNode(node)
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

const registeredNodeSet = new WeakSet();
function collectNodesAndBindingInfos(root) {
    const subscriberNodes = getSubscriberNodes(root);
    const allBindings = [];
    for (const node of subscriberNodes) {
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            const parseBindingTextResults = getParseBindTextResults(node);
            const bindings = getBindingInfos(node, parseBindingTextResults);
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
            const bindingInfos = getBindingInfos(node, nodeInfo.parseBindTextResults);
            allBindings.push(...bindingInfos);
            nodes.push(node);
        }
    }
    return [nodes, allBindings];
}

const handlerByHandlerKey$1 = new Map();
const bindingInfoSetByHandlerKey$1 = new Map();
function getHandlerKey$1(bindingInfo) {
    return `${bindingInfo.stateName}::${bindingInfo.statePathName}`;
}
const stateEventHandlerFunction = (stateName, handlerName) => (event) => {
    const stateElement = getStateElementByName(stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for event handler.`);
    }
    stateElement.createState(async (state) => {
        const handler = state[handlerName];
        if (typeof handler !== "function") {
            raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
        }
        return handler.call(state, event);
    });
};
function attachEventHandler(bindingInfo) {
    if (!bindingInfo.propName.startsWith("on")) {
        return false;
    }
    const key = getHandlerKey$1(bindingInfo);
    let stateEventHandler = handlerByHandlerKey$1.get(key);
    if (typeof stateEventHandler === "undefined") {
        stateEventHandler = stateEventHandlerFunction(bindingInfo.stateName, bindingInfo.statePathName);
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

const loopContextByNode = new WeakMap();
function getLoopContextByNode(node) {
    return loopContextByNode.get(node) || null;
}
function setLoopContextByNode(node, loopContext) {
    if (loopContext === null) {
        loopContextByNode.delete(node);
        return;
    }
    loopContextByNode.set(node, loopContext);
}

const handlerByHandlerKey = new Map();
const bindingInfoSetByHandlerKey = new Map();
function getHandlerKey(bindingInfo, eventName) {
    return `${bindingInfo.stateName}::${bindingInfo.propName}::${bindingInfo.statePathName}::${eventName}`;
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
const twowayEventHandlerFunction = (stateName, propName, statePathName) => (event) => {
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
    const stateElement = getStateElementByName(stateName);
    if (stateElement === null) {
        raiseError(`State element with name "${stateName}" not found for two-way binding.`);
    }
    const loopContext = getLoopContextByNode(node);
    stateElement.createState(async (state) => {
        state.$$setLoopContext(loopContext, async () => {
            state[statePathName] = newValue;
        });
    });
};
function attachTwowayEventHandler(bindingInfo) {
    if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
        const eventName = getEventName(bindingInfo);
        const key = getHandlerKey(bindingInfo, eventName);
        let twowayEventHandler = handlerByHandlerKey.get(key);
        if (typeof twowayEventHandler === "undefined") {
            twowayEventHandler = twowayEventHandlerFunction(bindingInfo.stateName, bindingInfo.propName, bindingInfo.statePathName);
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

async function _initializeBindings(allBindings) {
    const applyInfoList = [];
    const bindingsByStateElement = new Map();
    for (const bindingInfo of allBindings) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
        }
        await stateElement.initializePromise;
        // replace to comment node
        replaceToComment(bindingInfo);
        // event
        if (attachEventHandler(bindingInfo)) {
            continue;
        }
        // two-way binding
        attachTwowayEventHandler(bindingInfo);
        // register binding
        stateElement.addBindingInfo(bindingInfo);
        // group by state element
        let bindings = bindingsByStateElement.get(stateElement);
        if (typeof bindings === "undefined") {
            bindingsByStateElement.set(stateElement, [bindingInfo]);
        }
        else {
            bindings.push(bindingInfo);
        }
    }
    // get apply values from cache and state
    for (const [stateElement, bindings] of bindingsByStateElement.entries()) {
        const cacheValueByPath = new Map();
        await stateElement.createState(async (state) => {
            for (const bindingInfo of bindings) {
                let cacheValue = cacheValueByPath.get(bindingInfo.statePathName);
                if (typeof cacheValue === "undefined") {
                    const loopContext = getLoopContextByNode(bindingInfo.node);
                    cacheValue = await state.$$setLoopContext(loopContext, () => {
                        return state[bindingInfo.statePathName];
                    });
                    cacheValueByPath.set(bindingInfo.statePathName, cacheValue);
                }
                applyInfoList.push({ bindingInfo, value: cacheValue });
            }
        });
    }
    // apply all at once
    for (const applyInfo of applyInfoList) {
        applyChange(applyInfo.bindingInfo, applyInfo.value);
    }
}
async function initializeBindings(root, parentLoopContext) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
    for (const node of subscriberNodes) {
        setLoopContextByNode(node, parentLoopContext);
    }
    await _initializeBindings(allBindings);
}
async function initializeBindingsByFragment(root, nodeInfos, parentLoopContext) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
    for (const node of subscriberNodes) {
        setLoopContextByNode(node, parentLoopContext);
    }
    await _initializeBindings(allBindings);
}

class Content {
    _content;
    _childNodeArray = [];
    _firstNode = null;
    _lastNode = null;
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
    mountAfter(targetNode) {
        const parentNode = targetNode.parentNode;
        const nextSibling = targetNode.nextSibling;
        if (parentNode) {
            this._childNodeArray.forEach((node) => {
                parentNode.insertBefore(node, nextSibling);
            });
        }
    }
    unmount() {
        this._childNodeArray.forEach((node) => {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
    }
}
function createContent(content) {
    return new Content(content);
}

const lastValueByNode = new WeakMap();
const lastContentsByNode = new WeakMap();
function applyChangeToFor(node, uuid, _newValue) {
    const fragmentInfo = getFragmentInfoByUUID(uuid);
    if (!fragmentInfo) {
        raiseError(`Fragment with UUID "${uuid}" not found.`);
    }
    lastValueByNode.get(node) ?? [];
    const newValue = Array.isArray(_newValue) ? _newValue : [];
    const listIndexes = getListIndexesByList(newValue) || [];
    const lastContents = lastContentsByNode.get(node) || [];
    for (const content of lastContents) {
        content.unmount();
    }
    const newContents = [];
    let lastNode = node;
    const listPathInfo = fragmentInfo.parseBindTextResult.statePathInfo;
    if (!listPathInfo) {
        raiseError(`List path info not found in fragment bind text result.`);
    }
    const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
    const stateName = fragmentInfo.parseBindTextResult.stateName;
    const stateElement = getStateElementByName(stateName);
    if (!stateElement) {
        raiseError(`State element with name "${stateName}" not found.`);
    }
    const loopContextStack = stateElement.loopContextStack;
    for (const index of listIndexes) {
        loopContextStack.createLoopContext(elementPathInfo, index, (loopContext) => {
            const cloneFragment = document.importNode(fragmentInfo.fragment, true);
            initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, loopContext);
            const content = createContent(cloneFragment);
            content.mountAfter(lastNode);
            lastNode = content.lastNode || lastNode;
            newContents.push(content);
        });
    }
    lastContentsByNode.set(node, newContents);
    lastValueByNode.set(node, newValue);
}

function applyChangeToText(node, newValue) {
    if (node.nodeValue !== newValue) {
        node.nodeValue = newValue;
    }
}

function applyChange(bindingInfo, newValue) {
    let filteredValue = newValue;
    for (const filter of bindingInfo.filters) {
        filteredValue = filter.filterFn(filteredValue);
    }
    if (bindingInfo.bindingType === "text") {
        applyChangeToText(bindingInfo.placeHolderNode, filteredValue);
    }
    else if (bindingInfo.bindingType === "prop") {
        applyChangeToElement(bindingInfo.node, bindingInfo.propSegments, filteredValue);
    }
    else if (bindingInfo.bindingType === "for") {
        if (!bindingInfo.uuid) {
            throw new Error(`BindingInfo for 'for' binding must have a UUID.`);
        }
        applyChangeToFor(bindingInfo.node, bindingInfo.uuid, filteredValue);
    }
}

class Updater {
    _stateName;
    _versionInfo;
    _updateAddresses = [];
    _state;
    _applyPromise = null;
    _applyResolve = null;
    _stateElement;
    constructor(stateName, state, version) {
        this._versionInfo = {
            version: version,
            revision: 0,
        };
        this._stateName = stateName;
        this._state = state;
        this._stateElement = getStateElementByName(this._stateName) ?? raiseError(`Updater: State element with name "${this._stateName}" not found.`);
    }
    get versionInfo() {
        return this._versionInfo;
    }
    enqueueUpdateAddress(address) {
        const stateElement = this._stateElement;
        this._updateAddresses.push(address);
        this._versionInfo.revision++;
        stateElement.mightChangeByPath.set(address.pathInfo.path, {
            version: this._versionInfo.version,
            revision: this._versionInfo.revision,
        });
        if (this._applyPromise !== null) {
            return;
        }
        this._applyPromise = new Promise((resolve) => {
            this._applyResolve = resolve;
        });
        queueMicrotask(() => {
            this._processUpdates();
        });
    }
    _processUpdates() {
        const stateElement = this._stateElement;
        const addressSet = new Set(this._updateAddresses);
        this._updateAddresses.length = 0;
        const applyList = [];
        for (const address of addressSet) {
            const value = this._state.$$getByAddress(address);
            const bindingInfos = stateElement.bindingInfosByAddress.get(address);
            if (typeof bindingInfos === "undefined") {
                continue;
            }
            for (const bindingInfo of bindingInfos) {
                applyList.push({
                    bindingInfo,
                    value,
                });
            }
        }
        for (const applyInfo of applyList) {
            const { bindingInfo, value } = applyInfo;
            applyChange(bindingInfo, value);
        }
        if (this._applyResolve !== null) {
            this._applyResolve();
            this._applyResolve = null;
            this._applyPromise = null;
        }
    }
}
function createUpdater(stateName, state, version) {
    return new Updater(stateName, state, version);
}

class StateHandler {
    _stateElement;
    _stateName;
    _addressStack = [];
    _addressStackIndex = -1;
    _updater;
    _loopContext;
    constructor(stateName) {
        this._stateName = stateName;
        const stateElement = getStateElementByName(this._stateName);
        if (stateElement === null) {
            raiseError(`StateHandler: State element with name "${this._stateName}" not found.`);
        }
        this._stateElement = stateElement;
    }
    get stateName() {
        return this._stateName;
    }
    get stateElement() {
        return this._stateElement;
    }
    get lastAddressStack() {
        if (this._addressStackIndex >= 0) {
            return this._addressStack[this._addressStackIndex];
        }
        else {
            return null;
        }
    }
    get addressStack() {
        return this._addressStack;
    }
    get addressStackIndex() {
        return this._addressStackIndex;
    }
    get updater() {
        if (typeof this._updater === "undefined") {
            raiseError(`StateHandler: updater is not set yet.`);
        }
        return this._updater;
    }
    set updater(value) {
        this._updater = value;
    }
    get loopContext() {
        return this._loopContext;
    }
    pushAddress(address) {
        this._addressStackIndex++;
        if (this._addressStackIndex >= this._addressStack.length) {
            this._addressStack.push(address);
        }
        else {
            this._addressStack[this._addressStackIndex] = address;
        }
    }
    popAddress() {
        if (this._addressStackIndex < 0) {
            return null;
        }
        const address = this._addressStack[this._addressStackIndex];
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
        return set(target, prop, value, receiver, this);
    }
    has(target, prop) {
        return Reflect.has(target, prop);
        //    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
    }
}
function createStateProxy(state, stateName) {
    const handler = new StateHandler(stateName);
    const stateProxy = new Proxy(state, handler);
    handler.updater = createUpdater(stateName, stateProxy, handler.stateElement.nextVersion());
    return stateProxy;
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
        const bindingWildCardParentPathSet = bindingInfo.statePathInfo?.wildcardParentPathSet;
        if (typeof bindingWildCardParentPathSet === "undefined") {
            raiseError(`BindingInfo does not have statePathInfo for list index retrieval.`);
        }
        const loopContextWildcardParentPathSet = loopContext.elementPathInfo.wildcardParentPathSet;
        const matchPath = bindingWildCardParentPathSet.intersection(loopContextWildcardParentPathSet);
        const wildcardLen = matchPath.size;
        if (wildcardLen > 0) {
            listIndex = loopContext.listIndex.at(wildcardLen - 1);
        }
        return listIndex;
    }
    finally {
        listIndexByBindingInfo.set(bindingInfo, listIndex);
    }
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
    const descriptors = getAllPropertyDescriptors(state);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (typeof descriptor.get === "function") {
            getterPaths.add(key);
        }
    }
    return {
        getterPaths,
    };
}
class State extends HTMLElement {
    __state;
    _proxyState;
    _name = 'default';
    _initialized = false;
    _bindingInfosByAddress = new Map();
    _initializePromise;
    _resolveInitialize = null;
    _listPaths = new Set();
    _elementPaths = new Set();
    _getterPaths = new Set();
    _isLoadingState = false;
    _isLoadedState = false;
    _loopContextStack = createLoopContextStack();
    _cache = new Map();
    _mightChangeByPath = new Map();
    _dynamicDependency = new Map();
    _staticDependency = new Map();
    _pathSet = new Set();
    _version = 0;
    static get observedAttributes() { return ['name', 'src', 'state']; }
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
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
        this._proxyState = undefined;
        const stateInfo = getStateInfo(value);
        for (const path of stateInfo.getterPaths) {
            this._getterPaths.add(path);
        }
    }
    get name() {
        return this._name;
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'name' && oldValue !== newValue) {
            setStateElementByName(this._name, null);
            this._name = newValue;
            setStateElementByName(this._name, this);
        }
        if (name === 'state' && oldValue !== newValue) {
            if (this._isLoadedState) {
                raiseError(`The state has already been loaded. The 'state' attribute cannot be changed multiple times.`);
            }
            if (this._isLoadingState) {
                raiseError(`The state is currently loading. The 'state' attribute cannot be changed during loading.`);
            }
            this._state = loadFromScriptJson(newValue);
            this._isLoadedState = true;
        }
        if (name === 'src' && oldValue !== newValue) {
            if (this._isLoadedState) {
                raiseError(`The state has already been loaded. The 'src' attribute cannot be changed multiple times.`);
            }
            if (this._isLoadingState) {
                raiseError(`The state is currently loading. The 'src' attribute cannot be changed during loading.`);
            }
            if (newValue && newValue.endsWith('.json')) {
                this._isLoadingState = true;
                loadFromJsonFile(newValue).then((state) => {
                    this._isLoadedState = true;
                    this._state = state;
                }).finally(() => {
                    this._isLoadingState = false;
                });
            }
            else if (newValue && newValue.endsWith('.js')) {
                this._isLoadingState = true;
                loadFromScriptFile(newValue).then((state) => {
                    this._isLoadedState = true;
                    this._state = state;
                }).finally(() => {
                    this._isLoadingState = false;
                });
            }
            else {
                raiseError(`Unsupported src file type: ${newValue}`);
            }
        }
    }
    async _initialize() {
        if (!this._isLoadedState && !this._isLoadingState) {
            this._isLoadingState = true;
            try {
                const script = this.querySelector('script[type="module"]');
                if (script) {
                    this._state = await loadFromInnerScript(script, `state#${this._name}`);
                    this._isLoadedState = true;
                }
            }
            catch (e) {
                raiseError(`Failed to load state from inner script: ${e.message}`);
            }
            finally {
                this._isLoadingState = false;
            }
        }
        if (typeof this._state === "undefined") {
            this._state = {};
        }
    }
    async connectedCallback() {
        if (!this._initialized) {
            await this._initialize();
            this._initialized = true;
            this._resolveInitialize?.();
        }
    }
    disconnectedCallback() {
        setStateElementByName(this._name, null);
    }
    get bindingInfosByAddress() {
        return this._bindingInfosByAddress;
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
    get loopContextStack() {
        return this._loopContextStack;
    }
    get cache() {
        return this._cache;
    }
    get mightChangeByPath() {
        return this._mightChangeByPath;
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
    addDynamicDependency(fromPath, toPath) {
        const deps = this._dynamicDependency.get(fromPath);
        if (typeof deps === "undefined") {
            this._dynamicDependency.set(fromPath, [toPath]);
        }
        else {
            if (!deps.includes(toPath)) {
                deps.push(toPath);
            }
        }
    }
    addStaticDependency(fromPath, toPath) {
        const deps = this._staticDependency.get(fromPath);
        if (typeof deps === "undefined") {
            this._staticDependency.set(fromPath, [toPath]);
        }
        else {
            if (!deps.includes(toPath)) {
                deps.push(toPath);
            }
        }
    }
    addBindingInfo(bindingInfo) {
        const listIndex = getListIndexByBindingInfo(bindingInfo);
        const address = createStateAddress(bindingInfo.statePathInfo, listIndex);
        const path = bindingInfo.statePathName;
        const bindingInfos = this._bindingInfosByAddress.get(address);
        if (typeof bindingInfos === "undefined") {
            this._bindingInfosByAddress.set(address, [bindingInfo]);
        }
        else {
            bindingInfos.push(bindingInfo);
        }
        if (bindingInfo.bindingType === "for") {
            this._listPaths.add(path);
            this._elementPaths.add(path + '.' + WILDCARD);
        }
        if (!this._pathSet.has(path)) {
            const pathInfo = getPathInfo(path);
            this._pathSet.add(path);
            if (pathInfo.parentPath !== null) {
                this.addStaticDependency(pathInfo.parentPath, path);
            }
        }
    }
    deleteBindingInfo(bindingInfo) {
        const listIndex = getListIndexByBindingInfo(bindingInfo);
        const address = createStateAddress(bindingInfo.statePathInfo, listIndex);
        const bindingInfos = this._bindingInfosByAddress.get(address);
        if (typeof bindingInfos !== "undefined") {
            const index = bindingInfos.indexOf(bindingInfo);
            if (index !== -1) {
                bindingInfos.splice(index, 1);
            }
        }
    }
    async createState(callback) {
        const stateProxy = createStateProxy(this._state, this._name);
        return callback(stateProxy);
    }
    nextVersion() {
        this._version++;
        return this._version;
    }
}

function registerComponents() {
    // Register custom element
    if (!customElements.get(config.tagNames.state)) {
        customElements.define(config.tagNames.state, State);
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

const keywordByBindingType = new Map([
    ["for", config.commentForPrefix],
    ["if", config.commentIfPrefix],
    ["elseif", config.commentElseIfPrefix],
    ["else", config.commentElsePrefix],
]);
function collectStructuralFragments(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
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
    while (walker.nextNode()) {
        const template = walker.currentNode;
        const bindText = template.getAttribute(config.bindAttributeName) || '';
        const parseBindTextResults = parseBindTextsForElement(bindText);
        const parseBindTextResult = parseBindTextResults[0];
        const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
        if (typeof keyword === 'undefined') {
            continue;
        }
        const fragment = template.content;
        const uuid = getUUID();
        const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
        template.replaceWith(placeHolder);
        collectStructuralFragments(fragment);
        // after replacing and collect node infos on child fragment
        setFragmentInfoByUUID(uuid, {
            fragment: fragment,
            parseBindTextResult: parseBindTextResult,
            nodeInfos: getFragmentNodeInfos(fragment),
        });
    }
}

function registerHandler() {
    document.addEventListener("DOMContentLoaded", async () => {
        collectStructuralFragments(document);
        await initializeBindings(document.body, null);
    });
}

function bootstrapState() {
    registerComponents();
    registerHandler();
}

export { bootstrapState };
//# sourceMappingURL=index.esm.js.map
