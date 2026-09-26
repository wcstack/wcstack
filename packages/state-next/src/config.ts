/** Page-wide configuration (`bootstrapState(config)`), the same option names as @wcstack/state 3.x. */
export interface Config {
  bindAttributeName: string;
  /** Kept for 3.x configurations: the new engine binds `{{ }}` text without comment nodes. */
  commentTextPrefix: string;
  /** The text of a `for` template's anchor comment. */
  commentForPrefix: string;
  /** The texts of an `if` / `elseif` / `else` chain's anchor comments. */
  commentIfPrefix: string;
  commentElseIfPrefix: string;
  commentElsePrefix: string;
  tagNames: { state: string; ssr: string };
  enableMustache: boolean;
  locale: string;
  debug: boolean;
  /** Direction-aware initial-sync authority for wc-bindable members; false: state wins every initial sync and `#init=` / `#sync=` throw. */
  enableDirectionalInitialSync: boolean;
  /** Kept for 3.x configurations: the new engine stops two-way echoes structurally, with no bookkeeping to opt out of. */
  enablePropagationContext: boolean;
  /** Opt-in `analyzeContract()` (dev time); off, it returns at once. */
  enableContractAnalyzer: boolean;
  /** Drop a primitive write `Object.is`-equal to the current value; false lets equal writes through (and `$watch`'s `prev` is undefined). */
  sameValueGuard: boolean;
}

export const config: Config = {
  bindAttributeName: "data-wcs",
  commentTextPrefix: "wcs-text",
  commentForPrefix: "wcs-for",
  commentIfPrefix: "wcs-if",
  commentElseIfPrefix: "wcs-elseif",
  commentElsePrefix: "wcs-else",
  tagNames: { state: "wcs-state", ssr: "wcs-ssr" },
  enableMustache: true,
  locale: typeof document !== "undefined" ? document.documentElement?.lang || "en" : "en",
  debug: false,
  enableDirectionalInitialSync: true,
  enablePropagationContext: true,
  enableContractAnalyzer: false,
  sameValueGuard: true,
};

export type PartialConfig = Partial<Omit<Config, "tagNames">> & { tagNames?: Partial<Config["tagNames"]> };

/** Takes each option of the type the default has; the rest is ignored. */
export function setConfig(partial: PartialConfig): void {
  if (partial.tagNames) Object.assign(config.tagNames, partial.tagNames);
  for (const key in config) {
    const value = (partial as any)[key];
    if (key !== "tagNames" && typeof value === typeof (config as any)[key]) (config as any)[key] = value;
  }
}

/** The current configuration (read-only view). */
export const getConfig = (): Readonly<Config> => config;
