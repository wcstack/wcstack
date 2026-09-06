/**
 * manifest.ts — `<wcs-state>` の構文・フィルタ・予約名を機械可読な単一正本として公開する。
 *
 * 目的（route-a A2-1）: vscode-wcs（wcstack-intellisense）が現在ハードコードで二重実装している
 * 「フィルタ一覧・構文区切り・予約名」を、state 側の実装から導出した manifest に一本化し、
 * 手作業同期によるドリフトを構造的に断つための土台。
 *
 * 設計:
 * - `filters` は実装（builtinFilters の Record キー）から **自動導出**＝実装が唯一の正本。
 * - 構文・予約名は config / define.ts の定数から導出。
 * - 将来 `dist/wcs-manifest.json` としてビルド時に書き出し、vscode-wcs がそれを読む形に発展させる。
 * - ドリフト検出テスト（__tests__/manifest.test.ts）が、フィルタ集合の golden と実装の一致を CI で保証する。
 */
import { config } from "./config.js";
import { outputBuiltinFilters } from "./filters/builtinFilters.js";
import { builtinFilterMeta, IFilterMeta } from "./filters/filterMeta.js";
import { STRUCTURAL_BINDING_TYPE_SET } from "./structural/define.js";
import {
  DELIMITER,
  WILDCARD,
  MAX_WILDCARD_DEPTH,
  BINDING_SEPARATOR,
  PROP_VALUE_SEPARATOR,
  MODIFIER_SEPARATOR,
  FILTER_SEPARATOR,
  MODIFIER_FLAGS,
  MODIFIER_KEYS,
  INDEX_PARAM_PREFIX,
  ELSE_KEYWORD,
  SPREAD_PROP,
  EVENT_PROP_PREFIX,
  EVENT_TOKEN_NAMESPACE,
  COMMAND_NAMESPACE,
  CLASS_NAMESPACE,
  ATTR_NAMESPACE,
  STYLE_NAMESPACE,
  STATE_CONNECTED_CALLBACK_NAME,
  STATE_DISCONNECTED_CALLBACK_NAME,
  STATE_UPDATED_CALLBACK_NAME,
  WEBCOMPONENT_STATE_READY_CALLBACK_NAME,
  STATE_BINDABLES_NAME,
  STATE_COMMANDS_NAME,
  STATE_COMMAND_TOKENS_NAME,
  STATE_COMMAND_NAMESPACE_NAME,
  STATE_EVENT_TOKENS_NAME,
  STATE_ON_NAME,
  STATE_STREAMS_NAME,
  STATE_WATCH_NAME,
  STATE_LIST_KEYS_NAME,
  STATE_STREAM_STATUS_NAMESPACE_NAME,
  STATE_STREAM_ERROR_NAMESPACE_NAME,
} from "./define.js";

// 消費側（vscode-wcs 等）が `@wcstack/state/manifest` から正本を直接引けるよう再エクスポート。
export { builtinFilterMeta } from "./filters/filterMeta.js";
export type { IFilterMeta, FilterResultType, FilterArgType } from "./filters/filterMeta.js";
export { STRUCTURAL_BINDING_TYPE_SET } from "./structural/define.js";

/** マニフェストのバージョン（構造を変えたら上げる）。 */
export const WCS_MANIFEST_VERSION = 1;

