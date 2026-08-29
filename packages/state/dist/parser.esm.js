const DELIMITER = '.';
const WILDCARD = '*';
const MAX_WILDCARD_DEPTH = 128;
// data-wcs バインディング構文 `[prop][#mod]: [path][@state][|filter...]` の区切り文字（単一正本）。
// これらは「死守の壁（構文契約）」であり値は不変。manifest.syntax.delimiters で公開される。
const BINDING_SEPARATOR = ';'; // 複数バインディングの区切り
const PROP_VALUE_SEPARATOR = ':'; // 左辺(prop)と右辺(path)の区切り
const MODIFIER_SEPARATOR = '#'; // prop と修飾子の区切り
const STATE_NAME_SEPARATOR = '@'; // path と @stateName の区切り
const FILTER_SEPARATOR = '|'; // フィルタパイプの区切り
// bindingType 判別と左辺 namespace の語彙（単一正本）。manifest.syntax.bindingTypes で
// 公開される。パーサ（parseBindTextsForElement）とイベント層はこの定数に分岐する。
// apply 層のディスパッチマップ（apply/applyChange.ts の applyChangeByFirstSegment）の
// キー集合との一致は __tests__/manifest.test.ts の drift テストが強制する —
// manifest エントリ（DOM 非依存）から apply 層を import しないための分離。
const ELSE_KEYWORD = 'else';
const SPREAD_PROP = '...';
const EVENT_PROP_PREFIX = 'on';
const EVENT_TOKEN_NAMESPACE = 'eventToken';
// リストインデックス参照名（`$1`..`$N`）の接頭辞（単一正本）。
// manifest.syntax.indexParam で公開される。
const INDEX_PARAM_PREFIX = '$';
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
    tmpIndexByIndexName[`${INDEX_PARAM_PREFIX}${i + 1}`] = i;
}
Object.freeze(tmpIndexByIndexName);

const _cache = new Map();
/**
 * **tooling 専用**（`@wcstack/state/parser` の clearParserCaches からのみ呼ぶ）。
 * ランタイム文脈で呼んではならない — PathInfo のインスタンス同一性は正規化キー
 * （依存グラフ・アドレス比較）の前提であり、クリアすると同一パスの新旧インスタンスが
 * 併存して identity 比較が黙って壊れる。言語サーバー等の長時間プロセスが、編集中の
 * 中間パス（`user.n` 等）の恒久 intern によるメモリ単調増加を断つための出口。
 */
function clearPathInfoCacheForTooling() {
    _cache.clear();
}
let id = 0;
function getPathInfo(path) {
    let pathInfo = _cache.get(path);
    if (typeof pathInfo !== "undefined") {
        return pathInfo;
    }
    pathInfo = Object.freeze(new PathInfo(path));
    _cache.set(path, pathInfo);
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
 * errorGuidance.ts — エラーメッセージへの self-fix 誘導（GTM 2-5 /
 * docs/static-wiring-dx-design.md §3）。
 *
 * コンソールは「書き手（人間・AI とも）が誤った瞬間に必ず読む面」なので、
 * (a) did-you-mean 候補 (b) lint への誘導 をエラーメッセージ自体に埋め込む。
 * ここの関数は全て**エラーパスでのみ**呼ばれる — 正常系のコストはゼロ。
 * auto.min.js に同梱されるため文字列は最小限に保つ（エラーパス専用モジュールの
 * 遅延 import は `src/auto.ts` の SRI 自己完結制約で不可）。
 *
 * 診断 code の語彙はコンソール → lint → IDE の三面で共有する:
 * メッセージ先頭の `[wcs/...]` は wcstack-intellisense / @wcstack/lint の
 * 安定診断 code（packages/vscode-wcs/src/core/diagnostics.ts）と同一。
 */
/** 挿入・削除・置換の編集距離。長さ差が max を超えたら早期に max+1 を返す。 */
function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) {
        return max + 1;
    }
    const prev = new Array(b.length + 1);
    const curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) {
        prev[j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= b.length; j++) {
            prev[j] = curr[j];
        }
    }
    return prev[b.length];
}
/**
 * 候補集合から編集距離 2 以内の最近傍を探し、` Did you mean "<best>"?` を返す。
 * 該当なしは空文字。規準（距離 2・同距離は先勝ち・大小文字は畳んで比較）は
 * lint の did-you-mean（ioNodeValidator の suggestion）と同じ — 三面で提案が
 * 割れないように揃えている。動的キー等で候補が列挙できないサイトでは呼ばない
 * = 誘導文のみに縮退（設計 §3 の縮退）。
 */
