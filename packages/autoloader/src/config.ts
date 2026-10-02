
import { IConfig, ILoader, IWritableConfig } from "./types.js"
import { load } from "./vanilla.js"

interface IInternalConfig extends IConfig {
  scanImportmap: boolean;
  loaders: Record<string, ILoader | string>;
  observable: boolean;
  tagNames: {
    autoloader: string;
  };
}

export const DEFAULT_KEY = "*";

export const VANILLA_KEY = "vanilla";

export const VANILLA_LOADER = {
  postfix: ".js",
  loader: load
}

const _config: IInternalConfig = {
  scanImportmap: true,
  loaders: {
    [VANILLA_KEY]: VANILLA_LOADER,
    [DEFAULT_KEY]: VANILLA_KEY
  },
  observable: true,
  tagNames: {
    autoloader: "wcs-autoloader"
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return obj;
}

function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return clone as T;
}

let frozenConfig: IConfig | null = null;

// 後方互換のため config もエクスポート（読み取り専用として使用）
export const config: IConfig = _config as IConfig;

export function getConfig(): IConfig {
  if (!frozenConfig) {
    frozenConfig = deepFreeze(deepClone(_config));
  }
  return frozenConfig;
}

// The defaults as shipped, for warnInvalid: a value 3.x lets through unchecked must not change
// what a later call is compared against.
const defaults: Record<string, unknown> = { ..._config, tagNames: { ..._config.tagNames } };
const warned = new Set<string>();

function warnOnce(name: string, text: string): void {
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[@wcstack/autoloader] bootstrapAutoloader: "${name}" ${text}`);
  }
}

/**
 * 3.5 forward-compat check. Warns, once per key per page, about an option that 4.0's
 * bootstrapAutoloader throws on: one this package does not have, a value of another type than its
 * default (null, or an array for an object, included), or a tag name it does not define or that is
 * not a string. `scanImportmap`, read nowhere and removed in 4.0, gets its own warning whatever its
 * value. An undefined value is left out, as in 4.0. It only warns: setConfig then goes on exactly
 * as in 3.x. Bootstrap-time only, never on a hot path.
 */
function warnInvalid(given: Record<string, unknown>, known: Record<string, unknown>, path = ""): void {
  for (const [key, value] of Object.entries(given)) {
    const name = path + key;
    const current = known[key];
    if (value === undefined) {
      continue;
    }
    if (name === "scanImportmap") {
      warnOnce(name, "has no effect and is removed in 4.0, which throws on it.");
    } else if (
      !Object.prototype.hasOwnProperty.call(known, key) ||
      value === null ||
      typeof value !== typeof current ||
      Array.isArray(value) !== Array.isArray(current)
    ) {
      warnOnce(name, "is not one of its options, or not of the option's type. 3.x ignores it or applies it unchecked; 4.0 throws on it.");
    } else if (name === "tagNames") {
      warnInvalid(value as Record<string, unknown>, current as Record<string, unknown>, "tagNames.");
    }
  }
}

export function setConfig(partialConfig: IWritableConfig): void {
  warnInvalid(partialConfig as Record<string, unknown>, defaults);
  if (typeof partialConfig.scanImportmap === "boolean") {
    _config.scanImportmap = partialConfig.scanImportmap;
  }
  if (partialConfig.loaders) {
    Object.assign(_config.loaders, partialConfig.loaders);
  }
  if (typeof partialConfig.observable === "boolean") {
    _config.observable = partialConfig.observable;
  }
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  frozenConfig = null;
}
