import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { renderToString } from '../src/render';

/**
 * 描画の後に終わる非同期の仕事（seam app ssr-news, 2026-10-18）。state から url を束ねた `<wcs-fetch>` の要求は
 * 描画に待たれずに走り、描画の後で失敗すると、その続きが Node のグローバルの CustomEvent を happy-dom の要素に
 * dispatch して投げ、捕まらない reject で **プロセスを落とした**。後始末は、グローバルを戻す前に実行中の仕事を
 * 止める。
 */
describe('renderToString — 描画の後に終わる非同期の仕事', () => {
  let server: Server;
  let baseUrl: string;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/slow-fail') {
        // the request fails on the network after the render returned
        setTimeout(() => req.socket.destroy(), 100);
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'item' }));
      }, 100);
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const addr = server.address();
    baseUrl = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    process.off('uncaughtException', onUnhandled);
  });

  const page = (path: string) => `
    <wcs-state enable-ssr><script type="module">export default { item: null, path: "${baseUrl}${path}" };</script></wcs-state>
    <wcs-fetch data-wcs="url: path; value: item"></wcs-fetch>
    <p data-wcs="textContent: item.name">-</p>`;
  const options = () => ({
    bootstraps: [
      async () => (await import('@wcstack/state')).bootstrapState(),
      // the committed dist of @wcstack/fetch (not a dependency of the server)
      async () => (await import('../../fetch/dist/index.esm.js' as string)).bootstrapFetch(),
    ],
  });

  it('state から url を束ねた <wcs-fetch> の要求が描画の後にネットワークで失敗しても、プロセスを落とさないこと', async () => {
    await renderToString(page('/slow-fail'), options());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(unhandled).toEqual([]);
  });

  it('その要求が描画の後に成功しても、何も投げないこと', async () => {
    await renderToString(page('/slow-ok'), options());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(unhandled).toEqual([]);
  });

  it('描画の中で始まったタイマー（setInterval）は、描画の後に動き続けないこと', async () => {
    const ticks: number[] = [];
    await renderToString(`<late-ticker></late-ticker>`, {
      bootstraps: [
        () => {
          // an element that ticks on a timer and announces each tick, and stops when it leaves the
          // document — as <wcs-timer> and the other I/O nodes do
          customElements.define('late-ticker', class extends HTMLElement {
            private timer: ReturnType<typeof setInterval> | undefined;
            connectedCallback() {
              this.timer = setInterval(() => {
                ticks.push(Date.now());
                this.dispatchEvent(new CustomEvent('tick'));
              }, 20);
            }
            disconnectedCallback() {
              clearInterval(this.timer);
            }
          });
        },
      ],
    });
    const after = ticks.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(unhandled).toEqual([]);
    expect(ticks.length - after).toBe(0);
  });
});
