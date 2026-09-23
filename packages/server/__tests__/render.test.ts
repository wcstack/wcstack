import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import { renderToString, normalizeRenderTimeout, DEFAULT_RENDER_TIMEOUT_MS, MAX_RENDER_TIMEOUT_MS } from '../src/render';
import { getSsrSnapshotBuilder } from '../src/protocol/ssrSnapshot';

function parseResult(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

// v2: <wcs-ssr> は name 属性を持たない（1 rootNode 1 ツリー — Ssr.find(root) は先頭を読む）
function getSsrData(html: string): Record<string, any> {
  const doc = parseResult(html);
  const ssrEl = doc.querySelector('wcs-ssr');
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

  it('v2: 生成された <wcs-ssr> は name 属性を持たない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[]}'></wcs-state>
    `);
    const doc = parseResult(result);
    const ssrEl = doc.querySelector('wcs-ssr');
    expect(ssrEl).not.toBeNull();
    expect(ssrEl!.hasAttribute('name')).toBe(false);
    expect(getSsrData(result).items).toEqual([]);
  });

  it('$ プレフィックスや関数はデータに含まれない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"count":10}'></wcs-state>
    `);
    const data = getSsrData(result);
    expect(data).toEqual({ count: 10 });
  });

  it('v2: ルート＋ボリュームでも <wcs-ssr> はルートの 1 本だけで、ボリュームのデータは接ぎ木済みで含まれる（D14）', async () => {
    // v1 の「複数の wcs-state で enable-ssr があるものだけ生成」の v2 転換。
    // 1 root 1 ツリーなので 2 本目は mount= のボリューム — スナップショットは
    // ルートに集約され、ボリュームは自分の <wcs-ssr> を作らない
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"x":1}'></wcs-state>
      <wcs-state mount="v" json='{"y":2}'></wcs-state>
    `);
    const doc = parseResult(result);
    expect(doc.querySelectorAll('wcs-ssr').length).toBe(1);
    expect(getSsrData(result)).toEqual({ x: 1, v: { y: 2 } });
  });

  it('ボリュームがインライン <script type="module"> からロードしても返ること（プロセス毒性の回帰）', async () => {
    // パース途中の upgrade ではボリュームの子 <script> がまだ見えず、状態のロードが
    // 「API セット待ち」に落ちて connectedCallbackPromise が永久 pending になっていた。
    // waitForReady が返らず renderToString の finally（renderMutex の解放）に到達しないため、
    // 1 ページの不具合が以後のプロセス全体を殺していた（state の volumeLifecycle.ts で修正）。
    // ルートのインライン script は元から動いていたので、対照として同じページに置く
    const result = await renderToString(`
      <wcs-state enable-ssr><script type="module">export default { title: "R" };</script></wcs-state>
      <wcs-state mount="v"><script type="module">export default { hello: "W" };</script></wcs-state>
      <h1 data-wcs="textContent: title">x</h1>
      <p data-wcs="textContent: v.hello">x</p>
    `);
    expect(result).toContain('>R<');
    expect(result).toContain('>W<');
    expect(getSsrData(result)).toEqual({ title: 'R', v: { hello: 'W' } });
  }, 20000);
});

describe('renderToString の上限（timeoutMs）', () => {
  /** connectedCallbackPromise が決して解決しないカスタム要素を定義する bootstrap */
  const defineHangingElement = (tag: string) => () => {
    const scope = globalThis as unknown as {
      HTMLElement: typeof HTMLElement;
      customElements: CustomElementRegistry;
    };
    class Hanging extends scope.HTMLElement {
      static hasConnectedCallbackPromise = true;
      connectedCallbackPromise = new Promise<void>(() => { /* 永久 pending */ });
    }
    if (!scope.customElements.get(tag)) {
      scope.customElements.define(tag, Hanging);
    }
  };

  it('決して ready にならないページは名指しで reject し、mutex を解放して後続を通すこと', async () => {
    await expect(
      renderToString(`<hang-a></hang-a>`, { timeoutMs: 300, bootstraps: [defineHangingElement('hang-a')] }),
    ).rejects.toThrow(/renderToString timed out after 300 ms/);

    // ここが要点: 壊れた 1 ページが renderMutex を握ったままにしない
    const after = await renderToString(`
      <wcs-state json='{"m":"still alive"}'></wcs-state>
      <div data-wcs="textContent: m">x</div>
    `);
    expect(after).toContain('>still alive<');
  }, 20000);

  /**
   * **解除できる**ハング要素。`timeoutMs: 0`（無制限）を「永久に ready にならないページ」で
   * 試すには、テスト側から後で決着させられないと mutex を握ったままになり、以後の全テストが
   * 止まる。resolver はグローバル名で渡す（`GLOBALS_KEYS` に無い名前なので restore されない）。
   */
  const defineReleasableElement = (tag: string, resolverKey: string) => () => {
    const scope = globalThis as unknown as Record<string, any>;
    class Releasable extends scope.HTMLElement {
      static hasConnectedCallbackPromise = true;
      connectedCallbackPromise = new Promise<void>((resolve) => { scope[resolverKey] = resolve; });
    }
    if (!scope.customElements.get(tag)) {
      scope.customElements.define(tag, Releasable);
    }
  };

  it('timeoutMs: 0 は、永久に ready にならないページでも reject しないこと（上限の無効化）', async () => {
    // 健全なページで測っても上限の有無は観測できない（変異で `!(ms > 0)` のガードを消しても
    // 緑のままだった — サイクル 5 指摘 10）。**未 ready のページ**で見るのが唯一の観測点
    const key = '__wcstackReleaseNoLimit';
    let settled: string | null = null;
    const pending = renderToString(
      `<rel-nolimit></rel-nolimit>`,
      { timeoutMs: 0, bootstraps: [defineReleasableElement('rel-nolimit', key)] },
    ).then(() => { settled = 'resolved'; }, (e) => { settled = `rejected: ${String(e.message)}`; });

    // 既定や小さな上限なら疾うに reject している時間だけ待つ
    await new Promise((r) => setTimeout(r, 600));
    expect(settled).toBeNull();

    // 決着させて mutex を返す（ここを忘れると以後の全テストが止まる）
    (globalThis as unknown as Record<string, () => void>)[key]();
    await pending;
    expect(settled).toBe('resolved');
  }, 20000);

  it('finally の後始末（getBindingsReady の drain）も上限つきで、mutex を解放すること', async () => {
    // `waitForReady` 側の上限だけでは足りない: 時間切れで抜けた経路はそのまま `finally` の
    // drain で止まり、restore と mutex 解放に到達しない。唯一のハング要素が
    // `getBindingsReady` を持たないと drain が空になり、この不変条件が観測できない
    // （サイクル 5 指摘 10 — 変異しても緑のままだった）
    const defineDrainHang = () => {
      const scope = globalThis as unknown as Record<string, any>;
      class DrainHang extends scope.HTMLElement {
        static hasConnectedCallbackPromise = true;
        // 接続自体は即終わる。止まるのは **getBindingsReady**（waitForReady も finally の drain も引く）
        connectedCallbackPromise = Promise.resolve();
        static getBindingsReady(): Promise<void> { return new Promise<void>(() => { /* 永久 pending */ }); }
      }
      if (!scope.customElements.get('drain-hang')) {
        scope.customElements.define('drain-hang', DrainHang);
      }
    };
    await expect(
      renderToString(`<drain-hang></drain-hang>`, { timeoutMs: 300, bootstraps: [defineDrainHang] }),
    ).rejects.toThrow(/renderToString timed out after 300 ms/);

    // drain に上限が無いと、ここから先は永久に返らない
    const after = await renderToString(
      `<wcs-state json='{"m":"drain bounded"}'></wcs-state><div data-wcs="textContent: m">x</div>`,
    );
    expect(after).toContain('>drain bounded<');
  }, 20000);

  it('大きすぎる timeoutMs（Infinity / 2^31-1 超）は即時タイムアウトに反転せず、無制限に倒れること', () => {
    // Node の setTimeout は 2^31-1 超の delay を 1ms に丸めるので、「上限を上げたつもり」が
    // 逆に最短のタイムアウトになる（実測: Infinity で 13ms で reject）。正規化で無制限へ倒す
    expect(normalizeRenderTimeout(Infinity)).toBe(0);
    expect(normalizeRenderTimeout(3e9)).toBe(0);
    expect(normalizeRenderTimeout(MAX_RENDER_TIMEOUT_MS + 1)).toBe(0);
    // 無効値も無制限（JSDoc の「0 以下・NaN・2^31-1 超は無効」と一致）
    expect(normalizeRenderTimeout(NaN)).toBe(0);
    expect(normalizeRenderTimeout(-1)).toBe(0);
    expect(normalizeRenderTimeout(0)).toBe(0);
    // 有効な値はそのまま。省略は既定
    expect(normalizeRenderTimeout(MAX_RENDER_TIMEOUT_MS)).toBe(MAX_RENDER_TIMEOUT_MS);
    expect(normalizeRenderTimeout(500)).toBe(500);
    expect(normalizeRenderTimeout(undefined)).toBe(DEFAULT_RENDER_TIMEOUT_MS);
  });

  it('Infinity を渡しても健全なページが即時タイムアウトで落ちないこと（回帰）', async () => {
    const result = await renderToString(
      `<wcs-state json='{"m":"infinite"}'></wcs-state><div data-wcs="textContent: m">x</div>`,
      { timeoutMs: Infinity },
    );
    expect(result).toContain('>infinite<');
  }, 20000);

  it('mutex を try の外で漏らさないこと（不正な url で reject しても後続が通る）', async () => {
    // `new Window({ url })` と `installGlobals()` が try の外にあった頃は、オリジンを
    // 付け忘れた url の `TypeError: Invalid URL` が mutex を握ったまま抜け、**以後そのプロセスの
    // 全レンダリングが永久 pending** になっていた（実測・サイクル 5 指摘 2）
    for (const badUrl of ['/products/1', 'not a url']) {
      await expect(renderToString(`<p>x</p>`, { url: badUrl })).rejects.toThrow();
    }
    const after = await renderToString(
      `<wcs-state json='{"m":"mutex free"}'></wcs-state><div data-wcs="textContent: m">x</div>`,
    );
    expect(after).toContain('>mutex free<');
  }, 20000);
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
              // 動的に 2 つ目の state 要素を追加（v2: 追加はボリューム mount=）
              const el = document.createElement('wcs-state');
              el.setAttribute('mount', 'dynamic');
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
    const dynamicState = doc.querySelector('wcs-state[mount="dynamic"]');
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

/**
 * ssr-snapshot プロトコルの任意メンバ `reset()`（長時間プロセスの台帳）。
 *
 * 提供側（@wcstack/state）の構造テンプレート台帳はモジュール寿命で削除の口が無く、
 * 1 プロセスで描くたびに積み上がる。出力への混入は提供側が文書ごとにスナップショットを
 * 閉じることで既に防いであるので、これは純粋にメモリの口である。
 */
describe('ssr-snapshot プロトコルの reset()', () => {
  it('レンダリングごとに 1 回、後始末の最後に呼ばれること', async () => {
    const builder = getSsrSnapshotBuilder();
    expect(builder).not.toBeNull();
    expect(typeof builder!.reset).toBe('function');

    const original = builder!.reset!;
    let calls = 0;
    (builder as { reset?: () => void }).reset = () => { calls++; original.call(builder); };
    try {
      await renderToString(`<wcs-state enable-ssr json='{"x":1}'></wcs-state>`);
      expect(calls).toBe(1);
      await renderToString(`<wcs-state enable-ssr json='{"x":2}'></wcs-state>`);
      expect(calls).toBe(2);
    } finally {
      (builder as { reset?: () => void }).reset = original;
    }
  });

  it('レンダリングが失敗した経路でも呼ばれること（後始末の 1 本として独立に守られている）', async () => {
    const builder = getSsrSnapshotBuilder();
    const original = builder!.reset!;
    let calls = 0;
    (builder as { reset?: () => void }).reset = () => { calls++; original.call(builder); };
    try {
      const hang = () => {
        const scope = globalThis as unknown as {
          HTMLElement: typeof HTMLElement;
          customElements: CustomElementRegistry;
        };
        class Hanging extends scope.HTMLElement {
          static hasConnectedCallbackPromise = true;
          connectedCallbackPromise = new Promise<void>(() => { /* 永久 pending */ });
        }
        if (!scope.customElements.get('hang-reset')) {
          scope.customElements.define('hang-reset', Hanging);
        }
      };
      await expect(
        renderToString(`<hang-reset></hang-reset>`, { timeoutMs: 200, bootstraps: [hang] }),
      ).rejects.toThrow(/timed out/);
      expect(calls).toBe(1);
    } finally {
      (builder as { reset?: () => void }).reset = original;
    }
  });

  it('reset を持たない提供側でも落ちないこと（任意メンバなので素通し）', async () => {
    const builder = getSsrSnapshotBuilder();
    const original = builder!.reset;
    delete (builder as { reset?: () => void }).reset;
    try {
      await expect(renderToString(`<p>ok</p>`)).resolves.toContain('<p>ok</p>');
    } finally {
      (builder as { reset?: () => void }).reset = original;
    }
  });
});
