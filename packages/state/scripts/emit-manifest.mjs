/**
 * emit-manifest.mjs — ビルド時に `dist/wcs-manifest.json` を生成する。
 *
 * rollup が出力した DOM フリーの `dist/manifest.esm.js` から getWcsManifest() を呼び、
 * 機械可読な単一正本（構文・フィルタ・filterMeta・予約名）を JSON として書き出す。
 * vscode-wcs（wcstack-intellisense）はこの JSON を消費して手リストを撤去できる。
 *
 * 実行: build の最後（tsc && rollup -c && node scripts/emit-manifest.mjs）。
 */
import { writeFile } from "node:fs/promises";

const distUrl = new URL("../dist/", import.meta.url);
const { getWcsManifest } = await import(new URL("manifest.esm.js", distUrl).href);

const json = JSON.stringify(getWcsManifest(), null, 2) + "\n";
await writeFile(new URL("wcs-manifest.json", distUrl), json);

// eslint-disable-next-line no-console
console.log("[emit-manifest] wrote dist/wcs-manifest.json");
