const DELIMITER = '.';
const WILDCARD = '*';
const MAX_WILDCARD_DEPTH = 128;
// data-wcs バインディング構文 `[prop][#mod]: [path][|filter...]` の区切り文字（単一正本・`@state` は v2 で撤去）。
// これらは「死守の壁（構文契約）」であり値は不変。manifest.syntax.delimiters で公開される。
const BINDING_SEPARATOR = ';'; // 複数バインディングの区切り
const PROP_VALUE_SEPARATOR = ':'; // 左辺(prop)と右辺(path)の区切り
const MODIFIER_SEPARATOR = '#'; // prop と修飾子の区切り
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
/**
 * 再帰ワイルドカード。オーサリング層（$recursion 宣言・getter キー・API 引数）にだけ
 * 現れ、PathInfo には決して降ろさない — wildcardCount が不定になると ListIndex 連鎖長・
 * $1..$n・$resolve の厳密一致・走査の段数が同時に壊れる
 * （docs/state-recursive-path-design.md §2-1）。
 */
const RECURSION_WILDCARD = "**";

function raiseError(message) {
    throw new Error(`[@wcstack/state] ${message}`);
}

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
    // 再帰ワイルドカードはオーサリング層の記号で、ここへ降りてきてはならない
    // （降ろすと wildcardCount が不定になり ListIndex 連鎖長・$1..$n・$resolve の
    //  厳密一致・走査の段数が同時に壊れる。設計書 D2）。到達したということは、
    // `**` を解釈しない消費者に `**` パスが渡ったということ。通常のパスはこの検査を
    // 初回 intern のときにしか払わない（`**` パスは intern されないので読むたびに落ちる）。
    if (path.indexOf(RECURSION_WILDCARD) !== -1) {
        raiseError(`[wcs/recursion-unsupported] "${path}" uses "${RECURSION_WILDCARD}", which is not accepted here. ` +
            `It is only meaningful in a $recursion declaration, in a recursive getter key, and in the path ` +
            `argument of $getAll / $setAll — and only when the state declares a $recursion anchor.`);
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

const STRUCTURAL_BINDING_TYPE_SET = new Set([
    "if",
    "elseif",
    "else",
    "for",
]);

/**
 * core/filterRegistry.ts — フィルタ実関数の登録簿（設計案 §4、要件 D16）。
 *
 * 文法（`path|filter(args)` の解析）は core に残り、**実関数は登録簿から束縛計画の段で引く**。
 * 解析の段は名前と引数しか作らない（`bindTextParser/parseFilters.ts`）ので、パーサだけを使う
 * tooling（`@wcstack/state/parser`）はフィルタの実装を 1 バイトも引き込まない。
 *
 * 書式フィルタ群（`uc` / `date` / `round` …）は `features/formats` が install で登録する。
 * core が自前で持つのは、エンジン自身が差し込む `not` だけ（`if` / `else` の反転 —
 * structural/notFilter.ts）。未知のフィルタは束縛計画の段で名指しで落ちる（従来は解析時）。
 */
/** 名前 + 引数 + 入出力ごとに解決済みの実関数（解決は 1 回だけ） */
const resolvedByKey = new Map();
/** 解決済みの答えを捨てる（tooling: `@wcstack/state/parser` の clearParserCaches） */
function clearFilterResolutionCache() {
    resolvedByKey.clear();
}

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
/** 引用符の無い引数の型（要件 B9）: true / false / null / 数値は型付き、それ以外は文字列 */
const NUMBER_LITERAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function toLiteral(text, quoted) {
    if (quoted)
        return text;
    if (text === "true")
        return true;
    if (text === "false")
        return false;
    if (text === "null")
        return null;
    return NUMBER_LITERAL.test(text) ? Number(text) : text;
}
/** 引数の原文と、その型付きの値（要件 B9）を一緒に返す。原文は引用符を外したもの */
function parseFilterArgsWithLiterals(argsText) {
    const args = [];
    const literals = [];
    let current = '';
    let inQuote = null;
    let hasQuote = false;
    let firstQuoteStart = -1;
    let lastQuoteEnd = -1;
    const flush = () => {
        const arg = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
        args.push(arg);
        literals.push(toLiteral(arg, hasQuote));
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
    if (inQuote !== null) {
        // 閉じていない引用符は受理しない（要件 B2）。以前は黙って閉じたことにしていた
        raiseError(`[wcs/binding-syntax] unterminated ${inQuote} quote in the filter arguments "(${argsText})". Close the quote.${LINT_HINT}`);
    }
    const last = finalizeArg(current, firstQuoteStart, lastQuoteEnd);
    if (last || hasQuote) {
        args.push(last);
        literals.push(toLiteral(last, hasQuote));
    }
    return { args, literals };
}

/** tooling 専用（parser.ts の clearParserCaches からのみ呼ぶ）。 */
function clearFilterFnCacheForTooling() {
    clearFilterResolutionCache();
}
// format: filterName(arg1,arg2) or filterName
/**
 * 文法の段（要件 D16）: 名前と引数だけを読む。**実関数は引かない** — 束縛計画の段で
 * 登録簿から解決する（`core/filterRegistry.ts`・`bindings/getBindingInfos.ts`）。
 * 未知のフィルタもここでは落とさない: パーサだけを使う tooling は実装を持たないので、
 * 「知らない名前」を解析の段で判定できない。
 */
function parseFilters(filterTextList, _filterIOType) {
    return filterTextList.map((filterText) => {
        const openParenIndex = filterText.indexOf('(');
        const closeParenIndex = filterText.lastIndexOf(')');
        // check parentheses
        if (openParenIndex !== -1 && closeParenIndex === -1) {
            raiseError(`Invalid filter format: missing closing parenthesis in "${filterText}"`);
        }
        if (closeParenIndex !== -1 && openParenIndex === -1) {
            raiseError(`Invalid filter format: missing opening parenthesis in "${filterText}"`);
        }
        const filterName = (openParenIndex === -1 ? filterText : filterText.substring(0, openParenIndex)).trim();
        if (filterName.length === 0) {
            // 空のフィルタ（`x|`・`x||y`・`x|(1)`）は文法の誤り。解析の段で名指しで落とす — 未知の
            // フィルタとは別物で、実関数の解決（束縛計画の段）まで持ち越すと tooling の解析が素通りする
            raiseError(`[wcs/binding-syntax] an empty filter in "${filterTextList.join("|")}" — remove the extra "|" or name the filter.${LINT_HINT}`);
        }
        if (openParenIndex === -1) {
            // no arguments
            return { filterName, args: [], literals: [] };
        }
        const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
        return { filterName, ...parseFilterArgsWithLiterals(argsText) };
    });
}

const trimFn = (s) => s.trim();
const isQuote = (c) => c === "'" || c === '"';
/**
 * `text` の中で、引用符（`'` / `"`）の外にある最初の `char` の位置。無ければ -1（要件 B1）。
 * 閉じていない引用符はそのまま末尾まで続く扱い — 不正な引用符はフィルタ引数の段で名指しで落ちる。
 */
function indexOfOutsideQuotes(text, char) {
    let quote = null;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote !== null) {
            if (c === quote)
                quote = null;
        }
        else if (isQuote(c)) {
            quote = c;
        }
        else if (c === char) {
            return i;
        }
    }
    return -1;
}
/**
 * `separator` で区切る。ただし引用符の中は区切らない（要件 B1）: `join(';')` や `join('|')` の
 * 区切り文字は引数であって、バインディングやフィルタの区切りではない。
 */
