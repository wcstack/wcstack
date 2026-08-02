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

export function setConfig(partialConfig: IWritableConfig): void {
  if (partialConfig.tagNames) {
    Object.assign(_config.tagNames, partialConfig.tagNames);
  }
  if (partialConfig.createContext) {
    _config.createContext = partialConfig.createContext;
  }
  frozenConfig = null;
}