function didYouMean(input, candidates) {
    // 空入力（`a|` の末尾パイプ等）に短い候補を提案しても無意味なので出さない。
    if (input.length === 0) {
        return "";
    }
    const folded = input.toLowerCase();
    let best = null;
    let bestDistance = 3;
    for (const candidate of candidates) {
        const distance = editDistance(folded, candidate.toLowerCase(), 2);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best !== null ? ` Did you mean "${best}"?` : "";
}
/**
 * lint への誘導（誘導付きメッセージ共通の一文）。
 * **lint が実際にそのケースを検出するサイトにだけ付ける** — 検出しないケースに
 * 付けると「エラー → lint 実行 → clean」の空振りで検証ループの信頼を毀損する。
 * 現在 lint 未検出のため付けないもの: DCC 宣言・watch の空キー / Object.prototype
 * 継承名 / ワイルドカード深度超過。
 * なお hint 付きサイト内でも被覆は部分的でありうる（例: `$watch: ident` の実体が
 * 非オブジェクトだった場合、ランタイムは評価後の値で raise するが lint は宣言 shape
 * から断定できず沈黙する）。サイト粒度の hint ではこの残余は構造的に避けられない。
 */
const LINT_HINT = " Validate statically: npx @wcstack/lint <file>.";

function raiseError(message) {
    throw new Error(`[@wcstack/state] ${message}`);
}

const STRUCTURAL_BINDING_TYPE_SET = new Set([
    "if",
    "elseif",
    "else",
    "for",
]);

const _config = {
    locale: 'en'};
// backward compatible export (read-only usage)
const config = _config;

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
 * Throws error when filter requires array value but non-array provided.
 *
 * @param fnName - Name of the filter function
 * @returns Never returns (always throws)
 */
function valueMustBeArray(fnName) {
    raiseError(`filter ${fnName} requires an array value`);
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
 * - Comprehensive coverage of diverse filters: eq, ne, lt, gt, inc, abs, clamp, fix, locale, uc, lc, cap, trim, slice, pad, truncate, join, int, float, round, percent, unit, date, time, ymd, hms, falsy, truthy, defaults, boolean, number, string, null, etc.
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
 * Absolute value filter - returns the magnitude of a number.
 *
 * @param options - Unused
 * @returns Filter function that returns the absolute value
 */
const abs = (_options) => {
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('abs');
        }
        return Math.abs(value);
    };
};
/**
 * Clamp filter - constrains a number to the inclusive range [min, max].
 *
 * Saturating conversion in the same family as round/floor/ceil, so it stays on
 * the wire rather than in state. Pairs with `unit` for style bindings:
 * `style.width: ratio|clamp(0,1)|percent(0)`.
 *
 * @param options - Array with minimum as first element and maximum as second (both required)
 * @returns Filter function that returns the clamped number
 */
