import { IConfig, IWritableConfig } from "./types.js";
import { defaultCreateContext } from "./core/audioContext.js";

interface IInternalConfig extends IConfig {
  tagNames: {
    audio: string; voice: string; osc: string; noise: string; biquad: string;
    gain: string; delay: string; shaper: string; env: string; lfo: string;
    analyser: string;
  };
  createContext: () => BaseAudioContext | null;
}

const _config: IInternalConfig = {
  tagNames: {
    audio: "wcs-audio",
    voice: "wcs-voice",
    osc: "wcs-osc",
    noise: "wcs-noise",
    biquad: "wcs-biquad",
    gain: "wcs-gain",
    delay: "wcs-delay",
    shaper: "wcs-shaper",
    env: "wcs-env",
    lfo: "wcs-lfo",
    analyser: "wcs-analyser",
  },
  createContext: defaultCreateContext,
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
    // createContext is a function, so it is carried over by reference rather
    // than cloned — deepClone would turn it into an empty object.
    frozenConfig = deepFreeze({
      ...deepClone({ tagNames: _config.tagNames }),
      createContext: _config.createContext,
    }) as IConfig;
  }
  return frozenConfig;
}

/** A misspelt option would otherwise do nothing: `bootstrapAudio` refuses it. */
function invalid(key: string): never {
  throw new Error(`[@wcstack/audio] bootstrapAudio: "${key}" is not one of its options, or not of the option's type.`);
}

/**
 * Applies the options given; an undefined value is left out. An option this package does not
 * have, a value of another type than its default (null, or an array for an object, included) or
 * a tag name it does not define throws, and then nothing is applied.
 */
export function setConfig(partialConfig: IWritableConfig): void {
  const options = _config as unknown as Record<string, unknown>;
  const tags = _config.tagNames as Record<string, string>;
  const given = Object.entries(partialConfig).filter(([, value]) => value !== undefined);
  const givenTags = Object.entries(partialConfig.tagNames ?? {}).filter(([, tag]) => tag !== undefined);
  for (const [key, value] of given) {
    const current = options[key];
    if (!Object.hasOwn(options, key) || value === null || typeof value !== typeof current || Array.isArray(value) !== Array.isArray(current)) {
      invalid(key);
    }
  }
  for (const [name, tag] of givenTags) {
    if (!Object.hasOwn(tags, name) || typeof tag !== "string") invalid(`tagNames.${name}`);
  }
  for (const [key, value] of given) {
    if (key !== "tagNames") {
      options[key] = value;
    }
  }
  for (const [name, tag] of givenTags) tags[name] = tag as string;
  frozenConfig = null;
}
