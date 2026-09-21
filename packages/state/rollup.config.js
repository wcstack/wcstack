import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';

const typescriptPlugin = typescript({
  tsconfig: './tsconfig.json',
  declaration: false,
  declarationMap: false,
});

export default [
  // ESM build
  {
    input: 'src/exports.ts',
    output: {
      file: 'dist/index.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [json(), typescriptPlugin],
  },
  // No dist/index.esm.min.js on purpose — see config-templates/rollup.config.js
  // for the rule. It was reachable only through the old auto stub's relative
  // import (now gone) or a raw CDN path; it is in no `exports` entry.
  // Single-tag bootstrap — bundled self-contained, never a stub that imports a
  // sibling dist file. The whole point is that one `integrity` attribute on
  // <script src=".../auto.min.js"> covers every line that runs (docs/sri.md).
  {
    input: 'src/auto.ts',
    output: {
      file: 'dist/auto.min.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
      }),
      terser(),
    ],
  },
  // Type declarations
  {
    input: 'src/exports.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Split entries (docs/state-next-major-wiring-design.md §4): `@wcstack/state/core` plus one
  // entry per feature. Multi-entry on purpose — rollup puts everything the entries share into
  // chunks, so the core is bundled ONCE and every `features/*` imports that same chunk
  // (requirement B13). Chunk names are stable (no hash): a buildless page pins the version in its
  // import map and covers each URL with its own `integrity` (docs/sri.md).
  // Source maps are not optional here: the CI gate that proves no feature entry carries core
  // modules reads them (scripts/research/measureSplitEntries.mjs).
  {
    input: {
      'core': 'src/entries/core.ts',
      'features/temporal': 'src/features/temporal.ts',
      'features/scopes': 'src/features/scopes.ts',
      'features/recursion': 'src/features/recursion.ts',
      'features/ssr': 'src/features/ssr.ts',
      'features/devtools': 'src/features/devtools.ts',
      'features/formats': 'src/features/formats.ts',
    },
    output: {
      dir: 'dist/split',
      format: 'esm',
      sourcemap: true,
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name].js',
      minifyInternalExports: true,
    },
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        // the plugin requires tsc's outDir to sit inside rollup's output dir
        outDir: 'dist/split',
      }),
      terser(),
    ],
  },
  {
    input: {
      'core': 'src/entries/core.ts',
      'features/temporal': 'src/features/temporal.ts',
      'features/scopes': 'src/features/scopes.ts',
      'features/recursion': 'src/features/recursion.ts',
      'features/ssr': 'src/features/ssr.ts',
      'features/devtools': 'src/features/devtools.ts',
      'features/formats': 'src/features/formats.ts',
    },
    output: {
      dir: 'dist/split',
      format: 'esm',
      entryFileNames: '[name].d.ts',
      chunkFileNames: 'chunks/[name].d.ts',
    },
    plugins: [dts()],
  },
  // Authoring-only entry (requirements N2): `defineState` and the types, zero runtime.
  // Minified because a buildless page imports this file itself; the types (and the prose that
  // explains them) travel in dist/define.d.ts.
  {
    input: 'src/entries/define.ts',
    output: {
      file: 'dist/define.js',
      format: 'esm',
      sourcemap: false,
    },
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      }),
      terser(),
    ],
  },
  {
    input: 'src/entries/define.ts',
    output: {
      file: 'dist/define.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Manifest entry (DOM 非依存・wcs-manifest.json 生成用 + 単一正本の consumable)
  {
    input: 'src/manifest.ts',
    output: {
      file: 'dist/manifest.esm.js',
      format: 'esm',
      sourcemap: false,
    },
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      }),
    ],
  },
  {
    input: 'src/manifest.ts',
    output: {
      file: 'dist/manifest.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Parser entry (DOM 非依存の正本パーサ。tooling が `@wcstack/state/parser` で消費)
  {
    input: 'src/parser.ts',
    output: {
      file: 'dist/parser.esm.js',
      format: 'esm',
      sourcemap: false,
    },
    plugins: [
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      }),
    ],
  },
  {
    input: 'src/parser.ts',
    output: {
      file: 'dist/parser.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
];
