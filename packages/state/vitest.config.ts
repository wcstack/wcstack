import { defineConfig } from 'vitest/config';

/**
 * `src/dependency/keyedDependency.ts` の内部台帳を、テストからだけ覗けるようにする。
 *
 * 公開されている面からは観測できない不変条件が 3 つある — 購読を失った行が生きている祖先の集合に
 * 残らないこと（`unlinkAncestors`）、載せた祖先が今も `parentListIndex` チェーン上に居ること
 * （行が生きたまま付け替えられない）、そして保留バッファ（`pendingKeyedWalk`）に取り残しが
 * 出ないこと。どれも「出荷コードにテスト用の口を開ける」以外に確かめる手が無いように見えるが、
 * **ここで計装すれば core は 1 バイトも変わらない**。bundle にも `d.ts` にも出ない。
 *
 * 番人は `__tests__/dependency.keyedAncestorIndex.test.ts`。計装が当たらなくなったら
 * （リファクタで下の目印が消えたら）ここで throw して落とす — 黙って番人だけが無効になるのが
 * 最悪なので、false green を構造的に禁じる。
 */
const LINK_MARKER = '    rows.add(listIndex);';
const keyedDependencyProbe = {
  name: 'wcs-keyed-dependency-probe',
  transform(code: string, id: string) {
    if (!id.replace(/\\/g, '/').endsWith('src/dependency/keyedDependency.ts')) {
      return null;
    }
    const hits = code.split(LINK_MARKER).length - 1;
    if (hits !== 1) {
      throw new Error(
        `[wcs-keyed-dependency-probe] expected exactly one "${LINK_MARKER.trim()}" in keyedDependency.ts, found ${hits}. `
        + 'The ancestor-index guard (__tests__/dependency.keyedAncestorIndex.test.ts) can no longer be instrumented; '
        + 'update the marker instead of dropping the guard.',
      );
    }
    return {
      code: code.replace(LINK_MARKER, `${LINK_MARKER} __probeLinks.push([ancestor, listIndex]);`)
        + '\nconst __probeLinks = [];'
        + '\nexport const __keyedProbe = { links: __probeLinks, descendantRowsByAncestor, entriesByListIndex, pendingKeyedWalk };\n',
      map: null,
    };
  },
};

export default defineConfig({
  plugins: [keyedDependencyProbe],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['__tests__/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '__tests__/',
        'dist/',
        '*.config.{js,ts,mjs}',
        'src/exports.ts',
        'src/types.ts',
        'package.json',
        // Generated copy of the shared transition-runner protocol
        // (/protocol/transition-runner.ts). state exercises the lookup and the
        // no-arbiter fallback (integration.viewTransition.test.ts); the manifest
        // validity branches are covered once, in @wcstack/view-transition.
        'src/protocol/transitionRunner.ts',
      ],
      thresholds: {
        statements: 99.5,
        branches: 98.5,
        functions: 100,
        lines: 99.5,
      },
    },
  },
});
