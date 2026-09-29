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
 * Takes each option of the type the default has (an undefined value is left out); any other key
 * or type throws, a key 4.0 moved to the state's `$behavior` or removed included.
 */
export function setConfig(partial: PartialConfig): void {
  for (const key in partial) {
    const value = (partial as any)[key];
    if (value === undefined) continue;
    const current = (config as any)[key];
    if (typeof value !== typeof current) raise(M.OptionInvalid, ["bootstrapState", key]);
    if (key === "tagNames") Object.assign(current, value);
    else (config as any)[key] = value;
  }
}

/** The current configuration (read-only view). */
export const getConfig = (): Readonly<Config> => config;
