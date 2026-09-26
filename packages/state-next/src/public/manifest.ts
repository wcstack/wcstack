/**
 * `@wcstack/state/manifest` (and `dist/wcs-manifest.json`): the binding syntax, the built-in
 * filters and the reserved names as one machine-readable source, derived from the
 * implementation — `@wcstack/lint` and the VS Code extension read it. DOM-free, no side effects.
 *
 * 4.0: the 3.x old names are gone from the runtime, so `filterAliases` and `declarationAliases`
 * are empty; `apiAliases` lists what the engine still resolves. `$scan` is no longer reserved.
 */
import { config } from "../config";
import { WILDCARD } from "../pattern";
import { coreFilters } from "../filters/core";
import { formatFilters } from "../filters/formats";
import { STRUCTURAL_BINDING_TYPE_SET } from "../parser/types";
import {
  ATTR_NAMESPACE, BINDING_SEPARATOR, CLASS_NAMESPACE, COMMAND_NAMESPACE, DELIMITER, ELSE_KEYWORD,
  EVENT_PROP_PREFIX, EVENT_TOKEN_NAMESPACE, FILTER_SEPARATOR, MODIFIER_SEPARATOR, PROP_VALUE_SEPARATOR,
  SPREAD_PROP, STYLE_NAMESPACE,
} from "../parser/define";
import { builtinFilterMeta, type IFilterMeta } from "./filterMeta";

export { builtinFilterMeta } from "./filterMeta";
export type { IFilterMeta, FilterResultType, FilterArgType } from "./filterMeta";
export { STRUCTURAL_BINDING_TYPE_SET } from "../parser/types";

/** The manifest's shape version (the same shape as 3.x). */
export const WCS_MANIFEST_VERSION = 2;

/** Filter old names → canonical (3.2): removed in 4.0. */
export const builtinFilterAliases: Readonly<Record<string, string>> = Object.freeze({});

/** Declaration-key old names → canonical (3.2): removed in 4.0 (`$streams` fails as `[wcs/declaration-alias]`). */
export const DECLARATION_ALIASES: Readonly<Record<string, string>> = Object.freeze({});

/** State API old names → canonical (3.2) that the engine still resolves. */
export const STATE_API_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  $trackDependency: "$dependOn",
  $untrackDependency: "$untracked",
});

/** Modifier vocabulary (`#` on the left side): flags, and `key=value` keys. */
const MODIFIER_FLAGS: readonly string[] = Object.freeze(["prevent", "stop", "ro"]);
const MODIFIER_KEYS: readonly string[] = Object.freeze(["init", "sync"]);
/** `$1` … `$128`. */
const INDEX_PARAM_PREFIX = "$";
const MAX_INDEX_PARAM = 128;

export interface IWcsManifest {
  version: number;
  syntax: {
    bindAttribute: string;
    tagName: string;
    pathDelimiter: string;
    wildcard: string;
    delimiters: { binding: string; propValue: string; modifier: string; filter: string };
    structuralDirectives: readonly string[];
    modifiers: { flags: readonly string[]; keyValue: readonly string[]; eventNamePrefix: string };
    indexParam: { prefix: string; maxDepth: number };
    bindingTypes: {
      elseKeyword: string;
      spread: string;
      eventPropertyPrefix: string;
      explicitPropertyPrefix: string;
      propNamespaces: { eventToken: string; command: string; class: string; attr: string; style: string };
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
}

export function getWcsManifest(): IWcsManifest {
  return {
    version: WCS_MANIFEST_VERSION,
    syntax: {
      bindAttribute: config.bindAttributeName,
      tagName: config.tagNames.state,
      pathDelimiter: DELIMITER,
      wildcard: WILDCARD,
      delimiters: { binding: BINDING_SEPARATOR, propValue: PROP_VALUE_SEPARATOR, modifier: MODIFIER_SEPARATOR, filter: FILTER_SEPARATOR },
      structuralDirectives: Array.from(STRUCTURAL_BINDING_TYPE_SET),
      modifiers: { flags: MODIFIER_FLAGS, keyValue: MODIFIER_KEYS, eventNamePrefix: EVENT_PROP_PREFIX },
      indexParam: { prefix: INDEX_PARAM_PREFIX, maxDepth: MAX_INDEX_PARAM },
      bindingTypes: {
        elseKeyword: ELSE_KEYWORD,
        spread: SPREAD_PROP,
        eventPropertyPrefix: EVENT_PROP_PREFIX,
        explicitPropertyPrefix: DELIMITER,
        propNamespaces: { eventToken: EVENT_TOKEN_NAMESPACE, command: COMMAND_NAMESPACE, class: CLASS_NAMESPACE, attr: ATTR_NAMESPACE, style: STYLE_NAMESPACE },
      },
    },
    filters: [...Object.keys(coreFilters), ...Object.keys(formatFilters)],
    filterMeta: builtinFilterMeta,
    filterAliases: builtinFilterAliases,
    declarationAliases: DECLARATION_ALIASES,
    apiAliases: STATE_API_ALIASES,
    reservedLifecycle: ["$connectedCallback", "$disconnectedCallback", "$renderedCallback", "$errorCallback", "$stateReadyCallback"],
    reservedStateApi: [
      "$bindables", "$commands", "$commandTokens", "$command", "$eventTokens", "$on",
      "$stream", "$watch", "$listKeys", "$recursion", "$streamStatus", "$streamError",
    ],
  };
}
