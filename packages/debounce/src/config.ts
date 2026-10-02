import { IConfig, IWritableConfig } from "./types.js";

interface IInternalConfig extends IConfig {
  autoTrigger: boolean;
  triggerAttribute: string;
  tagNames: {
    debounce: string;
    throttle: string;
  };
}

const _config: IInternalConfig = {
  autoTrigger: true,
  triggerAttribute: "data-debouncetarget",
  tagNames: {
    debounce: "wcs-debounce",
    throttle: "wcs-throttle",
  },
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
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone((obj as Record<string, unknown>)[key]);
  }
  return clone as T;
}

let frozenConfig: IConfig | null = null;

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
 * bootstrapDebounce throws on: one this package does not have, a value of another type than its
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
        console.warn(`[@wcstack/debounce] bootstrapDebounce: "${name}" is not one of its options, or not of the option's type. 3.x ignores it or applies it unchecked; 4.0 throws on it.`);
      }
    } else if (name === "tagNames") {
      warnInvalid(value as Record<string, unknown>, current as Record<string, unknown>, "tagNames.");
    }
  }
}

export function setConfig(partialConfig: IWritableConfig): void {
  warnInvalid(partialConfig as Record<string, unknown>, defaults);
  if (typeof partialConfig.autoTrigger === "boolean") {
    _config.autoTrigger = partialConfig.autoTrigger;
  }
  if (typeof partialConfig.triggerAttribute === "string") {
    _config.triggerAttribute = partialConfig.triggerAttribute;
  }
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  frozenConfig = null;
}
