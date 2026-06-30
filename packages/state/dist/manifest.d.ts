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

declare const STRUCTURAL_BINDING_TYPE_SET: Set<BindingType>;

/** マニフェストのバージョン（構造を変えたら上げる）。 */
declare const WCS_MANIFEST_VERSION = 1;
interface IWcsManifest {
    version: number;
    syntax: {
        /** バインド属性名（既定 data-wcs） */
        bindAttribute: string;
        /** タグ名（既定 wcs-state） */
        tagName: string;
        /** パス区切り（`.`） */
        pathDelimiter: string;
        /** ワイルドカード（`*`） */
        wildcard: string;
        /** バインディング構文 `[prop][#mod]: [path][@state][|filter...]` の区切り文字 */
        delimiters: {
            binding: string;
            propValue: string;
            modifier: string;
            stateName: string;
            filter: string;
        };
        /** 構造ディレクティブ（`<template data-wcs="for: ...">` 等） */
        structuralDirectives: readonly string[];
    };
    /** 組み込みフィルタ名（builtinFilters から自動導出＝実装が正本） */
    filters: string[];
    /** 組み込みフィルタの構造化メタデータ（説明・引数仕様・型）。vscode-wcs の手リスト撤去用。 */
    filterMeta: Record<string, IFilterMeta>;
    /** 予約ライフサイクルフック名 */
    reservedLifecycle: readonly string[];
    /** 予約 state API（プロトコル系の `$` 名前空間） */
    reservedStateApi: readonly string[];
}
/** 機械可読な単一正本を返す。vscode-wcs はこれを消費する想定。 */
declare function getWcsManifest(): IWcsManifest;

export { STRUCTURAL_BINDING_TYPE_SET, WCS_MANIFEST_VERSION, builtinFilterMeta, getWcsManifest };
export type { FilterArgType, FilterResultType, IFilterMeta, IWcsManifest };
