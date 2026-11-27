/**
 * core/sidecar/statePaths.ts
 *
 * The paths of the state file a stateSchema was generated from (`wcstack.application.stateSource`, since 4.26), shared
 * by the discovery of a page's manifest (discover.ts) and the set of manifests one CLI run is given (loader.ts — which
 * discover.ts imports, so the helpers live here).
 *
 * pure（DOM / vscode / node fs 非依存）。
 */

/** A path's segments, `.` dropped and `..` folded where it can be; whether it is absolute (`/…`, `C:/…`). */
export function segmentsOf(path: string): { readonly absolute: boolean; readonly segments: string[] } {
  const norm = path.replace(/\\/g, "/");
  const absolute = norm.startsWith("/") || /^[A-Za-z]:\//.test(norm);
  const segments: string[] = [];
  for (const segment of norm.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
    else segments.push(/^[A-Za-z]:$/.test(segment) ? segment.toUpperCase() : segment);
  }
  return { absolute, segments };
}

/** The same file for the scoping: a path's `.ts` / `.mts` counts as its `.js` / `.mjs` (what a build emits). */
export function sameStateFile(a: string, b: string): boolean {
  const canonical = (p: string): string => p.replace(/\.ts$/, ".js").replace(/\.mts$/, ".mjs");
  return canonical(a) === canonical(b);
}

/**
 * Whether two manifests' `stateSource` name different state files: each is resolved against its own manifest's
 * directory, in the frame of the manifests' sources (relative to one directory, or absolute). Two in different frames
 * cannot be told apart, and count as the same file.
 */
export function differentStateFiles(manifestA: string, stateSourceA: string, manifestB: string, stateSourceB: string): boolean {
  const a = segmentsOf(manifestA);
  const b = segmentsOf(manifestB);
  if (a.absolute !== b.absolute) return false;
  const file = (manifest: string[], stateSource: string): string => segmentsOf([...manifest.slice(0, -1), stateSource].join("/")).segments.join("/");
  return !sameStateFile(file(a.segments, stateSourceA), file(b.segments, stateSourceB));
}
