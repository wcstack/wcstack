// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/define-element.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

/**
 * One copy of each package on a page (docs/timing-and-firing-contract.md §24). The first copy the
 * page evaluates defines the tags and a second one does nothing, so a copy that finds its tag defined
 * by another copy of the package — not its class, not a subclass of it, not the same version — warns
 * `[wcs/package-twice]` once per registry, naming both versions. The classes it defines carry
 * `"<package>@<version>"` under `Symbol.for("wcstack.package")`; a class without it is named
 * "another copy of <package> that does not name its version" (an older copy, or one loaded through
 * an entry that does not stamp).
 */

/** The static a class defined through this helper carries: `"@wcstack/fetch@<version>"`. */
export const PACKAGE_STAMP: unique symbol = Symbol.for("wcstack.package");

type Stamped = { [PACKAGE_STAMP]?: string };

/** The registries this copy warned about: one warning per package per registry. */
const warned = new WeakSet<CustomElementRegistry>();

/**
 * Marks `cls` as defined by `pkg` (`"@wcstack/fetch@<version>"`). A subclass inherits the mark, and
 * `defineProperty` writes it even where a parent's mark is read-only.
 */
export function stampPackage(cls: CustomElementConstructor, pkg: string): void {
  Object.defineProperty(cls, PACKAGE_STAMP, { value: pkg, configurable: true });
}

/**
 * Warns when `tag` is defined as `existing` by another copy of the package `pkg` names: `existing`
 * is neither `own` nor a subclass of it (omit `own` when the copy has no class to compare with), and
 * carries another version or none. Once per registry.
 */
export function warnIfAnotherCopy(
  registry: CustomElementRegistry,
  tag: string,
  existing: CustomElementConstructor,
  own: CustomElementConstructor | undefined,
  pkg: string,
): void {
  if (own !== undefined && (existing === own || existing.prototype instanceof own)) return;
  const theirs = (existing as Stamped)[PACKAGE_STAMP];
  if (theirs === pkg || warned.has(registry)) return;
  warned.add(registry);
  const name = pkg.slice(0, pkg.lastIndexOf("@"));
  console.warn(
    `[${name}] [wcs/package-twice] <${tag}> is already defined by ` +
    `${theirs ?? `another copy of ${name} that does not name its version`}; ` +
    `this copy, ${pkg}, does nothing. Load each package once.`,
  );
}

/**
 * Defines each `[tag, class]` in `registry` unless the tag is already defined, stamping the class
 * with `pkg` (`"@wcstack/fetch@<version>"`). A tag another copy of the package defined first is left
 * as it is, with the warning above.
 */
export function defineElements(
  registry: CustomElementRegistry,
  pkg: string,
  definitions: readonly (readonly [tag: string, cls: CustomElementConstructor])[],
): void {
  for (const [tag, cls] of definitions) {
    const existing = registry.get(tag);
    if (existing === undefined) {
      stampPackage(cls, pkg);
      registry.define(tag, cls);
    } else {
      warnIfAnotherCopy(registry, tag, existing, cls, pkg);
    }
  }
}
