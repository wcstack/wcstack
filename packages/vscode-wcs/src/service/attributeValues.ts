/**
 * attributeValues.ts — what a boolean written through `attr.<name>:` means for the attribute it names.
 *
 * The runtime writes an attribute as `String(value)` (state's dom/view.ts, `K_ATTR`): `true` is `"true"`, `false` is
 * `"false"`, and only `null` / `undefined` remove it. Whether that is right depends on the attribute:
 *   - an attribute whose values are the words `true` / `false` (the ARIA states, `contenteditable`, `draggable`, …)
 *     takes exactly that text;
 *   - a boolean attribute (`disabled`, `hidden`, `required`, …) is on whenever it is present, so `disabled="false"`
 *     still disables — the element's property is what takes a boolean;
 *   - any other attribute is written as the text and never removed.
 * The ekiden-entry seam app got `"attr.aria-invalid" requires a string (current type: boolean)` for
 * `attr.aria-invalid: flag|truthy`, which is right as written, and nothing that says what `attr.disabled: flag` does.
 *
 * pure (DOM / vscode 非依存).
 */

/**
 * The WAI-ARIA states and properties whose value type takes `true` / `false`: true/false, true/false/undefined,
 * tristate, and the token lists that include them (`aria-current`, `aria-haspopup`, `aria-invalid`).
 *
 * Source: WAI-ARIA 1.2 (W3C Recommendation 2023-06-06), https://www.w3.org/TR/wai-aria-1.2/#state_prop_def — the
 * names are a subset of ariaValidator's ARIA_ATTRIBUTES. An ID reference, a number, a string or another token list
 * (`aria-label`, `aria-level`, `aria-live`) is not here: a boolean there is written as a text that attribute does not
 * take.
 */
const ARIA_TRUE_FALSE: ReadonlySet<string> = new Set([
  'aria-atomic', 'aria-busy', 'aria-checked', 'aria-current', 'aria-disabled', 'aria-expanded', 'aria-grabbed',
  'aria-haspopup', 'aria-hidden', 'aria-invalid', 'aria-modal', 'aria-multiline', 'aria-multiselectable',
  'aria-pressed', 'aria-readonly', 'aria-required', 'aria-selected',
]);

/** HTML's enumerated attributes whose keywords are `true` and `false` (https://html.spec.whatwg.org/). */
const ENUMERATED_TRUE_FALSE: ReadonlySet<string> = new Set(['contenteditable', 'draggable', 'spellcheck', 'writingsuggestions']);

/**
 * HTML's boolean attributes (https://html.spec.whatwg.org/multipage/indices.html#attributes-3, "Boolean attribute"),
 * and `hidden` (enumerated, but any value it does not know — `"false"` too — hides): the attribute, and the property
 * of the element that takes a boolean. An attribute without such a property on its element (`itemscope`, the
 * `shadowroot*` ones of a `<template>`) is left out.
 */
const BOOLEAN_ATTRIBUTE_PROPERTY: Readonly<Record<string, string>> = {
  allowfullscreen: 'allowFullscreen',
  async: 'async',
  autofocus: 'autofocus',
  autoplay: 'autoplay',
  checked: 'checked',
  controls: 'controls',
  default: 'default',
  defer: 'defer',
  disabled: 'disabled',
  formnovalidate: 'formNoValidate',
  hidden: 'hidden',
  inert: 'inert',
  ismap: 'isMap',
  loop: 'loop',
  multiple: 'multiple',
  muted: 'muted',
  nomodule: 'noModule',
  novalidate: 'noValidate',
  open: 'open',
  playsinline: 'playsInline',
  readonly: 'readOnly',
  required: 'required',
  reversed: 'reversed',
  selected: 'selected',
};

/** What `"true"` / `"false"` written to an attribute is. */
export type BooleanAttributeText =
  /** The attribute's own values (`aria-invalid="false"`): right as written. */
  | { readonly kind: 'value' }
  /** A boolean attribute of a native element: on whenever present. `property` takes the boolean. */
  | { readonly kind: 'presence'; readonly property: string }
  /** Any other attribute: the text, never removed. */
  | { readonly kind: 'text' };

/**
 * What a boolean bound to `attr.<name>:` on `<tag>` gives. A custom element's attribute named like a boolean one
 * (`<my-button disabled>`) is `text`: whether it has a property of that name is its own business.
 */
export function booleanAttributeText(name: string, tag: string | undefined): BooleanAttributeText {
  const attribute = name.toLowerCase();
  if (ARIA_TRUE_FALSE.has(attribute) || ENUMERATED_TRUE_FALSE.has(attribute)) return { kind: 'value' };
  const native = tag !== undefined && !tag.includes('-');
  if (native && Object.hasOwn(BOOLEAN_ATTRIBUTE_PROPERTY, attribute)) {
    return { kind: 'presence', property: BOOLEAN_ATTRIBUTE_PROPERTY[attribute] };
  }
  return { kind: 'text' };
}
