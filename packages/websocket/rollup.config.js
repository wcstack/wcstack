import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const typescriptPlugin = typescript({
  tsconfig: "./tsconfig.json",
  declaration: false,
  declarationMap: false,
});

const copyAutoPlugin = () => ({
  name: "copy-auto",
  async writeBundle() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const srcDir = path.join(__dirname, "src", "auto");
    const distDir = path.join(__dirname, "dist");

    await fs.mkdir(distDir, { recursive: true });
    await Promise.all([
      fs.copyFile(path.join(srcDir, "auto.js"), path.join(distDir, "auto.js")),
      fs.copyFile(path.join(srcDir, "auto.min.js"), path.join(distDir, "auto.min.js")),
    ]);
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
    plugins: [typescriptPlugin, copyAutoPlugin()],
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
];
