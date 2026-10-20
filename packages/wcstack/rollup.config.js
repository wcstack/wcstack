// Hand-written, NOT generated from /config-templates/ (this package is outside the
// @wcstack/ scope that scripts/sync-package-configs.mjs discovers, and deliberately
// so — docs/distribution-robustness-impl-plan.md D9): the entry package has no
// src/exports.ts, builds no dist/index.esm.js and no .d.ts. Its single artifact is
// the bundle below. Keeping dist/index.esm.js absent is load-bearing: it is what
// keeps scripts/conformance-bindable-inputs.mjs from re-checking the re-bundled
// member classes (plan D5).
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

// dist/auto.d.ts, as in config-templates/rollup.config.js: `./auto` exports nothing. It is
// the one .d.ts this package ships, so `import("wcstack/auto")` type-checks.
const autoDeclaration = () => ({
  name: "wcstack-auto-declaration",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "auto.d.ts",
      source: "// Importing this module defines the package's custom elements. It exports nothing.\nexport {};\n",
    });
  },
});

export default [
  // Single-tag bootstrap for the whole SPA-core profile. node-resolve inlines each
  // member's dist/auto.min.js (resolved through its package.json "./auto" export);
  // rollup renames colliding top-level identifiers, which is exactly what a naive
  // concatenation (jsDelivr /combine/) cannot do — see docs/sri.md §3.1. The result
  // is self-contained with zero static imports, so one integrity attribute covers
  // every line that runs (docs/sri.md §6); the smoke test machine-checks that.
  {
    input: "src/auto.ts",
    output: {
      file: "dist/auto.min.js",
      format: "esm",
      // The inputs are already-minified member bundles, so this map points into
      // minified intermediate code. Kept for parity with the other packages.
      sourcemap: true,
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
      nodeResolve(),
      terser(),
      autoDeclaration(),
    ],
  },
];
