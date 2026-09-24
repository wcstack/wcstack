/** Page-wide configuration (`bootstrapState(config)`), the same option names as @wcstack/state. */
export interface Config {
  bindAttributeName: string;
  tagNames: { state: string };
  enableMustache: boolean;
  locale: string;
  debug: boolean;
  /**
   * EXPERIMENT: row event bindings of bubbling events are delegated to one listener per
   * event type on the root. Handlers then see the root as `event.currentTarget`.
   */
  delegateEvents: boolean;
}

export const config: Config = {
  bindAttributeName: "data-wcs",
  tagNames: { state: "wcs-state" },
  enableMustache: true,
  locale: typeof document !== "undefined" ? document.documentElement?.lang || "en" : "en",
  debug: false,
  delegateEvents: false,
};

export type PartialConfig = Partial<Omit<Config, "tagNames">> & { tagNames?: Partial<Config["tagNames"]> };

export function setConfig(partial: PartialConfig): void {
  if (partial.tagNames) Object.assign(config.tagNames, partial.tagNames);
  if (typeof partial.bindAttributeName === "string") config.bindAttributeName = partial.bindAttributeName;
  if (typeof partial.enableMustache === "boolean") config.enableMustache = partial.enableMustache;
  if (typeof partial.locale === "string") config.locale = partial.locale;
  if (typeof partial.debug === "boolean") config.debug = partial.debug;
}
