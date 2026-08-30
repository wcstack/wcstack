// Hand-written (registered as a DEVIATION in scripts/sync-package-configs.mjs):
// a test-helper library for node/vitest — no src/auto bootstrap, and the peers
// (@wcstack/state, @wcstack/server, happy-dom) plus node built-ins stay external.
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";

const external = (id) => id.startsWith("@wcstack/") || id === "happy-dom" || id.startsWith("node:");

export default [
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.esm.js",
      format: "esm",
      sourcemap: true,
    },
    external,
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
    ],
  },
  {
    input: "src/exports.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    external,
    plugins: [dts()],
  },
];
