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

const DELIMITER = '.';
const WILDCARD = '*';

const _cache = {};
function getPathInfo(path) {
    if (_cache[path]) {
        return _cache[path];
    }
    const pathInfo = new PathInfo(path);
    _cache[path] = pathInfo;
    return pathInfo;
}
class PathInfo {
    path = "";
    segments = [];
    wildcardCount;
    wildcardPositions;
    wildcardPaths;
    wildcardPathSet;
    wildcardParentPaths;
    wildcardParentPathSet;
    wildcardPathInfos;
    wildcardPathInfoSet;
    wildcardParentPathInfos;
    wildcardParentPathInfoSet;
    _parentPathInfo = undefined;
    constructor(path) {
        this.path = path;
        this.segments = path.split(DELIMITER).filter(seg => seg.length > 0);
        this.wildcardPositions = this.segments
            .map((seg, index) => (seg === WILDCARD ? index : -1))
            .filter(index => index !== -1);
        this.wildcardCount = this.wildcardPositions.length;
        this.wildcardPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos + 1).join(DELIMITER));
        this.wildcardPathSet = new Set(this.wildcardPaths);
        this.wildcardParentPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos).join(DELIMITER));
        this.wildcardParentPathSet = new Set(this.wildcardParentPaths);
        this.wildcardPathInfos = this.wildcardPaths.map(p => getPathInfo(p));
        this.wildcardPathInfoSet = new Set(this.wildcardPathInfos);
        this.wildcardParentPathInfos = this.wildcardParentPaths.map(p => getPathInfo(p));
        this.wildcardParentPathInfoSet = new Set(this.wildcardParentPathInfos);
    }
    get parentPathInfo() {
        if (typeof this._parentPathInfo !== "undefined") {
            return this._parentPathInfo;
        }
        if (this.segments.length === 0) {
            return null;
        }
        const parentSegments = this.segments.slice(0, -1);
        const parentPath = parentSegments.join(DELIMITER);
        this._parentPathInfo = getPathInfo(parentPath);
        return this._parentPathInfo;
    }
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