const clamp = (options) => {
    const opt1 = options?.[0] ?? optionsRequired('clamp');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('clamp');
    }
    const opt2 = options?.[1] ?? optionsRequired('clamp');
    if (!validateNumberString(opt2)) {
        optionMustBeNumber('clamp');
    }
    const min = Number(opt1);
    const max = Number(opt2);
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('clamp');
        }
        return Math.min(Math.max(value, min), max);
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
 * ロケール依存フィルタ（`locale` / `date` / `time` / `datetime`）は
 * **明示引数だけを構築時に確定し、既定の `config.locale` は適用のたびに読む**。
 *
 * 以前は `options?.[0] ?? config.locale` を返り値の関数の**外**で解決していた。
 * フィルタ関数はバインド構築時に一度だけ作られるので、これはロケールを
 * クロージャに焼き込むことを意味する。`config.locale` の確定がバインド構築より
 * 遅れると、それ以降どう直しても「同じページの中で日付だけ既定ロケール」が
 * 永続し、しかも `config.locale` は依存グラフに載らないので再描画で回復もしない。
 * 症状（日付だけ英語）は原因（起動順序）から遠く、追いにくい。
 *
 * 適用のたびに読めば、少なくとも**再適用されたバインドは回復する**。ロケールは
 * 起動時に確定する前提（docs/i18n-design.md D1）なので通常この差は現れず、
 * これは順序事故から復帰できるようにするための保険である。
 *
 * 明示引数（`|date(ja-JP)`）は構築時に固定でよい — バインド式の一部であり、
 * 実行中に変わらない。
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns localized number string
 */
const locale = (options) => {
    const explicit = options?.[0];
    return (value) => {
        if (typeof value !== 'number') {
            valueMustBeNumber('locale');
        }
        return value.toLocaleString(explicit ?? config.locale);
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
 * @param options - Array with start index and optional end index
 * @returns Filter function that returns sliced string
 */
const slice = (options) => {
    const numberedOpts = [];
    const opt1 = options?.[0] ?? optionsRequired('slice');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('slice');
    }
    numberedOpts.push(Number(opt1));
    const opt2 = options?.[1];
    if (typeof opt2 !== 'undefined') {
        if (!validateNumberString(opt2)) {
            optionMustBeNumber('slice');
        }
        numberedOpts.push(Number(opt2));
    }
    return (value) => {
        return String(value).slice(...numberedOpts);
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
 * Unit filter - appends a CSS unit (or any suffix) to the value.
 *
 * A number alone does nothing in CSS, so without this the unit has to be built in
 * state — which drags presentation into the source of truth, and in the worst case
 * forces a whole derived array just to carry `"42%"` strings.
 * `style.height: samples.*.cpu|clamp(0,100)|fix(0)|unit(%)` keeps it on the wire.
 *
 * Accepts strings as well as numbers **on purpose**: the useful chains run through
 * `fix` / `percent`, which already return strings. Rejecting non-numbers here would
 * break exactly the combination this filter exists for.
 *
 * `null` / `undefined` pass through untouched rather than becoming `"undefinedpx"`,
 * so the binding layer's "undefined skips the write, null clears" semantics survive.
 *
 * @param options - Array with the unit/suffix as first element (required)
 * @returns Filter function that returns the value with the unit appended
 */
const unit = (options) => {
    const opt = options?.[0] ?? optionsRequired('unit');
    return (value) => {
        if (value === null || typeof value === 'undefined') {
            return value;
        }
        return String(value) + opt;
    };
};
/**
 * Join filter - joins array elements into a string.
 *
 * The default separator is `", "` rather than `","`: a bare comma is what `String()`
 * already produces without any filter, so defaulting to it would make `|join` a no-op.
 *
 * @param options - Array with separator as first element (default: ', ')
 * @returns Filter function that returns the joined string
 */
const join = (options) => {
    const opt = options?.[0] ?? ', ';
    return (value) => {
        if (!Array.isArray(value)) {
            valueMustBeArray('join');
        }
        return value.join(opt);
    };
};
/**
 * Truncate filter - shortens a string and appends an ellipsis.
 *
 * The length option counts **kept characters**, not the total including the suffix,
 * matching the existing `slice(0, n)` reading. A string at or below the limit is
 * returned untouched (no suffix).
 *
 * @param options - Array with max kept length as first element and suffix as second (default: '…')
 * @returns Filter function that returns the truncated string
 */
const truncate = (options) => {
    const opt1 = options?.[0] ?? optionsRequired('truncate');
    if (!validateNumberString(opt1)) {
        optionMustBeNumber('truncate');
    }
    const maxLength = Number(opt1);
    const suffix = options?.[1] ?? '…';
    return (value) => {
        const v = String(value);
        if (v.length <= maxLength) {
            return v;
        }
        return v.slice(0, maxLength) + suffix;
    };
};
/**
 * Date filter - formats Date object as localized date string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns date string
 */
const date = (options) => {
    // 既定ロケールは適用のたびに読む（`locale` フィルタの注記を参照）
    const explicit = options?.[0];
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('date');
        }
        return value.toLocaleDateString(explicit ?? config.locale);
    };
};
/**
 * Time filter - formats Date object as localized time string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns time string
 */
const time = (options) => {
    // 既定ロケールは適用のたびに読む（`locale` フィルタの注記を参照）
    const explicit = options?.[0];
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('time');
        }
        return value.toLocaleTimeString(explicit ?? config.locale);
    };
};
/**
 * DateTime filter - formats Date object as localized date and time string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns datetime string
 */
