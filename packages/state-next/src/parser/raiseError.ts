/**
 * Local replacement of `@wcstack/state`'s `raiseError`. Same thrown message, including the
 * `[@wcstack/state] ` prefix, so diagnostics (and anything matching on them, e.g. the
 * vscode-wcs `[wcs/binding-syntax]` filter) are unchanged.
 */
export function raiseError(message: string): never {
  throw new Error(`[@wcstack/state] ${message}`);
}
