import { getPathInfo } from "../address/PathInfo";
import { config } from "../config";
import { getCustomElement } from "../getCustomElement";
import { raiseError } from "../raiseError";
import { IWcBindable } from "../event/types";
import { ParseBindTextResult } from "./types";

function isValidWcBindable(value: unknown): value is IWcBindable {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { protocol?: unknown; version?: unknown; properties?: unknown };
  return v.protocol === "wc-bindable"
    && v.version === 1
    && Array.isArray(v.properties);
}

function makeExpandedEntry(
  name: string,
  base: string,
  stateName: string,
): ParseBindTextResult {
  // Dot-relative spread keeps the loop item root (`.`) without producing `..foo`.
  const expandedPath = base === "." ? `.${name}` : `${base}.${name}`;
  return {
    propName: name,
    propSegments: [name],
    propModifiers: [],
    statePathName: expandedPath,
    statePathInfo: getPathInfo(expandedPath),
    stateName,
    inFilters: [],
    outFilters: [],
    bindingType: 'prop',
  };
}

function dedupKey(r: ParseBindTextResult): string | null {
  switch (r.bindingType) {
    case 'prop':
    case 'event':
    case 'radio':
    case 'checkbox':
      return `${r.bindingType}::${r.propName}`;
    case 'spread':
      return null;
    default:
      return null;
  }
}

export interface IExpandSpreadOptions {
  /**
   * When false, raise an error if the custom element class is not yet defined.
   * When true (default), leave the spread entry in place so the caller can
   * defer expansion via customElements.whenDefined.
   */
  readonly allowDeferred?: boolean;
}

/**
 * Expand spread bind-text entries (`...: target`) into per-prop entries
 * by enumerating wcBindable.properties + inputs of the element's class.
 *
 * Behavior:
 * - With `allowDeferred: true` (default): if class is not yet defined, the
 *   spread entry stays so the caller can wait via customElements.whenDefined.
 * - With `allowDeferred: false`: raises if class is not defined.
 * - Duplicate propName: last-wins (explicit binding overrides spread).
 * - When config.debug, console.debug logs each override.
 * - Mid-`*` in target path is allowed (e.g. `...: stores.*.fetch`).
 *
 * Composite Profile (COMPOSITE.md / SPEC-extensions § 4) support:
 * - A composite shell exposes its synthesized declaration via the standard
 *   `target.constructor.wcBindable` surface (§ 1 Discovery), so this function
 *   handles it without any composite-specific code path.
 * - Composed property names use the `<sourceId>.<sourceName>` pattern
 *   (e.g. "s3.progress"); we keep the dotted name as a single segment so
 *   element member access stays flat (element["s3.progress"], not nested).
 * - The expanded state path becomes `targetBase.s3.progress`, which resolves
 *   as nested state access — author state as `{ s3: { progress: 0 } }` to
 *   mirror the composed structure.
 * - Tier claim (Symbol.for("wc-bindable.composite.tiers")) is not read here;
 *   spread covers observation (T1) and writable inputs (T2) transparently
 *   through normal property assignment, and commands stay out of spread by
 *   design regardless of tier.
 */
export function expandSpread(
  node: Node,
  results: ParseBindTextResult[],
  options: IExpandSpreadOptions = {},
): ParseBindTextResult[] {
  const allowDeferred = options.allowDeferred ?? true;
  if (!results.some(r => r.bindingType === 'spread')) {
    return results;
  }
  const expanded: ParseBindTextResult[] = [];
  const spreadOrigin = new WeakSet<ParseBindTextResult>();
  for (const result of results) {
    if (result.bindingType !== 'spread') {
      expanded.push(result);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      raiseError(`Spread binding requires an element node.`);
    }
    const element = node as Element;
    const tagName = getCustomElement(element);
    if (tagName === null) {
      raiseError(`Spread binding "${result.statePathName}" requires a custom element with wcBindable, but <${element.tagName.toLowerCase()}> is not a custom element.`);
    }
    const customClass = customElements.get(tagName) as { wcBindable?: unknown } | undefined;
    if (typeof customClass === "undefined") {
      if (!allowDeferred) {
        raiseError(`Spread binding "${result.statePathName}" requires <${tagName}> to be registered. Define the custom element before initializing this binding.`);
      }
      // Deferred: keep spread entry intact; caller retries via whenDefined.
      expanded.push(result);
      continue;
    }
    const bindable = customClass.wcBindable;
    if (!isValidWcBindable(bindable)) {
      raiseError(`Spread binding "${result.statePathName}" requires <${tagName}> to declare wcBindable (protocol="wc-bindable", version=1).`);
    }
    const targetBase = result.statePathName;
    const stateName = result.stateName;
    const seen = new Set<string>();
    for (const prop of bindable.properties) {
      if (seen.has(prop.name)) continue;
      seen.add(prop.name);
      const entry = makeExpandedEntry(prop.name, targetBase, stateName);
      spreadOrigin.add(entry);
      expanded.push(entry);
    }
    // properties win over inputs when the name overlaps because they carry the
    // full property contract (for example change events).
    for (const input of (bindable.inputs ?? [])) {
      if (seen.has(input.name)) continue;
      seen.add(input.name);
      const entry = makeExpandedEntry(input.name, targetBase, stateName);
      spreadOrigin.add(entry);
      expanded.push(entry);
    }
  }
  // Last-wins de-duplication
  const lastIndexByKey = new Map<string, number>();
  for (let i = 0; i < expanded.length; i++) {
    const key = dedupKey(expanded[i]);
    if (key !== null) {
      lastIndexByKey.set(key, i);
    }
  }
  const final: ParseBindTextResult[] = [];
  for (let i = 0; i < expanded.length; i++) {
    const key = dedupKey(expanded[i]);
    if (key === null) {
      final.push(expanded[i]);
      continue;
    }
    if (lastIndexByKey.get(key) === i) {
      final.push(expanded[i]);
    } else if (config.debug && spreadOrigin.has(expanded[i])) {
      const overrider = expanded[lastIndexByKey.get(key)!];
      const tagText = node.nodeType === Node.ELEMENT_NODE
        ? `<${(node as Element).tagName.toLowerCase()}>`
        : 'node';
      console.debug(`[@wcstack/state] spread: prop "${expanded[i].propName}" of ${tagText} overridden by explicit binding (statePath: "${overrider.statePathName}").`);
    }
  }
  return final;
}

export function hasUnresolvedSpread(results: ParseBindTextResult[]): boolean {
  return results.some(r => r.bindingType === 'spread');
}