export interface IWcsManifest {
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
    /** バインディング構文 `[prop][#mod]: [path][|filter...]` の区切り文字 */
    delimiters: {
      binding: string;    // ; 複数バインディングの区切り
      propValue: string;  // : prop と path の区切り
      modifier: string;   // # prop と修飾子の区切り
      filter: string;     // | フィルタパイプの区切り
    };
    /** 構造ディレクティブ（`<template data-wcs="for: ...">` 等） */
    structuralDirectives: readonly string[];
    /**
     * 修飾子（`#` 後）の語彙。flags は値を取らない形（`#prevent`）、keyValue は
     * `=` で値を取る形（`#init=element`）、eventNamePrefix は `on` + イベント名の形
     * （`#onchange` — two-way / radio / checkbox のイベント名上書き。README「Modifiers」）。
     * define.ts の定数が単一正本で、ランタイムの消費箇所も同じ定数に分岐する。
     */
    modifiers: {
      flags: readonly string[];
      keyValue: readonly string[];
      eventNamePrefix: string;
    };
    /** リストインデックス参照名（`$1`..`$N`）。prefix + 1 始まり連番、maxDepth まで。 */
    indexParam: {
      prefix: string;
      maxDepth: number;
    };
    /**
     * bindingType 判別の語彙（parseBindTextsForElement の分岐と同一の定数から導出）。
     * 判別順: else → spread → 構造ディレクティブ/radio/checkbox → eventToken・`on*`
     * （event）→ prop。propNamespaces は左辺先頭セグメントの特殊 namespace で、
     * apply 層のディスパッチキー集合との一致はテストが強制する。
     * 既知の未収載: `radio` / `checkbox`（BindingType union のみが正本）。
     */
    bindingTypes: {
      elseKeyword: string;
      spread: string;
      eventPropertyPrefix: string;
      propNamespaces: {
        eventToken: string;
        command: string;
        class: string;
        attr: string;
        style: string;
      };
    };
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
export function getWcsManifest(): IWcsManifest {
  return {
    version: WCS_MANIFEST_VERSION,
    syntax: {
      bindAttribute: config.bindAttributeName,
      tagName: config.tagNames.state,
      pathDelimiter: DELIMITER,
      wildcard: WILDCARD,
      delimiters: {
        binding: BINDING_SEPARATOR,
        propValue: PROP_VALUE_SEPARATOR,
        modifier: MODIFIER_SEPARATOR,
        filter: FILTER_SEPARATOR,
      },
      // 正本 STRUCTURAL_BINDING_TYPE_SET から導出（手書きの二重定義を排除）。
      structuralDirectives: Array.from(STRUCTURAL_BINDING_TYPE_SET),
      modifiers: {
        flags: MODIFIER_FLAGS,
        keyValue: MODIFIER_KEYS,
        eventNamePrefix: EVENT_PROP_PREFIX,
      },
      indexParam: {
        prefix: INDEX_PARAM_PREFIX,
        maxDepth: MAX_WILDCARD_DEPTH,
      },
      bindingTypes: {
        elseKeyword: ELSE_KEYWORD,
        spread: SPREAD_PROP,
        eventPropertyPrefix: EVENT_PROP_PREFIX,
        propNamespaces: {
          eventToken: EVENT_TOKEN_NAMESPACE,
          command: COMMAND_NAMESPACE,
          class: CLASS_NAMESPACE,
          attr: ATTR_NAMESPACE,
          style: STYLE_NAMESPACE,
        },
      },
    },
    // 実装（Record のキー）から自動導出。手リストを持たない＝ドリフトの構造的排除。
    filters: Object.keys(outputBuiltinFilters),
    filterMeta: builtinFilterMeta,
    reservedLifecycle: [
      STATE_CONNECTED_CALLBACK_NAME,
      STATE_DISCONNECTED_CALLBACK_NAME,
      STATE_UPDATED_CALLBACK_NAME,
      WEBCOMPONENT_STATE_READY_CALLBACK_NAME,
    ],
    reservedStateApi: [
      STATE_BINDABLES_NAME,
      STATE_COMMANDS_NAME,
      STATE_COMMAND_TOKENS_NAME,
      STATE_COMMAND_NAMESPACE_NAME,
      STATE_EVENT_TOKENS_NAME,
      STATE_ON_NAME,
      STATE_STREAMS_NAME,
      STATE_WATCH_NAME,
      STATE_LIST_KEYS_NAME,
      STATE_STREAM_STATUS_NAMESPACE_NAME,
      STATE_STREAM_ERROR_NAMESPACE_NAME,
    ],
  };
}
