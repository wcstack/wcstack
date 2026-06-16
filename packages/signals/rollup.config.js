import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";

const typescriptPlugin = () =>
  typescript({
    tsconfig: "./tsconfig.json",
    declaration: false,
    declarationMap: false,
    // With `output.dir`, @rollup/plugin-typescript requires the compiler's `outDir`
    // to sit inside the Rollup dir. The tsconfig's `.tsc-out` (used by the standalone
    // `tsc` type-check step) is outside it, so override here. Rollup still controls
    // the actual emitted file layout; this only satisfies the path validation.
    outDir: "dist",
  });

// The headless core (reactive / resource / streamResource / bindNode) is
// re-exported by BOTH entries (`index` and `dom`). Forcing it into a single named
// shared chunk is the crux of the production packaging: when a buildless page
// imports `@wcstack/signals` AND `@wcstack/signals/dom`, both entry files import
// the SAME `core-*.esm.js` chunk, so there is ONE reactive instance (one tracking
// context). Without this, each entry inlined its own copy of the core and mixing
// the two entries on one page silently split the dependency graph (docs §8 (f)).
const coreModules = ["reactive", "resource", "streamResource", "bindNode"];
const intoCore = (id) =>
  coreModules.some((m) => id.endsWith(`/${m}.ts`) || id.endsWith(`\\${m}.ts`))
    ? "core"
    : undefined;

const entries = { index: "src/exports.ts", dom: "src/dom.ts" };

export default [
  // ESM build — multi-input so the shared core collapses into one chunk.
  {
    input: entries,
    output: {
      dir: "dist",
      format: "esm",
      sourcemap: true,
      entryFileNames: "[name].esm.js",
      chunkFileNames: "[name]-[hash].esm.js",
      manualChunks: intoCore,
    },
    plugins: [typescriptPlugin()],
  },
  // ESM minified build — same shape, so `dom` also gets a `.min` (output symmetry).
  {
    input: entries,
    output: {
      dir: "dist",
      format: "esm",
      sourcemap: true,
      entryFileNames: "[name].esm.min.js",
      chunkFileNames: "[name]-[hash].esm.min.js",
      manualChunks: intoCore,
    },
    plugins: [typescriptPlugin(), terser()],
  },
  // Type declarations — per entry. Types have no runtime-duplication concern, so
  // each entry bundles its own .d.ts (the dts plugin does not emit JS chunks).
  {
    input: "src/exports.ts",
    output: { file: "dist/index.d.ts", format: "esm" },
    plugins: [dts()],
  },
  {
    input: "src/dom.ts",
    output: { file: "dist/dom.d.ts", format: "esm" },
    plugins: [dts()],
  },
];