function createListIndexes(list, parentListIndex) {
    const listIndexes = [];
    for (let i = 0; i < list.length; i++) {
        listIndexes.push(createListIndex(parentListIndex, i));
    }
    return listIndexes;
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
const EMBEDDED_REGEX = new RegExp(`^\\s*@@\\s*(.+?)\\s*:\\s*(.+?)\\s*$`);
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
    if (!bindingTypeKeywordSet.has(match[1])) {
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
    const handler = stateElement.state[handlerName];
    if (typeof handler !== "function") {
        raiseError(`Handler "${handlerName}" is not a function on state "${stateName}".`);
    }
    return handler.call(stateElement.state, event);
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

const listIndexByNode = new WeakMap();
function getListIndexByNode(node) {
    return listIndexByNode.get(node) || null;
}
function setListIndexByNode(node, listIndex) {
    if (listIndex === null) {
        listIndexByNode.delete(node);
        return;
    }
    listIndexByNode.set(node, listIndex);
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
    const state = stateElement.state;
    const listIndex = getListIndexByNode(node);
    state.$stack(listIndex, () => {
        state[statePathName] = newValue;
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
    const cacheValueByPathByStateElement = new Map();
    for (const bindingInfo of allBindings) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
        }
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
        // get cache value
        let cacheValueByPath = cacheValueByPathByStateElement.get(stateElement);
        if (typeof cacheValueByPath === "undefined") {
            cacheValueByPath = new Map();
            cacheValueByPathByStateElement.set(stateElement, cacheValueByPath);
        }
        const cacheValue = cacheValueByPath.get(bindingInfo.statePathName);
        if (typeof cacheValue !== "undefined") {
            // apply cached value
            applyInfoList.push({ bindingInfo, value: cacheValue });
            continue;
        }
        // apply initial value
        await stateElement.initializePromise;
        const listIndex = getListIndexByNode(bindingInfo.node);
        const state = stateElement.state;
        const value = state.$stack(listIndex, () => {
            return state[bindingInfo.statePathName];
        });
        applyInfoList.push({ bindingInfo, value });
        // set cache value
        cacheValueByPath.set(bindingInfo.statePathName, value);
    }
    // apply all at once
    for (const applyInfo of applyInfoList) {
        applyChange(applyInfo.bindingInfo, applyInfo.value);
    }
}
async function initializeBindings(root, parentListIndex) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfos(root);
    for (const node of subscriberNodes) {
    }
    await _initializeBindings(allBindings);
}
async function initializeBindingsByFragment(root, nodeInfos, parentListIndex) {
    const [subscriberNodes, allBindings] = collectNodesAndBindingInfosByFragment(root, nodeInfos);
    for (const node of subscriberNodes) {
        if (parentListIndex !== null) {
            setListIndexByNode(node, parentListIndex);
        }
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
    const stateName = fragmentInfo.parseBindTextResult.stateName;
    const stateElement = getStateElementByName(stateName);
    if (!stateElement) {
        raiseError(`State element with name "${stateName}" not found.`);
    }
    const loopContextStack = stateElement.loopContextStack;
    for (const index of listIndexes) {
        loopContextStack.createLoopContext(listPathInfo, index, (_loopContext) => {
            const cloneFragment = document.importNode(fragmentInfo.fragment, true);
            initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, index);
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

class StateHandler {
    _bindingInfosByPath;
    _listPaths;
    _stackListIndex = [];
    constructor(bindingInfosByPath, listPaths) {
        this._bindingInfosByPath = bindingInfosByPath;
        this._listPaths = listPaths;
    }
    _getNestValue(target, pathInfo, receiver) {
        let curPathInfo = pathInfo;
        if (curPathInfo.path in target) {
            return Reflect.get(target, curPathInfo.path, receiver);
        }
        const parentPathInfo = curPathInfo.parentPathInfo;
        if (parentPathInfo === null) {
            return undefined;
        }
        const parent = this._getNestValue(target, parentPathInfo, receiver);
        if (parent == null) {
            console.warn(`[@wcstack/state] Cannot access property "${pathInfo.path}" - parent is null or undefined.`);
            return undefined;
        }
        const lastSegment = curPathInfo.segments[curPathInfo.segments.length - 1];
        if (lastSegment === '*') {
            const wildcardCount = curPathInfo.wildcardPositions.length;
            if (wildcardCount === 0 || wildcardCount > this._stackListIndex.length) {
                console.warn(`[@wcstack/state] Cannot get value for path "${pathInfo.path}" - invalid wildcard depth.`);
                return undefined;
            }
            const listIndex = this._stackListIndex[wildcardCount - 1];
            if (listIndex === null) {
                console.warn(`[@wcstack/state] Cannot get value for path "${pathInfo.path}" because list index is null.`);
                return undefined;
            }
            return Reflect.get(parent, listIndex.index);
        }
        else if (lastSegment in parent) {
            return Reflect.get(parent, lastSegment);
        }
        else {
            console.warn(`[@wcstack/state] Property "${pathInfo.path}" does not exist on state.`);
            return undefined;
        }
    }
    $stack(listIndex, callback, receiver) {
        this._stackListIndex.push(listIndex);
        try {
            return Reflect.apply(callback, receiver, []);
        }
        finally {
            this._stackListIndex.pop();
        }
    }
    get(target, prop, receiver) {
        let value;
        try {
            if (typeof prop === "string") {
                if (prop === "$stack") {
                    return (listIndex, callback) => {
                        return this.$stack(listIndex, callback, receiver);
                    };
                }
                const pathInfo = getPathInfo(prop);
                if (pathInfo.segments.length > 1) {
                    return (value = this._getNestValue(target, pathInfo, receiver));
                }
            }
            if (prop in target) {
                return (value = Reflect.get(target, prop, receiver));
            }
            else {
                console.warn(`[@wcstack/state] Property "${String(prop)}" does not exist on state.`);
                return undefined;
            }
        }
        finally {
            if (typeof prop === "string") {
                if (this._listPaths.has(prop) && value != null) {
                    if (getListIndexesByList(value) === null) {
                        const parentListIndex = this._stackListIndex.length > 0
                            ? this._stackListIndex[this._stackListIndex.length - 1]
                            : null;
                        const listIndexes = createListIndexes(value, parentListIndex);
                        setListIndexesByList(value, listIndexes);
                    }
                }
            }
        }
    }
    set(target, prop, value, receiver) {
        let result = false;
        if (typeof prop === "string") {
            const pathInfo = getPathInfo(prop);
            if (pathInfo.segments.length > 1) {
                if (pathInfo.parentPathInfo === null) {
                    return false;
                }
                const parent = this._getNestValue(target, pathInfo.parentPathInfo, receiver);
                if (parent == null) {
                    console.warn(`[@wcstack/state] Cannot set property "${pathInfo.path}" - parent is null or undefined.`);
                    return false;
                }
                const lastSegment = pathInfo.segments[pathInfo.segments.length - 1];
                result = Reflect.set(parent, lastSegment, value);
            }
            else {
                result = Reflect.set(target, prop, value, receiver);
            }
            if (this._bindingInfosByPath.has(String(prop))) {
                const bindingInfos = this._bindingInfosByPath.get(String(prop)) || [];
                for (const bindingInfo of bindingInfos) {
                    applyChange(bindingInfo, value);
                }
            }
        }
        else {
            result = Reflect.set(target, prop, value, receiver);
        }
        if (typeof prop === "string") {
            if (this._listPaths.has(prop) && value != null) {
                const parentListIndex = this._stackListIndex.length > 0
                    ? this._stackListIndex[this._stackListIndex.length - 1]
                    : null;
                const listIndexes = createListIndexes(value, parentListIndex);
                setListIndexesByList(value, listIndexes);
            }
        }
        return result;
    }
}
function createStateProxy(state, bindingInfosByPath, listPaths) {
    return new Proxy(state, new StateHandler(bindingInfosByPath, listPaths));
}

class LoopContextStack {
    _loopContextStack = [];
    createLoopContext(listPathInfo, listIndex, callback) {
        const lastLoopContext = this._loopContextStack[this._loopContextStack.length - 1];
        if (typeof lastLoopContext !== "undefined") {
            if (lastLoopContext.listPathInfo.wildcardCount + 1 !== listPathInfo.wildcardCount) {
                raiseError(`Cannot push loop context for a list whose wildcard count is not exactly one more than the current active loop context.`);
            }
            const lastWildcardParentPathInfo = listPathInfo.wildcardParentPathInfos[listPathInfo.wildcardParentPathInfos.length - 1];
            if (lastLoopContext.listPathInfo !== lastWildcardParentPathInfo) {
                raiseError(`Cannot push loop context for a list whose parent wildcard path info does not match the current active loop context.`);
            }
        }
        else {
            if (listPathInfo.wildcardPositions.length > 0) {
                raiseError(`Cannot push loop context for a list with wildcard positions when there is no active loop context.`);
            }
        }
        const loopContext = { listPathInfo, listIndex };
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

class State extends HTMLElement {
    _state;
    _proxyState;
    _name = 'default';
    _initialized = false;
    _bindingInfosByPath = new Map();
    _initializePromise;
    _resolveInitialize = null;
    _listPaths = new Set();
    _isLoadingState = false;
    _isLoadedState = false;
    _loopContextStack = createLoopContextStack();
    static get observedAttributes() { return ['name', 'src', 'state']; }
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
    }
    get state() {
        if (typeof this._state === "undefined") {
            raiseError(`${config.tagNames.state} _state is not initialized yet.`);
        }
        if (typeof this._proxyState === "undefined") {
            this._proxyState = createStateProxy(this._state, this._bindingInfosByPath, this._listPaths);
        }
        return this._proxyState;
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
    get bindingInfosByPath() {
        return this._bindingInfosByPath;
    }
    get initializePromise() {
        return this._initializePromise;
    }
    get listPaths() {
        return this._listPaths;
    }
    get loopContextStack() {
        return this._loopContextStack;
    }
    addBindingInfo(bindingInfo) {
        const path = bindingInfo.statePathName;
        const bindingInfos = this._bindingInfosByPath.get(path);
        if (typeof bindingInfos === "undefined") {
            this._bindingInfosByPath.set(path, [bindingInfo]);
        }
        else {
            bindingInfos.push(bindingInfo);
        }
        if (bindingInfo.bindingType === "for") {
            this._listPaths.add(path);
        }
    }
    deleteBindingInfo(bindingInfo) {
        const path = bindingInfo.statePathName;
        const bindingInfos = this._bindingInfosByPath.get(path);
        if (typeof bindingInfos !== "undefined") {
            const index = bindingInfos.indexOf(bindingInfo);
            if (index !== -1) {
                bindingInfos.splice(index, 1);
            }
        }
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
        await initializeBindings(document.body);
    });
}

function bootstrapState() {
    registerComponents();
    registerHandler();
}

export { bootstrapState };
//# sourceMappingURL=index.esm.js.map
