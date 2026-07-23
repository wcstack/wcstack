// build.mjs — @wcstack/lint のビルド。
//
// このパッケージは薄い配布ラッパーであり、自前のソースを持たない
// (docs/wcs-validate-npm-cli-proposal.md 案A)。validator core の正本は
// packages/vscode-wcs にあり、ここでは
//   1. vscode-wcs の依存が無ければ npm ci
//   2. vscode-wcs をビルド(esbuild が自己完結の dist/cli.cjs を生成)
//   3. dist/cli.cjs をこのパッケージの dist/ へコピー
// を行うだけ。cli.cjs は typescript / vscode を require しない単一ファイル
// CJS バンドルなので、コピー先は runtime dependencies ゼロで成立する。

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeWcs = join(pkgRoot, "..", "vscode-wcs");

const run = (command, cwd) => {
  console.log(`[lint build] ${command} (in ${cwd})`);
  execSync(command, { cwd, stdio: "inherit" });
};

if (!existsSync(join(vscodeWcs, "node_modules"))) {
  run("npm ci", vscodeWcs);
}
run("npm run build", vscodeWcs);

const source = join(vscodeWcs, "dist", "cli.cjs");
if (!existsSync(source)) {
  console.error(`[lint build] expected build output not found: ${source}`);
  process.exit(1);
}

const dist = join(pkgRoot, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyFileSync(source, join(dist, "cli.cjs"));
console.log("[lint build] dist/cli.cjs ready");
