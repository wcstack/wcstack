import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";

const typescriptPlugin = typescript({
  tsconfig: "./tsconfig.json",
  declaration: false,
  declarationMap: false,
});

export default [
  // ESM build
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.esm.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: [typescriptPlugin],
  },
  // ESM minified build
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.esm.min.js",
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
  // Type declarations
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    plugins: [dts()],
  },
  // DOM entry (`@wcstack/signals/dom`): the fine-grained `h` / Fragment.
  // Kept separate so the reactive core stays DOM-free (docs §4-1).
  {
    input: "src/dom.ts",
    output: {
      file: "dist/dom.esm.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: [typescriptPlugin],
  },
  {
    input: "src/dom.ts",
    output: {
      file: "dist/dom.d.ts",
      format: "esm",
    },
    plugins: [dts()],
  },
];
