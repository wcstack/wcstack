import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";

const typescriptPlugin = typescript({
  tsconfig: "./tsconfig.json",
  declaration: false,
  declarationMap: false,
});

export default [
  // ESM build (main entry)
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.esm.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: [typescriptPlugin],
  },
  // No dist/index.esm.min.js on purpose — see config-templates/rollup.config.js
  // for the rule. It was reachable only through the old auto stub's relative
  // import (now gone) or a raw CDN path; it is in no `exports` entry.
  // Service Worker helper entry (separate: runs in ServiceWorkerGlobalScope, not
  // the DOM, so consumers import it from their sw.js — see `@wcstack/notification/sw`).
  {
    input: "src/sw.ts",
    output: {
      file: "dist/sw.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
    ],
  },
  // Single-tag bootstrap — bundled self-contained, never a stub that imports a
  // sibling dist file. The whole point is that one `integrity` attribute on
  // <script src=".../auto.min.js"> covers every line that runs (docs/sri.md).
  {
    input: "src/auto.ts",
    output: {
      file: "dist/auto.min.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
      terser(),
    ],
  },
  // Type declarations (main entry)
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    plugins: [dts()],
  },
  // Type declarations (sw entry)
  {
    input: "src/sw.ts",
    output: {
      file: "dist/sw.d.ts",
      format: "esm",
    },
    plugins: [dts()],
  },
];