const datetime = (options) => {
    // 既定ロケールは適用のたびに読む（`locale` フィルタの注記を参照）
    const explicit = options?.[0];
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('datetime');
        }
        return value.toLocaleString(explicit ?? config.locale);
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
 * Hour-Minute-Second filter - formats Date object as HH:MM:SS string.
 *
 * The counterpart of `ymd`: a fixed, zero-padded, locale-independent rendering with a
 * configurable separator, for when `time` (locale-formatted) is not stable enough.
 *
 * @param options - Array with separator string as first element (default: ':')
 * @returns Filter function that returns formatted time string
 */
const hms = (options) => {
    const opt = options?.[0] ?? ':';
    return (value) => {
        if (!(value instanceof Date)) {
            valueMustBeDate('hms');
        }
        const hours = value.getHours().toString().padStart(2, '0');
        const minutes = value.getMinutes().toString().padStart(2, '0');
        const seconds = value.getSeconds().toString().padStart(2, '0');
        return `${hours}${opt}${minutes}${opt}${seconds}`;
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
    "abs": abs,
    "clamp": clamp,
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
    "truncate": truncate,
    "join": join,
    "int": int,
    "float": float,
    "round": round,
    "floor": floor,
    "ceil": ceil,
    "percent": percent,
    "unit": unit,
    "date": date,
    "time": time,
    "datetime": datetime,
    "ymd": ymd,
    "hms": hms,
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
        // lint の wcs/filter-unknown と同じ語彙・同じ did-you-mean 規準（三面同語彙）。
        raiseError(`[wcs/filter-unknown] filter not found: ${name}.${didYouMean(name, Object.keys(filters))}${LINT_HINT}`);
    }
    return filter(options);
};

/**
 * フィルタ引数リストのパース。`filter(a, b)` の `a, b` 部分を受け取る。
 *
 * トリムの規則は「**クォートの外側だけ**」。`fix( 2 )` のような書き癖を吸収するために
 * 素の引数は前後をトリムするが、クォートは「ここは literal」という宣言なので中身の
 * 空白は残す。両方まとめてトリムしていたため `pad(5, ' ')` が空文字パディング
 * （＝無変化）に化けており、空白区切りの `join(' / ')` も指定できなかった。
 */
/** 引数 1 つを確定する。クォート由来の文字が入った範囲より外側だけをトリムする。 */
function finalizeArg(text, firstQuoteStart, lastQuoteEnd) {
    // 先頭側: 最初のクォート文字より前だけが削れる（クォートが無ければ全体が対象）
    const startLimit = firstQuoteStart === -1 ? text.length : firstQuoteStart;
    let start = 0;
    while (start < startLimit && /\s/.test(text[start])) {
        start++;
    }
    // 末尾側: 最後のクォート文字より後ろだけが削れる（クォートが無ければ全体が対象）
    const endLimit = lastQuoteEnd === -1 ? 0 : lastQuoteEnd;
    let end = text.length;
    while (end > endLimit && /\s/.test(text[end - 1])) {
        end--;
    }
    return text.slice(start, end);
}
function parseFilterArgs(argsText) {
    const args = [];
    let current = '';
    let inQuote = null;
    let hasQuote = false;
    let firstQuoteStart = -1;
    let lastQuoteEnd = -1;
    const flush = () => {
        args.push(finalizeArg(current, firstQuoteStart, lastQuoteEnd));
        current = '';
        hasQuote = false;
        firstQuoteStart = -1;
        lastQuoteEnd = -1;
    };
    for (let i = 0; i < argsText.length; i++) {
        const char = argsText[i];
        if (inQuote) {
            if (char === inQuote) {
                inQuote = null;
            }
            else {
                if (firstQuoteStart === -1) {
                    firstQuoteStart = current.length;
                }
                current += char;
                lastQuoteEnd = current.length;
            }
        }
        else if (char === '"' || char === "'") {
            inQuote = char;
            hasQuote = true;
        }
        else if (char === ',') {
            flush();
        }
        else {
            current += char;
        }
    }
    const last = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
    if (last || hasQuote) {
        args.push(last);
    }
    return args;
}

