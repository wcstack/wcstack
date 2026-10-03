/**
 * filterMeta.ts — 組み込みフィルタの構造化メタデータ（単一正本・route-a A2-1）。
 *
 * これまで vscode-wcs（completionData.ts BUILTIN_FILTERS）が手で持っていたフィルタの
 * 引数仕様・型・説明を、実装側（@wcstack/state）に**正本として移設**したもの。
 * manifest.ts がこれを公開し、vscode-wcs はそれを消費して手リストを撤去できる。
 *
 * 完全性は __tests__/manifest.test.ts のドリフト検出が保証する
 * （filterMeta のキー集合 == builtinFilters のキー集合）。フィルタを追加して meta を
 * 書き忘れると CI が落ちる。
 */
type FilterResultType = "boolean" | "number" | "string" | "passthrough";
type FilterArgType = "number" | "string" | "any";
interface IFilterMeta {
    /** 説明（補完・ホバー用） */
    description: string;
    /** 引数を取るか */
    hasArgs: boolean;
    /** 適用後の結果型（passthrough は入力型をそのまま返す） */
    resultType: FilterResultType;
    /** 受け入れ可能な入力型（'any' は任意） */
    acceptTypes: "any" | readonly string[];
    /** 引数の最小数 */
    minArgs: number;
    /** 引数の最大数 */
    maxArgs: number;
    /** 各引数の期待型（省略時はチェックしない） */
    argTypes?: readonly FilterArgType[];
}
/** 組み込みフィルタ名 → 構造化メタデータ。キー集合は builtinFilters と一致しなければならない。 */
declare const builtinFilterMeta: Record<string, IFilterMeta>;

type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';
/** Bindings that must be the only binding of their attribute value. */
declare const STRUCTURAL_BINDING_TYPE_SET: ReadonlySet<BindingType>;

/** The manifest's shape version (the same shape as 3.x). */
declare const WCS_MANIFEST_VERSION = 2;
/** Filter old names → canonical (3.2): removed in 4.0. */
declare const builtinFilterAliases: Readonly<Record<string, string>>;
/** Declaration-key old names → canonical (3.2): removed in 4.0 (`$streams` fails as `[wcs/declaration-alias]`). */
declare const DECLARATION_ALIASES: Readonly<Record<string, string>>;
/** State API old names → canonical (3.2): removed in 4.0 (`$trackDependency` fails as `[wcs/name-alias]`). */
declare const STATE_API_ALIASES: Readonly<Record<string, string>>;
interface IWcsManifest {
    version: number;
    syntax: {
        bindAttribute: string;
        tagName: string;
        pathDelimiter: string;
        wildcard: string;
        delimiters: {
            binding: string;
            propValue: string;
            modifier: string;
            filter: string;
        };
        structuralDirectives: readonly string[];
        modifiers: {
            flags: readonly string[];
            keyValue: readonly string[];
            eventNamePrefix: string;
        };
        indexParam: {
            prefix: string;
            maxDepth: number;
        };
        bindingTypes: {
            elseKeyword: string;
            spread: string;
            eventPropertyPrefix: string;
            explicitPropertyPrefix: string;
            propNamespaces: {
                eventToken: string;
                command: string;
                class: string;
                attr: string;
                style: string;
            };
        };
    };
    /** The built-in filter names: the core set, then the formats add-on's. */
    filters: string[];
    filterMeta: Record<string, IFilterMeta>;
    filterAliases: Readonly<Record<string, string>>;
    declarationAliases: Readonly<Record<string, string>>;
    apiAliases: Readonly<Record<string, string>>;
    /** Reserved lifecycle hooks. */
    reservedLifecycle: readonly string[];
    /** Reserved state keys and `$` namespaces. */
    reservedStateApi: readonly string[];
    /** A state's `$behavior` options (4.0): each key, the type of its value and its value when left out. */
    behaviorOptions: Readonly<Record<string, {
        type: "boolean";
        default: boolean;
    }>>;
    /** The add-on names `$features` and the root `<wcs-state features>` take (4.0). */
    features: readonly string[];
}
declare function getWcsManifest(): IWcsManifest;

export { DECLARATION_ALIASES, STATE_API_ALIASES, STRUCTURAL_BINDING_TYPE_SET, WCS_MANIFEST_VERSION, builtinFilterAliases, builtinFilterMeta, getWcsManifest };
export type { FilterArgType, FilterResultType, IFilterMeta, IWcsManifest };
