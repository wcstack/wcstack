/**
 * contentMapperMain.ts — `@wcstack/typescript` が TypeScript 7.1 に渡す content mapper の入口。
 *
 * パッケージの `package.json` の `"typescript": { "contentMapper": { "exec": ["node", "./dist/content-mapper.cjs"] } }`
 * で TypeScript がこのファイルを子プロセスとして起こし、標準入出力で話す（contentMapper/server.ts）。
 * esbuild が単一 CJS（`dist/content-mapper.cjs`、Node の組み込みだけ — TypeScript も Volar も要らない）に
 * bundle し、`packages/typescript/scripts/build-schema-core.mjs` がコピーする。設計は
 * docs/typescript-content-mapper.md。
 */

import { format } from 'node:util';
import { startStdioMapper } from './contentMapper/server.js';

// stdout は protocol だけのもの。紛れ込んだ console の出力は stderr へ回す。
const toStderr = (...args: unknown[]): void => {
  process.stderr.write(format(...args) + '\n');
};
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

startStdioMapper(process);
