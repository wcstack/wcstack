import pkg from "../package.json" with { type: "json" };

/** The package version: stamped into `<wcs-ssr>`, compared on hydration (major.minor), shown by DevTools. */
export const VERSION: string = pkg.version;
