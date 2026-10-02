import { IConfig, IWritableConfig } from "./types";

interface IInternalConfig {
  tagNames: {
    route: string;
    router: string;
    outlet: string;
    layout: string;
    layoutOutlet: string;
    link: string;
    head: string;
    guardHandler: string;
  };
  enableShadowRoot: boolean;
  basenameFileExtensions: string[];
}

const _config: IInternalConfig = {
  tagNames: {
    route: "wcs-route",
    router: "wcs-router",
    outlet: "wcs-outlet",
    layout: "wcs-layout",
    layoutOutlet: "wcs-layout-outlet",
    link: "wcs-link",
    head: "wcs-head",
    guardHandler: "wcs-guard-handler"
  },
  enableShadowRoot: false,
  basenameFileExtensions: [".html"]
};

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
  // basenameFileExtensions is an array: clone it as one, or getConfig() would hand out
  // { "0": ".html" }, which for…of cannot iterate. deepFreeze freezes it like any object.
  if (Array.isArray(obj)) return obj.map((item) => deepClone(item)) as T;
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

/**
 * 3.5 forward-compat check. Warns, once per key per page, about an option that 4.0's
 * bootstrapRouter throws on: one this package does not have, a value of another type than its
 * default (null, or an array for an object, included), or a tag name it does not define or that is
 * not a string. An undefined value is left out, as in 4.0. It only warns: setConfig then goes on
 * exactly as in 3.x. Bootstrap-time only, never on a hot path.
 */
function warnInvalid(given: Record<string, unknown>, known: Record<string, unknown>, path = ""): void {
  for (const [key, value] of Object.entries(given)) {
    const name = path + key;
    const current = known[key];
    if (value === undefined) {
      continue;
    }
    if (
      !Object.prototype.hasOwnProperty.call(known, key) ||
      value === null ||
      typeof value !== typeof current ||
      Array.isArray(value) !== Array.isArray(current)
    ) {
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`[@wcstack/router] bootstrapRouter: "${name}" is not one of its options, or not of the option's type. 3.x ignores it or applies it unchecked; 4.0 throws on it.`);
      }
    } else if (name === "tagNames") {
      warnInvalid(value as Record<string, unknown>, current as Record<string, unknown>, "tagNames.");
    }
  }
}

export function setConfig(partialConfig: IWritableConfig): void {
  warnInvalid(partialConfig as Record<string, unknown>, defaults);
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  if (typeof partialConfig.enableShadowRoot === "boolean") {
    _config.enableShadowRoot = partialConfig.enableShadowRoot;
  }
  if (Array.isArray(partialConfig.basenameFileExtensions)) {
    _config.basenameFileExtensions = partialConfig.basenameFileExtensions;
  }
  frozenConfig = null;
}
