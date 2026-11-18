// Hand-written (registered as a DEVIATION in scripts/sync-package-configs.mjs):
// this is a node CLI package — no src/auto bootstrap, one library entry plus a
// bin entry per command and the Vite plugin entry, node built-ins and the
// `typescript` / `vite` peers left external (the plugin imports only vite's types).
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import dts from "rollup-plugin-dts";

const external = (id) => id === "typescript" || id === "vite" || id.startsWith("node:");

const tsPlugin = () => [
  json(),
  typescript({
    tsconfig: "./tsconfig.json",
    declaration: false,
    declarationMap: false,
  }),
];

export default [
  // Library entry
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.esm.js",
      format: "esm",
      sourcemap: true,
    },
    external,
    plugins: tsPlugin(),
  },
  // `wcs-schema` bin
  {
    input: "src/cli/wcsSchema.ts",
    output: {
      file: "dist/wcs-schema.mjs",
      format: "esm",
      sourcemap: true,
      banner: "#!/usr/bin/env node",
    },
    external,
    plugins: tsPlugin(),
  },
  // `wcs-tsc` bin
  {
    input: "src/cli/wcsTsc.ts",
    output: {
      file: "dist/wcs-tsc.mjs",
      format: "esm",
      sourcemap: true,
      banner: "#!/usr/bin/env node",
    },
    external,
    plugins: tsPlugin(),
  },
  // `@wcstack/typescript/vite` — the Vite plugin
  {
    input: "src/vite.ts",
    output: {
      file: "dist/vite.js",
      format: "esm",
      sourcemap: true,
    },
    external,
    plugins: tsPlugin(),
  },
  // Type declarations
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    external,
    plugins: [dts()],
  },
  {
    input: "src/vite.ts",
    output: {
      file: "dist/vite.d.ts",
      format: "esm",
    },
    external,
    plugins: [dts()],
  },
];
