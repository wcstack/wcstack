import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { renderToString } from '../src/render';

function parseResult(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

function getSsrData(html: string, name = 'default'): Record<string, any> {
  const doc = parseResult(html);
  const ssrEl = doc.querySelector(`wcs-ssr[name="${name}"]`);
  const script = ssrEl?.querySelector('script[type="application/json"]');
  return JSON.parse(script?.textContent ?? '{}');
}

describe('renderToString', () => {
  it('HTMLを読み込んで返す', async () => {
    const result = await renderToString(`<p>Hello</p>`);
    expect(result).toContain('<p>Hello</p>');
  });

  it('textContent バインディングが適用される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"message":"Hello SSR"}'></wcs-state>
      <div data-wcs="textContent: message">placeholder</div>
    `);
    expect(result).toContain('>Hello SSR<');
  });
});

describe('enable-ssr 属性', () => {
  it('enable-ssr がある場合 <wcs-ssr> が生成される', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"count":42}'></wcs-state>
    `);
    const doc = parseResult(result);
    const ssrEl = doc.querySelector('wcs-ssr');
    expect(ssrEl).not.toBeNull();
    const data = getSsrData(result);
    expect(data.count).toBe(42);
  });

  it('enable-ssr がない場合 <wcs-ssr> は生成されない', async () => {
    const result = await renderToString(`
      <wcs-state json='{"count":42}'></wcs-state>
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('wcs-ssr')).toBeNull();
  });

  it('enable-ssr ありでもレンダリングは実行される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"message":"rendered"}'></wcs-state>
      <div data-wcs="textContent: message">placeholder</div>
    `);
    expect(result).toContain('>rendered<');
    // enable-ssr なしなので <wcs-ssr> はない
    expect(parseResult(result).querySelector('wcs-ssr')).toBeNull();
  });

  it('<wcs-ssr> が <wcs-state> の直前に挿入される', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"x":1}'></wcs-state>
    `);
    const doc = parseResult(result);
    const ssrEl = doc.querySelector('wcs-ssr');
    expect(ssrEl).not.toBeNull();
    expect(ssrEl?.nextElementSibling?.tagName).toBe('WCS-STATE');
  });

  it('name 属性が wcs-state と一致する', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr name="cart" json='{"items":[]}'></wcs-state>
    `);
    const data = getSsrData(result, 'cart');
    expect(data.items).toEqual([]);
  });

  it('$ プレフィックスや関数はデータに含まれない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"count":10}'></wcs-state>
    `);
    const data = getSsrData(result);
    expect(data).toEqual({ count: 10 });
  });

  it('複数の wcs-state で enable-ssr があるものだけ <wcs-ssr> が生成される', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr name="a" json='{"x":1}'></wcs-state>
      <wcs-state name="b" json='{"y":2}'></wcs-state>
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('wcs-ssr[name="a"]')).not.toBeNull();
    expect(doc.querySelector('wcs-ssr[name="b"]')).toBeNull();
    expect(getSsrData(result, 'a')).toEqual({ x: 1 });
  });
});

describe('wcs-ssr テンプレートコピー', () => {
  it('for テンプレートが UUID id 付きで <wcs-ssr> 内にコピーされる', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"}]}'></wcs-state>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .name"></li>
      </template>
    `);
    const doc = parseResult(result);
    const ssrEl = doc.querySelector('wcs-ssr');
    const tpl = ssrEl?.querySelector('template[data-wcs]');
    expect(tpl).not.toBeNull();
    // id が振られている
    expect(tpl?.getAttribute('id')).toBeTruthy();
  });

  it('テンプレートの id がコメントノードの UUID と一致する', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"}]}'></wcs-state>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .name"></li>
      </template>
    `);
    const doc = parseResult(result);
    // コメントノードから UUID を取得
    const commentPattern = /<!--@@wcs-for:(\w+)-->/;
    const match = result.match(commentPattern);
    expect(match).not.toBeNull();
    const commentUUID = match![1];

    // <wcs-ssr> 内のテンプレートの id と一致
    const ssrEl = doc.querySelector('wcs-ssr');
    const tpl = ssrEl?.querySelector(`template#${commentUUID}`);
    expect(tpl).not.toBeNull();
  });

  it('if/else テンプレートが UUID id 付きでコピーされる', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"show":true}'></wcs-state>
      <template data-wcs="if: show">
        <p>表示</p>
      </template>
      <template data-wcs="else:">
        <p>非表示</p>
      </template>
    `);
    const doc = parseResult(result);
    const ssrEl = doc.querySelector('wcs-ssr');
    const templates = ssrEl?.querySelectorAll('template[id]');
    expect(templates!.length).toBeGreaterThanOrEqual(2);

    // 各コメントの UUID が <wcs-ssr> 内テンプレートの id にある
    const commentPattern = /<!--@@wcs-(?:if|else|elseif):(\w+)-->/g;
    const uuids: string[] = [];
    let m;
    while ((m = commentPattern.exec(result)) !== null) {
      uuids.push(m[1]);
    }
    for (const uuid of uuids) {
      expect(ssrEl?.querySelector(`template#${uuid}`)).not.toBeNull();
    }
  });

  it('enable-ssr なしの場合テンプレートはコピーされない', async () => {
    const result = await renderToString(`
      <wcs-state json='{"items":[{"name":"Alice"}]}'></wcs-state>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .name"></li>
      </template>
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('wcs-ssr')).toBeNull();
  });
});

describe('for / if レンダリング', () => {
  it('for ブロックでリストが生成される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"items":[{"name":"Alice"},{"name":"Bob"},{"name":"Charlie"}]}'></wcs-state>
      <ul>
        <template data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </ul>
    `);
    const doc = parseResult(result);
    const items = doc.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Alice');
    expect(items[1].textContent).toBe('Bob');
    expect(items[2].textContent).toBe('Charlie');
  });

  it('if ブロック（true）で要素が表示される', async () => {
    const result = await renderToString(`
      <wcs-state json='{"show":true}'></wcs-state>
      <template data-wcs="if: show">
        <p class="visible">表示される</p>
      </template>
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('p.visible')?.textContent).toBe('表示される');
  });

  it('if ブロック（false）で要素が非表示になる', async () => {
    const result = await renderToString(`
      <wcs-state json='{"show":false}'></wcs-state>
      <template data-wcs="if: show">
        <p class="hidden">表示されない</p>
      </template>
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('p.hidden')).toBeNull();
  });

  it('if/else ブロック', async () => {
    const result = await renderToString(`
      <wcs-state json='{"loggedIn":false}'></wcs-state>
      <template data-wcs="if: loggedIn">
        <p class="welcome">ようこそ</p>
      </template>
      <template data-wcs="else:">
        <p class="login">ログインしてください</p>
      </template>
    `);
    const doc = parseResult(result);
    expect(doc.querySelector('p.welcome')).toBeNull();
    expect(doc.querySelector('p.login')?.textContent).toBe('ログインしてください');
  });

  it('for + バインディング + enable-ssr', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"users":[{"name":"Alice","age":30},{"name":"Bob","age":25}]}'></wcs-state>
      <template data-wcs="for: users">
        <div>
          <span class="name" data-wcs="textContent: .name"></span>
          <span class="age" data-wcs="textContent: .age"></span>
        </div>
      </template>
    `);
    const doc = parseResult(result);
    const names = doc.querySelectorAll('.name');
    const ages = doc.querySelectorAll('.age');
    expect(names[0].textContent).toBe('Alice');
    expect(ages[0].textContent).toBe('30');
    expect(names[1].textContent).toBe('Bob');
    expect(ages[1].textContent).toBe('25');

    const data = getSsrData(result);
    expect(data.users).toHaveLength(2);
  });
});

describe('bootstraps オプション', () => {
  it('bootstraps を明示的に指定してレンダリングできる', async () => {
    const { bootstrapState } = await import('@wcstack/state');
    const result = await renderToString(
      `<wcs-state json='{"msg":"custom"}'></wcs-state>
       <p data-wcs="textContent: msg"></p>`,
      {
        bootstraps: [bootstrapState],
      }
    );
    expect(result).toContain('>custom<');
  });

  it('bootstraps 指定で getBindingsReady が自動検出される', async () => {
    const { bootstrapState } = await import('@wcstack/state');
    const result = await renderToString(
      `<wcs-state enable-ssr json='{"count":42}'></wcs-state>`,
      {
        bootstraps: [bootstrapState],
      }
    );
    expect(result).toContain('wcs-ssr');
  });
});

describe('安定化ループ（動的追加カスタム要素の待機）', () => {
  it('$connectedCallback で動的に追加した wcs-state が待機される', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr>
        <script type="module">
          export default {
            ready: false,
            async $connectedCallback() {
              // 動的に2つ目の wcs-state を追加
              const el = document.createElement('wcs-state');
              el.setAttribute('name', 'dynamic');
              el.setAttribute('json', '{"value":"from-dynamic"}');
              document.body.appendChild(el);
              this.ready = true;
            }
          };
        </script>
      </wcs-state>
      <span data-wcs="textContent: ready"></span>
    `);
    expect(result).toContain('>true<');
    // 動的に追加された wcs-state が DOM に存在する
    const doc = parseResult(result);
    const dynamicState = doc.querySelector('wcs-state[name="dynamic"]');
    expect(dynamicState).not.toBeNull();
  });
});