const filterFnByKey = new Map();
/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
function clearFilterFnCacheForTooling() {
    filterFnByKey.clear();
}
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
/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
function clearPropPartCacheForTooling() {
    cacheFilterInfos$1.clear();
}
// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners
function parsePropPart(propPart) {
    const pos = propPart.indexOf(FILTER_SEPARATOR);
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
            filterTexts = filtersText.split(FILTER_SEPARATOR).map(trimFn);
            filters = parseFilters(filterTexts, "input");
            cacheFilterInfos$1.set(filtersText, filters);
        }
    }
    else {
        propText = propPart.trim();
    }
    const [propName, propModifiersText] = propText.split(MODIFIER_SEPARATOR).map(trimFn);
    const propSegments = propName.split(DELIMITER).map(trimFn);
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
/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
function clearStatePartCacheForTooling() {
    cacheFilterInfos.clear();
}
// format: statePath@stateName|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// stateName: optional, default is 'default'
// filters-format: filterName or filterName(arg1,arg2)
function parseStatePart(statePart) {
    const pos = statePart.indexOf(FILTER_SEPARATOR);
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
            filterTexts = filtersText.split(FILTER_SEPARATOR).map(trimFn);
            filters = parseFilters(filterTexts, "output");
            cacheFilterInfos.set(filtersText, filters);
        }
    }
    else {
        stateAndPath = statePart.trim();
    }
    const [statePathName, stateName = 'default'] = stateAndPath.split(STATE_NAME_SEPARATOR).map(trimFn);
    const pathInfo = getPathInfo(statePathName);
    return {
        stateName,
        statePathName,
        statePathInfo: pathInfo,
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
//   ...: statePart (spread — expand wcBindable properties+inputs of target object)
function parseBindTextsForElement(bindText) {
    const [...bindTexts] = bindText.split(BINDING_SEPARATOR).map(trimFn).filter(s => s.length > 0);
    const results = bindTexts.map((bindText) => {
        const separatorIndex = bindText.indexOf(PROP_VALUE_SEPARATOR);
        if (separatorIndex === -1) {
            raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
        }
        const propPart = bindText.slice(0, separatorIndex).trim();
        const statePart = bindText.slice(separatorIndex + 1).trim();
        if (propPart === ELSE_KEYWORD) {
            const pathInfo = getPathInfo('#else');
            return {
                propName: ELSE_KEYWORD,
                propSegments: [ELSE_KEYWORD],
                propModifiers: [],
                statePathName: '#else',
                statePathInfo: pathInfo,
                stateName: '',
                inFilters: [],
                outFilters: [],
                bindingType: 'else',
            };
        }
        else if (propPart === SPREAD_PROP) {
            const stateResult = parseStatePart(statePart);
            if (stateResult.outFilters.length > 0) {
                raiseError(`Invalid spread binding "${bindText}": filters are not allowed on spread targets.`);
            }
            if (stateResult.statePathName.length === 0) {
                raiseError(`Invalid spread binding "${bindText}": spread target path is required.`);
            }
            return {
                propName: SPREAD_PROP,
                propSegments: [SPREAD_PROP],
                propModifiers: [],
                inFilters: [],
                ...stateResult,
                bindingType: 'spread',
            };
        }
        else if (propPart === 'if'
            || propPart === 'elseif'
            || propPart === 'for'
            || propPart === 'radio'
            || propPart === 'checkbox') {
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
            // eventToken.<prop>: <name> は要素 dispatch を state へ流す pub/sub 配線。
            // 値適用ではないため bindingType 'event' として listener attach 経路に乗せる。
            if (propResult.propSegments[0] === EVENT_TOKEN_NAMESPACE) {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'event',
                };
            }
            if (propResult.propSegments[0].startsWith(EVENT_PROP_PREFIX)) {
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
            // lint 側の単独バインディング検査（bindingValidator の structuralMustBeSingle）が
            // 同じケースを検出するため誘導を付ける（三面同語彙）。
            raiseError(`[wcs/template-syntax] Invalid bindText: "${bindText}". 'if', 'elseif', 'else', and 'for' bindings must be single binding. Put the structural binding alone in its own data-wcs (e.g. <template data-wcs="for: items">).${LINT_HINT}`);
        }
    }
    return results;
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

/**
 * parser.ts — `data-wcs` バインディング構文の正本パーサを tooling 向けに公開する
 * サブパスエントリ（`@wcstack/state/parser`）。
 *
 * `./manifest` と同じ「実装が唯一の正本」パターン（docs/static-wiring-dx-design.md D2）。
 * vscode-wcs の正規表現パーサ・devtools の declaredScan 簡易パーサという複製実装を
 * 段階的にこの正本へ寄せるための土台。
 *
 * 契約:
 * - DOM 非依存・純関数（bindText 文字列 → ParseBindTextResult[]）。Node でそのまま動く
 *   （__tests__/parser.test.ts が node 環境で検証する）。
 * - **位置情報は持たず、不正構文は raiseError で throw する**。エラー耐性と診断 range の
 *   生成は消費側（vscode-wcs の positional ラッパー）の責務（同 D3）— ランタイムの
 *   サイズと責務をここで増やさない。
 * - `getPathInfo` はパス文字列の解析済みビュー（セグメント・ワイルドカード位置・親パス
 *   チェーン）を返す純関数。静的依存グラフの親チェーン展開はこの情報から機械的に再現できる。
 *   同一パス → 同一インスタンスの保証は**このエントリのモジュールインスタンス内**でのみ
 *   成立する（`.` エントリは別バンドル＝別キャッシュ。ランタイムの PathInfo と identity
 *   比較してはならない）。キャッシュは無制限（evict なし）— 言語サーバー等の長時間
 *   プロセスでは入力パス種数に単調比例してメモリが増える点に留意。
 * - `ParseBindTextResult.uuid` はランタイム内部（構造テンプレートのハイドレーション台帳）
 *   用のフィールドで、このパーサの戻り値では常に undefined。
 *
 * 公開面は意図的に最小（公開＝恒久契約）。`expandSpread` は live Element と
 * CustomElementRegistry を要するためここには含めない — ブラウザ内の消費者
 * （devtools の declared 正本化）は state 自身が pull API で答える。
 */
/**
 * このエントリの内部キャッシュ（PathInfo intern・propPart/statePart のパース結果・フィルタ関数クロージャ）を全て捨てる。
 *
 * 言語サーバー等の**長時間プロセス専用**。編集中の中間パス（`user.n` 等）が
 * 無制限キャッシュに恒久 intern されてメモリが単調増加するため、ドキュメント
 * クローズ等の区切りで呼ぶ。クリア後の getPathInfo は同一パスに**新しい**
 * インスタンスを返す — 「同一パス → 同一参照」の保証はクリアを跨がない。
 * ランタイム（`.` エントリ）にはこの API は無く、呼ばれることもない。
 */
function clearParserCaches() {
    clearPathInfoCacheForTooling();
    clearPropPartCacheForTooling();
    clearStatePartCacheForTooling();
    clearFilterFnCacheForTooling();
}

export { clearParserCaches, getPathInfo, parseBindTextForEmbeddedNode, parseBindTextsForElement };
