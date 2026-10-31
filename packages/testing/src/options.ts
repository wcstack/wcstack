/**
 * The options a helper takes: for each name, the test of its value and the type the message names.
 */
export type OptionSpec = Readonly<Record<string, readonly [test: (value: unknown) => boolean, type: string]>>;

export const isString = (value: unknown): boolean => typeof value === "string";
export const isNumber = (value: unknown): boolean => typeof value === "number";
export const isBoolean = (value: unknown): boolean => typeof value === "boolean";
export const isFunction = (value: unknown): boolean => typeof value === "function";
export const isObject = (value: unknown): boolean => typeof value === "object" && value !== null;
export const isAny = (): boolean => true;

/**
 * Refuses an option the helper does not have, or a value not of the option's type, before the helper
 * does anything — as every package's `bootstrapXxx()` does. A misspelt option did nothing:
 * `mount(html, { resolveModul })` failed later with Node's `ERR_UNSUPPORTED_ESM_URL_SCHEME`, far from
 * the typo (docs/seam-apps.md, homeroom). An option whose value is `undefined` is skipped.
 */
export function checkOptions(helper: string, options: unknown, spec: OptionSpec, hint = ""): void {
  const list = (): string => Object.entries(spec).map(([name, [, type]]) => `${name} (${type})`).join(", ");
  if (!isObject(options) || Array.isArray(options)) {
    throw new Error(`@wcstack/testing: ${helper}: its options must be an object. Its options: ${list()}.`);
  }
  for (const [name, value] of Object.entries(options as object)) {
    if (value === undefined) continue;
    const entry = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (entry === undefined || !entry[0](value)) {
      throw new Error(
        `@wcstack/testing: ${helper}: "${name}" is not one of its options, or not of the option's type. Its options: ${list()}.${hint}`,
      );
    }
  }
}