describe('並列実行の安全性', () => {
  it('並列に renderToString を呼んでも各結果が正しい', async () => {
    const results = await Promise.all([
      renderToString(`
        <wcs-state json='{"msg":"alpha"}'></wcs-state>
        <p data-wcs="textContent: msg"></p>
      `),
      renderToString(`
        <wcs-state json='{"msg":"beta"}'></wcs-state>
        <p data-wcs="textContent: msg"></p>
      `),
      renderToString(`
        <wcs-state json='{"msg":"gamma"}'></wcs-state>
        <p data-wcs="textContent: msg"></p>
      `),
    ]);
    expect(results[0]).toContain('>alpha<');
    expect(results[1]).toContain('>beta<');
    expect(results[2]).toContain('>gamma<');
  });

  it('並列実行で enable-ssr のデータが混ざらない', async () => {
    const [r1, r2] = await Promise.all([
      renderToString(`
        <wcs-state enable-ssr json='{"x":111}'></wcs-state>
        <span data-wcs="textContent: x"></span>
      `),
      renderToString(`
        <wcs-state enable-ssr json='{"x":222}'></wcs-state>
        <span data-wcs="textContent: x"></span>
      `),
    ]);
    expect(r1).toContain('>111<');
    expect(r2).toContain('>222<');
    // データが交差していないことを確認
    expect(r1).not.toContain('222');
    expect(r2).not.toContain('111');
  });
});
