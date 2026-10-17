import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { renderToString } from '../src/render';

/**
 * 接続の後に要素が始めた仕事（readiness プロトコルの pendingPromise）を描画が待つ（seam app ssr-news,
 * 2026-10-18。著者の決定は docs/v4-direction-2026-10.md §5.1）。state が束縛で `url` を書いた
 * `<wcs-fetch>` の要求は、以前は待たれず、ページは値の無いまま（「Loading…」で）直列化された。
 */
describe('renderToString — 束縛が始めた要求を待つ', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const json = (data: unknown, ms = 50) => setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      }, ms);
      if (req.url === '/article') return json({ title: 'Harvest festival' });
      if (req.url === '/list') return json([{ id: 1 }, { id: 2 }]);
      if (req.url?.startsWith('/detail/')) return json({ name: `item ${req.url.slice(8)}` }, 30);
      if (req.url === '/hang') return; // never answers
      if (req.url === '/fail') return req.socket.destroy();
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const addr = server.address();
    base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const bootstraps = () => [
    async () => (await import('@wcstack/state')).bootstrapState(),
    // fetch from src: pendingPromise is this change's (the committed dist is the last release's)
    async () => (await import('../../fetch/src/exports')).bootstrapFetch(),
  ];

  it('state から url を束ねた <wcs-fetch> の結果がサーバーの HTML とスナップショットに入る', async () => {
    const html = await renderToString(`
      <wcs-state enable-ssr><script type="module">export default { article: null, url: "${base}/article" };</script></wcs-state>
      <wcs-fetch data-wcs="url: url; value: article"></wcs-fetch>
      <h1 data-wcs="textContent: article.title">Loading…</h1>`, { bootstraps: bootstraps() });
    expect(html).toContain('>Harvest festival</h1>');
    expect(html).not.toContain('Loading…');
    expect(html).toContain('"article":{"title":"Harvest festival"}');
  });

  it('結果が描いた行の中の <wcs-fetch> の要求も続けて待つ', async () => {
    const html = await renderToString(`
      <wcs-state enable-ssr><script type="module">export default {
        items: [], url: "${base}/list",
        get "items.*.detailUrl"() { return "${base}/detail/" + this["items.*.id"]; },
      };</script></wcs-state>
      <wcs-fetch data-wcs="url: url; value: items"></wcs-fetch>
      <ul><template data-wcs="for: items"><li><wcs-fetch data-wcs="url: .detailUrl; value: .detail"></wcs-fetch><span data-wcs="textContent: .detail.name"></span></li></template></ul>`, { bootstraps: bootstraps() });
    expect(html).toContain('<span>item 1</span>');
    expect(html).toContain('<span>item 2</span>');
  });

  it('失敗した要求は待ち終わりとして描く（値は無いまま、例外にしない）', async () => {
    const html = await renderToString(`
      <wcs-state enable-ssr><script type="module">export default { article: null, url: "${base}/fail" };</script></wcs-state>
      <wcs-fetch data-wcs="url: url; value: article"></wcs-fetch>
      <h1 data-wcs="textContent: article.title|defaults(none)"></h1>`, { bootstraps: bootstraps() });
    expect(html).toContain('>none</h1>');
  });

  it('時間切れまでに終わらない要求は、それ抜きで描いて警告する（描画は失敗しない）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const html = await renderToString(`
        <wcs-state enable-ssr><script type="module">export default { article: null, url: "${base}/hang" };</script></wcs-state>
        <wcs-fetch data-wcs="url: url; value: article"></wcs-fetch>
        <h1 data-wcs="textContent: article.title|defaults(Loading…)"></h1>`, { bootstraps: bootstraps(), timeoutMs: 300 });
      expect(html).toContain('>Loading…</h1>');
      const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[wcs/ssr-pending-timeout]'));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('did not finish within 300 ms: the page is rendered without its result');
    } finally {
      warn.mockRestore();
    }
  });
});
