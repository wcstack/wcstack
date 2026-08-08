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
];