function splitOutsideQuotes(text, separator) {
    const parts = [];
    let quote = null;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote !== null) {
            if (c === quote)
                quote = null;
        }
        else if (isQuote(c)) {
            quote = c;
        }
        else if (c === separator) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

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
    const pos = indexOfOutsideQuotes(propPart, FILTER_SEPARATOR);
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
            filterTexts = splitOutsideQuotes(filtersText, FILTER_SEPARATOR).map(trimFn);
            filters = parseFilters(filterTexts);
            cacheFilterInfos$1.set(filtersText, filters);
        }
    }
    else {
        propText = propPart.trim();
    }
    const modifierParts = propText.split(MODIFIER_SEPARATOR).map(trimFn);
    if (modifierParts.length > 2) {
        // 修飾子の並びは 1 つだけ（要件 B2）。`value#ro#wo` は以前 `ro` だけを残して黙って捨てていた
        raiseError(`[wcs/binding-syntax] "${propText}": a binding takes one modifier list after a single "${MODIFIER_SEPARATOR}" — write "${modifierParts[0]}${MODIFIER_SEPARATOR}${modifierParts.slice(1).join(",")}".${LINT_HINT}`);
    }
    const [propName, propModifiersText] = modifierParts;
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
// format: statePath|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// filters-format: filterName or filterName(arg1,arg2)
function parseStatePart(statePart) {
    // 引用符の中の `|` はフィルタの区切りではない（要件 B1 — `join('|')`）
    const pos = indexOfOutsideQuotes(statePart, FILTER_SEPARATOR);
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
            filterTexts = splitOutsideQuotes(filtersText, FILTER_SEPARATOR).map(trimFn);
            filters = parseFilters(filterTexts);
            cacheFilterInfos.set(filtersText, filters);
        }
    }
    else {
        stateAndPath = statePart.trim();
    }
    if (stateAndPath.indexOf("@") !== -1) {
        // 名前次元は v2 で撤去（docs/state-mount-design.md D16 / §9）。パスは 1 本のツリー。
        raiseError(`"${stateAndPath}": the "@name" selector was removed in v2 — there is a single state tree. ` +
            `Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.`);
    }
    const statePathName = stateAndPath;
    const pathInfo = getPathInfo(statePathName);
    return {
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
/** 左辺に修飾子も入力フィルタも取らない束縛（構造ディレクティブと spread）— 付いていれば拒否する（要件 B4） */
const KEYWORDS_WITHOUT_MODIFIERS = new Set([ELSE_KEYWORD, 'if', 'elseif', 'for', SPREAD_PROP]);
/**
 * `data-wcs` の値をバインディングごとに区切る（前後の空白は残す — tooling が位置を数えられるように）。
 * 引用符の中の `;` は区切りではない（要件 B1 — `join(';')`）。ランタイムと tooling（`@wcstack/state/parser`）で共有する
 */
function splitBindTexts(bindText) {
    return splitOutsideQuotes(bindText, BINDING_SEPARATOR);
}
function parseBindTextsForElement(bindText) {
    const [...bindTexts] = splitBindTexts(bindText).map(trimFn).filter(s => s.length > 0);
    const results = bindTexts.map((bindText) => {
        const separatorIndex = bindText.indexOf(PROP_VALUE_SEPARATOR);
        if (separatorIndex === -1) {
            raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
        }
        const propPart = bindText.slice(0, separatorIndex).trim();
        const statePart = bindText.slice(separatorIndex + 1).trim();
        // 種別は修飾子・入力フィルタより前の名前で決める（要件 B4）。以前は左辺全体との完全一致で
        // 判定していたので、`radio#ro:` が汎用プロパティに落ちていた
        const keyword = propPart.split(MODIFIER_SEPARATOR)[0].split(FILTER_SEPARATOR)[0].trim();
        if (keyword !== propPart && KEYWORDS_WITHOUT_MODIFIERS.has(keyword)) {
            raiseError(`[wcs/binding-syntax] "${bindText}": "${keyword}" takes no modifiers or filters on its left side — write "${keyword}:".${LINT_HINT}`);
        }
        if (propPart === ELSE_KEYWORD) {
            if (statePart.length > 0) {
                // else は値を取らない（要件 B2）。以前は右辺を黙って捨てていた
                raiseError(`[wcs/binding-syntax] "${bindText}": "else" takes no value — write "else:".${LINT_HINT}`);
            }
            const pathInfo = getPathInfo('#else');
            return {
                propName: ELSE_KEYWORD,
                propSegments: [ELSE_KEYWORD],
                propModifiers: [],
                statePathName: '#else',
                statePathInfo: pathInfo,
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
            || propPart === 'for') {
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
        else if (keyword === 'radio' || keyword === 'checkbox') {
            // 修飾子（`#ro`・`#onchange` …）と入力フィルタは radio / checkbox のハンドラが読む（要件 B4）
            const stateResult = parseStatePart(statePart);
            const propResult = parsePropPart(propPart);
            return {
                ...propResult,
                ...stateResult,
                bindingType: keyword,
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

export { clearParserCaches, getPathInfo, parseBindTextForEmbeddedNode, parseBindTextsForElement, splitBindTexts };
