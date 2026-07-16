// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/wc-bindable-reader.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

import type {
  IWcBindable,
  IWcBindableCommand,
  IWcBindableInput,
  IWcBindableProperty,
} from "./wcBindable.js";

export const MIN_WC_BINDABLE_VERSION = 1;

export interface WcBindableElement {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  readonly constructor: {
    readonly wcBindable: IWcBindable;
  };
}

export interface ReadBindableResult {
  readonly target: WcBindableElement;
  readonly liveDeclaration: IWcBindable;
  readonly knownProperties: ReadonlyMap<string, IWcBindableProperty>;
  readonly declaredInputs: ReadonlyMap<string, IWcBindableInput>;
  readonly declaredCommands: ReadonlyMap<string, IWcBindableCommand>;
}

/**
 * Repository-local conformance mirror of @wc-bindable/core's
 * getWcBindableDeclaration(). Discovery has one path only:
 * target.constructor.wcBindable.
 *
 * The declaration remains live. The maps are read-time indexes and are not a
 * clone, freeze, or normalized replacement for liveDeclaration.
 */
export function readBindableDeclaration(target: unknown): ReadBindableResult | null {
  try {
    if (target === null || (typeof target !== "object" && typeof target !== "function")) {
      return null;
    }

    const candidate = target as {
      readonly addEventListener?: unknown;
      readonly removeEventListener?: unknown;
      readonly constructor?: { readonly wcBindable?: IWcBindable };
    };
    const addEventListener = candidate.addEventListener;
    const removeEventListener = candidate.removeEventListener;
    const declaration = candidate.constructor?.wcBindable;

    if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
      return null;
    }
    if (declaration?.protocol !== "wc-bindable") return null;
    if (!Number.isInteger(declaration.version) || declaration.version < MIN_WC_BINDABLE_VERSION) {
      return null;
    }

    const knownProperties = readNamedList(declaration.properties, isValidPropertyDescriptor);
    if (knownProperties === null) return null;

    const declaredInputs = declaration.inputs === undefined
      ? new Map<string, IWcBindableInput>()
      : readNamedList(declaration.inputs, isValidInputDescriptor);
    if (declaredInputs === null) return null;

    const declaredCommands = declaration.commands === undefined
      ? new Map<string, IWcBindableCommand>()
      : readNamedList(declaration.commands, isValidCommandDescriptor);
    if (declaredCommands === null) return null;

    return {
      target: target as WcBindableElement,
      liveDeclaration: declaration,
      knownProperties,
      declaredInputs,
      declaredCommands,
    };
  } catch {
    return null;
  }
}

function isValidPropertyDescriptor(value: unknown): value is IWcBindableProperty {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Partial<IWcBindableProperty>;
  if (typeof descriptor.name !== "string" || descriptor.name.length === 0) return false;
  if (typeof descriptor.event !== "string" || descriptor.event.length === 0) return false;
  return descriptor.getter === undefined || typeof descriptor.getter === "function";
}

function isValidInputDescriptor(value: unknown): value is IWcBindableInput {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Partial<IWcBindableInput>;
  if (typeof descriptor.name !== "string" || descriptor.name.length === 0) return false;
  return descriptor.attribute === undefined || typeof descriptor.attribute === "string";
}

function isValidCommandDescriptor(value: unknown): value is IWcBindableCommand {
  if (typeof value !== "object" || value === null) return false;
  const descriptor = value as Partial<IWcBindableCommand>;
  if (typeof descriptor.name !== "string" || descriptor.name.length === 0) return false;
  return descriptor.async === undefined || typeof descriptor.async === "boolean";
}

function readNamedList<T extends { readonly name: string }>(
  value: unknown,
  isValidEntry: (entry: unknown) => entry is T,
): ReadonlyMap<string, T> | null {
  if (!Array.isArray(value)) return null;
  const entries = new Map<string, T>();
  for (const entry of value) {
    if (!isValidEntry(entry) || entries.has(entry.name)) return null;
    entries.set(entry.name, entry);
  }
  return entries;
}
