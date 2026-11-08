/**
 * core/cli/glob.ts — the CLI's own expansion of a file pattern (`templates/*.html`, `src/**\/*.html`).
 *
 * A POSIX shell expands a pattern before the CLI sees it; cmd.exe and PowerShell do not, and npm runs a package's
 * scripts with cmd.exe on Windows — so `wcs-validate --errors-only templates/*.html` in an npm script got the pattern
 * itself and failed with `cannot read templates/*.html: ENOENT` (the community-hall seam app; the lint README's own
 * example is `src/**\/*.html`). cli.ts expands an argument that names no existing file and has a pattern character.
 *
 * What a pattern can hold, as a shell's: `*` (any characters in one path segment), `?` (one character), `[abc]` /
 * `[a-z]` / `[!abc]` (one of / none of), `{a,b}` (each alternative, nested too), and `**` as a whole segment (any
 * number of directories, none included). `/` separates segments (cli.ts turns `\` into `/` on Windows). As in a shell,
 * `*`, `?` and `[…]` do not match a name that starts with `.` unless the pattern's segment does; `**` does not enter a
 * directory that starts with `.` nor `node_modules` (a dependency's pages are not the project's). The matches are
 * sorted and unique; the leading segments without a pattern character are kept as written (`templates/a.html`).
 *
 * pure: the directories are read through `GlobFs` (node's fs in cli.ts, a table in the tests). `fs.globSync` is not
 * used: it is Node 22's, experimental before 22.17, and the published lint declares no Node version.
 */

/** A directory's entries: the names, and whether each is a directory. undefined when the directory cannot be read. */
export interface GlobFs {
  readDir(path: string): readonly { readonly name: string; readonly dir: boolean }[] | undefined;
}

/** Whether an argument has a pattern character (`*`, `?`, `[`, `{`). */
export function hasGlobMagic(arg: string): boolean {
  return /[*?[{]/.test(arg);
}

/** The files a pattern matches (sorted, unique). `pattern` separates segments with `/`. */
export function expandGlob(pattern: string, fs: GlobFs): string[] {
  const found = new Set<string>();
  for (const alternative of expandBraces(pattern)) {
    const segments = alternative.split('/');
    // the leading segments without a pattern character are the directory the walk starts in, as written
    let i = 0;
    while (i < segments.length - 1 && !hasGlobMagic(segments[i])) i++;
    const base = segments.slice(0, i).join('/');
    // `/x/*.html`: the first segment is empty (the root) — the base is `/`
    walk(fs, base === '' && alternative.startsWith('/') ? '/' : base, segments.slice(i), found);
  }
  return [...found].sort();
}

function join(dir: string, name: string): string {
  if (dir === '') return name;
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

function walk(fs: GlobFs, dir: string, segments: readonly string[], found: Set<string>): void {
  const [segment, ...rest] = segments;
  if (segment === '**') {
    // a last `**` (`src/**`): every file below
    if (rest.length === 0) {
      walk(fs, dir, ['**', '*'], found);
      return;
    }
    // none: the rest from here; then each directory below, `**` still to match
    walk(fs, dir, rest, found);
    for (const entry of fs.readDir(dir === '' ? '.' : dir) ?? []) {
      if (!entry.dir || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      walk(fs, join(dir, entry.name), segments, found);
    }
    return;
  }
  const entries = fs.readDir(dir === '' ? '.' : dir);
  if (entries === undefined) return;
  const matches = segmentMatcher(segment);
  for (const entry of entries) {
    if (!matches(entry.name)) continue;
    if (rest.length === 0) {
      if (!entry.dir) found.add(join(dir, entry.name));
    } else if (entry.dir) {
      walk(fs, join(dir, entry.name), rest, found);
    }
  }
}

/** A test for one segment's names: literal, or `*` / `?` / `[…]` (a leading `.` only when the segment has one). */
function segmentMatcher(segment: string): (name: string) => boolean {
  if (!hasGlobMagic(segment)) return (name) => name === segment;
  let source = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else if (ch === '[') {
      const close = segment.indexOf(']', i + 2);
      if (close === -1) {
        source += '\\[';
        continue;
      }
      let body = segment.slice(i + 1, close);
      const negate = body.startsWith('!') || body.startsWith('^');
      if (negate) body = body.slice(1);
      source += `[${negate ? '^' : ''}${body.replace(/[\\\]]/g, '\\$&')}]`;
      i = close;
    } else {
      source += ch.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
  }
  const regex = new RegExp(`^${source}$`);
  const dotted = segment.startsWith('.');
  return (name) => (dotted || !name.startsWith('.')) && regex.test(name);
}

/** `a/{b,c}/*.html` → `a/b/*.html`, `a/c/*.html` (the first top-level brace group, then the rest of each). */
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  let depth = 0;
  const commas: number[] = [];
  for (let i = open; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // `{a}` (no comma) is not a group: kept as written
        if (commas.length === 0) return expandBraces(pattern.slice(i + 1)).map((tail) => pattern.slice(0, i + 1) + tail);
        const head = pattern.slice(0, open);
        const tail = pattern.slice(i + 1);
        const bounds = [open, ...commas, i];
        const out: string[] = [];
        for (let k = 0; k < bounds.length - 1; k++) {
          out.push(...expandBraces(head + pattern.slice(bounds[k] + 1, bounds[k + 1]) + tail));
        }
        return out;
      }
    } else if (ch === ',' && depth === 1) {
      commas.push(i);
    }
  }
  // unclosed: kept as written
  return [pattern];
}
