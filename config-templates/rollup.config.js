import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";

const typescriptPlugin = typescript({
  tsconfig: "./tsconfig.json",
  declaration: false,
  declarationMap: false,
});

// `./auto` defines the package's tags and exports nothing; this gives it a type, so a
// TypeScript app can `import("@wcstack/<pkg>/auto")` to load the tags late (docs/seam-apps.md,
// fw-inventory: tsc failed on the import the integration guide recommends).
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
  // No dist/index.esm.min.js here on purpose.
  //
  // It was only ever reachable two ways: the auto stub's relative import, which
  // no longer exists now that the bootstrap is bundled from source, and a raw
  // CDN file path — it appears in no package's `exports`, so npm consumers
  // could never import it. Keeping it would ship the same runtime minified
  // twice (plus a second ~840 KB sourcemap for state) to serve neither.
  //
  // The rule: a minified named-export bundle exists only where there is no
  // self-contained auto bundle to cover the CDN case. That is why @wcstack/
  // signals still builds one (no src/auto.ts by design decision G2) while
  // every package here does not.
  //
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
      autoDeclaration(),
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
];
