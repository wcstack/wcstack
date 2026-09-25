/**
 * Constants of the `data-wcs` binding grammar, copied from `@wcstack/state`
 * (`src/define.ts` / `src/errorGuidance.ts`). The values are the syntax contract
 * (`[prop][#mod]: [path][|filter...]`) and must stay identical to the current engine.
 */

/** Path segment delimiter. */
export const DELIMITER = '.';
/** Separator between the bindings of one attribute value. */
export const BINDING_SEPARATOR = ';';
/** Separator between the left side (property) and the right side (path). */
export const PROP_VALUE_SEPARATOR = ':';
/** Separator between the property and its modifier list. */
export const MODIFIER_SEPARATOR = '#';
/** Separator of the filter pipeline. */
export const FILTER_SEPARATOR = '|';

export const ELSE_KEYWORD = 'else';
export const SPREAD_PROP = '...';
export const EVENT_PROP_PREFIX = 'on';
export const EVENT_TOKEN_NAMESPACE = 'eventToken';
/** `<wcs-state mount>` left side `state.<key>: path` (volume injection). */
export const VOLUME_INJECTION_PROP = 'state';
export const COMMAND_NAMESPACE = 'command';
export const CLASS_NAMESPACE = 'class';
export const ATTR_NAMESPACE = 'attr';
export const STYLE_NAMESPACE = 'style';

/**
 * Segment-count ceiling of one path. The current engine enforces it in `getPathInfo`
 * (first intern only) with a `[wcs/binding-syntax]` diagnostic; the parser port keeps the
 * same check inline on the string.
 */
export const MAX_PATH_SEGMENTS = 512;

/** Recursive wildcard — only meaningful in `$recursion` declarations, never in a binding path. */
export const RECURSION_WILDCARD = '**';

/** Appended to the syntax diagnostics that `@wcstack/lint` also detects. */
