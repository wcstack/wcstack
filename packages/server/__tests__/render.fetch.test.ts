import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Window } from 'happy-dom';
import { renderToString } from '../src/render';

function getSsrData(html: string, name = 'default'): Record<string, any> {
  const window = new Window();
  window.document.body.innerHTML = html;
  const ssrEl = window.document.querySelector(`wcs-ssr[name="${name}"]`);
  const script = ssrEl?.querySelector('script[type="application/json"]');
  return JSON.parse(script?.textContent ?? '{}');
}

describe('renderToString + fetch', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/users') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ]));
      } else if (req.url === '/api/greeting') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Hello from API' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('$connectedCallback 内で fetch してデータを取得する', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr>
        <script type="module">
          export default {
            users: [],
            async $connectedCallback() {
              const res = await fetch("${baseUrl}/api/users");
              this.users = await res.json();
            }
          };
        </script>
      </wcs-state>
      <template data-wcs="for: users">
        <div data-wcs="textContent: .name"></div>
      </template>
    `);

    const data = getSsrData(result);
    expect(data.users).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);

    // バインディングも適用されている
    const doc = new Window().document;
    doc.body.innerHTML = result;
    const divs = doc.querySelectorAll('div');
    expect(divs[0]?.textContent).toBe('Alice');
    expect(divs[1]?.textContent).toBe('Bob');
  });

  it('複数の fetch を並行実行する', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr>
        <script type="module">
          export default {
            users: [],
            greeting: "",
            async $connectedCallback() {
              const [usersRes, greetingRes] = await Promise.all([
                fetch("${baseUrl}/api/users"),
                fetch("${baseUrl}/api/greeting"),
              ]);
              this.users = await usersRes.json();
              const g = await greetingRes.json();
              this.greeting = g.message;
            }
          };
        </script>
      </wcs-state>
    `);

    const data = getSsrData(result);
    expect(data.users).toHaveLength(2);
    expect(data.greeting).toBe('Hello from API');
  });
});
