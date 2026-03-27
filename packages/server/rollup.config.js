import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';

const external = ['happy-dom', '@wcstack/state'];

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
    external,
    plugins: [json(), typescriptPlugin],
  },
  // ESM minified build
  {
    input: 'src/exports.ts',
    output: {
      file: 'dist/index.esm.min.js',
      format: 'esm',
      sourcemap: true,
    },
    external,
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
    external,
    plugins: [dts()],
  },
];
