/**
 * paths.property.test.ts — the laws of a path, over generated strings (docs/verification-practices-study.md
 * §2.5 (c); the rules are README §3.6 and #694's decisions).
 *
 * - A path the app writes is put in `location.pathname`'s form (encodePathname) and the URL's segments are
 *   decoded (decodeSegment): a segment with no "%" comes back as it was written.
 * - Encoding and normalizing are idempotent: a path already in the form stays.
 * - A path the app writes reaches the route it means: a static segment matches the characters written, and
 *   a param comes back decoded.
 *
 * Outside the laws, on purpose — the browser's URL parser does the same to `location.pathname`: a "%" the
 * app writes is an escape already (left alone), "." / ".." segments are resolved, a tab or a line break is
 * dropped, trailing spaces and control characters are trimmed, a backslash is read as a slash, and a lone
 * surrogate has no UTF-8 form.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fc from 'fast-check';
import { bootstrapRouter } from '../src/exports';
import { encodePathname, decodeSegment, normalizePathname } from '../src/normalizePathname';
import { matchRoutes } from '../src/matchRoutes';
import type { Router } from '../src/components/Router';
import type { Route } from '../src/components/Route';

beforeAll(() => {
  bootstrapRouter();
  document.head.innerHTML = '<base href="/">';
  history.replaceState(null, '', '/');
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** A segment the app may write that the laws cover (see the header for what is left out). */
const segment = fc
  .string({ unit: 'grapheme', minLength: 1, maxLength: 8 })
  .filter((s) => !/[/\\%\t\n\r]/.test(s) && s !== '.' && s !== '..' && !/[\u0000- ]$/.test(s));
/**
 * A static segment of a route's path: the route syntax is not one — a whole segment `*` is the catch-all and
 * one starting with `:` a param (README §3; CI's fast-check seed found `path="/s/*"` matching `/s/&`).
 */
const staticSegment = segment.filter((s) => s !== '*' && !s.startsWith(':'));
/** Any path the app may write (what the laws of idempotence take): anything but a backslash. */
const anyPath = fc.string({ unit: 'grapheme', maxLength: 16 }).filter((s) => !s.includes('\\'));

function routerOf(...paths: string[]): Router {
  const router = document.createElement('wcs-router') as Router;
  document.body.appendChild(router);
  for (const path of paths) {
    const route = document.createElement('wcs-route') as Route;
    route.setAttribute('path', path);
    route.setAttribute('name', path);
    route.initialize(router, null);
  }
  return router;
}

describe('パスの法則（property、§2.5 (c)）', () => {
  it('% の無いセグメントは、エンコードしてデコードすると書いたとおりに戻る（複数のセグメントでも）', () => {
    fc.assert(fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), (segs) => {
      const encoded = encodePathname('/' + segs.join('/'));
      expect(encoded.split('/').slice(1).map(decodeSegment)).toEqual(segs);
    }), { numRuns: 500 });
  });

  it('エンコードは冪等: location.pathname の形のパスは変わらない', () => {
    fc.assert(fc.property(anyPath, (s) => {
      const once = encodePathname('/' + s.replace(/\/{2,}/g, '/').replace(/^\//, ''));
      expect(encodePathname(once)).toBe(once);
    }), { numRuns: 500 });
  });

  it('正規化は冪等', () => {
    fc.assert(fc.property(anyPath, (s) => {
      const once = normalizePathname(s);
      expect(normalizePathname(once)).toBe(once);
    }), { numRuns: 500 });
  });

  it('アプリが書いたパスは意図したルートに当たる: 静的なセグメントは書いたままの文字で、param はデコードして返る', () => {
    fc.assert(fc.property(staticSegment, segment, (lit, value) => {
      fc.pre(lit !== value);
      document.body.innerHTML = '';
      const router = routerOf(`/s/${lit}`, '/p/:id');
      const statik = matchRoutes(router, normalizePathname(`/s/${lit}`));
      expect(statik?.routes.at(-1)?.name).toBe(`/s/${lit}`);
      // a static segment is not a pattern: another value at its place does not match it
      expect(matchRoutes(router, normalizePathname(`/s/${value}`))?.routes.at(-1)?.name ?? null).toBeNull();
      const param = matchRoutes(router, normalizePathname(`/p/${value}`));
      expect(param?.routes.at(-1)?.name).toBe('/p/:id');
      expect(param?.params).toEqual({ id: value });
    }), { numRuns: 200 });
  });
});
