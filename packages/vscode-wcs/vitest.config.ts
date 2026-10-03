import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    // preamble.test.ts は 1 ケースごとに本物の `ts.createProgram`（lib.dom 込み）を
    // 起こすので実測 ~2s/ケース、v8 coverage の計装下では ~5s/ケースになり、既定の
    // 5000ms に張り付いて `npm run test:coverage` だけがタイムアウトで落ちていた。
    // 閾値ではなく待ち時間の問題なので上限だけを広げる（他のケースは数 ms で終わる）。
    testTimeout: 20000,
  },
});
