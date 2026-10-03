import { raise, M } from "./messages";

/**
 * Page-wide configuration (`bootstrapState(config)`): how this page spells wcstack markup (the tag
 * names, the binding attribute, the anchor comments — fixed before the first definition, the same
 * on the server) and the locale default. How a state tree behaves is its own `$behavior` (engine.ts).
 */
export interface Config {
  bindAttributeName: string;
  /** The text of a `for` template's anchor comment. */
  commentForPrefix: string;
  /** The texts of an `if` / `elseif` / `else` chain's anchor comments. */
  commentIfPrefix: string;
  commentElseIfPrefix: string;
  commentElsePrefix: string;
  tagNames: { state: string; ssr: string };
  locale: string;
  /** Opt-in `analyzeContract()` (dev time); off, it returns at once. */
  enableContractAnalyzer: boolean;
}

export const config: Config = {
  bindAttributeName: "data-wcs",
  commentForPrefix: "wcs-for",
  commentIfPrefix: "wcs-if",
  commentElseIfPrefix: "wcs-elseif",
  commentElsePrefix: "wcs-else",
  tagNames: { state: "wcs-state", ssr: "wcs-ssr" },
  locale: typeof document !== "undefined" ? document.documentElement?.lang || "en" : "en",
  enableContractAnalyzer: false,
};

export type PartialConfig = Partial<Omit<Config, "tagNames">> & { tagNames?: Partial<Config["tagNames"]> };

/**
 * Applies the options given; an undefined value is left out. An option `bootstrapState` does not
 * have (a key 4.0 moved to the state's `$behavior` or removed included), a value of another type
 * than its default (null, or an array for an object, included) or a tag name it does not define
 * throws, and then nothing is applied — the same rule as every package's bootstrap.
 */
export function setConfig(partial: PartialConfig): void {
  const options = config as unknown as Record<string, unknown>;
  const tags = config.tagNames as Record<string, string>;
  const given = Object.entries(partial).filter(([, value]) => value !== undefined);
  const givenTags = Object.entries(partial.tagNames ?? {}).filter(([, tag]) => tag !== undefined);
  for (const [key, value] of given) {
    const current = options[key];
    if (!Object.hasOwn(options, key) || value === null || typeof value !== typeof current || Array.isArray(value) !== Array.isArray(current)) {
      raise(M.OptionInvalid, ["bootstrapState", key]);
    }
  }
  for (const [name, tag] of givenTags) {
    if (!Object.hasOwn(tags, name) || typeof tag !== "string") raise(M.OptionInvalid, ["bootstrapState", `tagNames.${name}`]);
  }
  for (const [key, value] of given) {
    if (key !== "tagNames") {
      options[key] = value;
    }
  }
  for (const [name, tag] of givenTags) tags[name] = tag as string;
}

/** The current configuration (read-only view). */
export const getConfig = (): Readonly<Config> => config;
