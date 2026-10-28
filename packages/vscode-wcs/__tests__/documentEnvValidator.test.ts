/**
 * documentEnvValidator のテスト — 読み込み構成（script 順・base href・signals 混在）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateDocumentEnv } from '../src/service/documentEnvValidator.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

describe('validateDocumentEnv: script-order (devtools のみ)', () => {
  it('state/auto の後の devtools/auto を警告する', () => {
    const html = `
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>`;
    const diags = validateDocumentEnv(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.ScriptOrder);
    expect(diags[0].message).toContain('devtools');
  });

  it('devtools → state の正順は警告しない', () => {
    const html = `
<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>`;
    expect(validateDocumentEnv(html)).toHaveLength(0);
  });

  it('I/O ノードと state の順序は問わない（module script は遅延実行のため）', () => {
    const html = `
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>`;
    expect(validateDocumentEnv(html)).toHaveLength(0);
  });
});

describe('validateDocumentEnv: base-href-missing', () => {
  it('router/auto があるのに <base href> が無ければ警告する', () => {
    const html = `<head>
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
</head>`;
    const diags = validateDocumentEnv(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.BaseHrefMissing);
  });

  it('<base href="/"> があれば警告しない', () => {
    const html = `<head>
<base href="/">
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
</head>`;
    expect(validateDocumentEnv(html)).toHaveLength(0);
  });

  describe('<head> の同期スクリプトが <base> を作るページ（router README §1.4・examples/router-i18n — city-library の継ぎ目アプリ）', () => {
    const router = '<script type="module" src="https://esm.run/@wcstack/router/auto"></script>';
    const page = (script: string, attrs = '') => `<head>
<script${attrs}>
(function () {
  var lang = location.pathname.split("/")[1] || "en";
${script}
})();
</script>
${router}
</head><body><wcs-router><template></template></wcs-router><wcs-outlet></wcs-outlet></body>`;

    it('document.createElement("base") で <base> を作るなら警告しない', () => {
      const html = page(`  var base = document.createElement("base");
  base.setAttribute("href", "/" + lang + "/");
  document.head.appendChild(base);`);
      expect(validateDocumentEnv(html)).toHaveLength(0);
      expect(validateDocumentEnv(page(`  document.head.prepend(Object.assign(document.createElement('BASE'), { href: "/" + lang + "/" }));`))).toHaveLength(0);
    });

    it('document.write / writeln / insertAdjacentHTML に <base を渡すなら警告しない', () => {
      for (const script of [
        `  document.write("<base href='/" + lang + "/'>");`,
        `  document.writeln(\`<base href="/\${lang}/">\`);`,
        `  document.head.insertAdjacentHTML("afterbegin", '<base href="/' + lang + '/">');`,
      ]) {
        expect(validateDocumentEnv(page(script)), script).toHaveLength(0);
      }
    });

    it('リポジトリの examples/router-i18n の head スクリプトの形は警告しない', () => {
      const html = readFileSync(resolve(__dirname, '../../../examples/router-i18n/index.html'), 'utf8');
      expect(validateDocumentEnv(html).filter(d => d.code === WcsDiagnosticCode.BaseHrefMissing)).toHaveLength(0);
    });

    it('<base> を作らないスクリプト・コメントの中の言及・module script・src 付き・<body> の中のスクリプトは数えない', () => {
      for (const html of [
        page(`  document.documentElement.lang = lang;`),
        page(`  // document.createElement("base") would hand the router its basename
  document.write("<p>hello</p>"); /* "<base href>" */`),
        page(`  var base = document.createElement("base"); document.head.appendChild(base);`, ' type="module"'),
        page(`  var base = document.createElement("base"); document.head.appendChild(base);`, ' type="application/json"'),
        `<head>${router}</head><body><wcs-router></wcs-router><script>document.head.appendChild(document.createElement("base"));</script></body>`,
        `<head><script src="./locale.js"></script>${router}</head><body><wcs-router></wcs-router></body>`,
      ]) {
        expect(validateDocumentEnv(html).map(d => d.code), html).toEqual([WcsDiagnosticCode.BaseHrefMissing]);
      }
    });

    it('警告の文面が head スクリプトの形も挙げる', () => {
      const [d] = validateDocumentEnv(`<head>${router}</head>`, 'en');
      expect(d.message).toContain('or a synchronous <head> script that creates one');
    });
  });

  it('版を付けた URL・jsDelivr の dist の直接の路でも警告する（本番の書き方で黙っていた）', () => {
    for (const src of [
      'https://esm.run/@wcstack/router@4/auto',
      'https://cdn.jsdelivr.net/npm/@wcstack/router@4.0.2/dist/auto.min.js',
      'https://cdn.jsdelivr.net/npm/@wcstack/router/dist/auto.min.js',
    ]) {
      const diags = validateDocumentEnv(`<head><script type="module" src="${src}"></script></head>`);
      expect(diags.map(d => d.code), src).toEqual([WcsDiagnosticCode.BaseHrefMissing]);
    }
  });

  it('一括バンドル wcstack/auto は <wcs-router> を使うページでだけ警告する', () => {
    for (const src of ['https://esm.run/wcstack@4/auto', 'https://cdn.jsdelivr.net/npm/wcstack@4.0.2/dist/auto.min.js']) {
      const head = `<head><script type="module" src="${src}" integrity="sha384-x"></script></head>`;
      expect(validateDocumentEnv(`${head}<body><wcs-router><template></template></wcs-router></body>`).map(d => d.code), src)
        .toEqual([WcsDiagnosticCode.BaseHrefMissing]);
      expect(validateDocumentEnv(`${head}<body><wcs-state></wcs-state></body>`), src).toHaveLength(0);
    }
  });

  it('import map で解決するインラインの import "@wcstack/router/auto" も数える（signals のページの書き方、docs/seam-apps.md）', () => {
    const map = `<script type="importmap">{ "imports": { "@wcstack/router/auto": "https://esm.run/@wcstack/router/auto" } }</script>`;
    const body = `<body><wcs-router><template></template></wcs-router><wcs-outlet></wcs-outlet>
<script type="module">
  // import "@wcstack/state/auto";
  import "@wcstack/router/auto";
  import { h } from "@wcstack/signals/dom";
</script></body>`;
    const diags = validateDocumentEnv(`<head>${map}</head>${body}`);
    expect(diags.map(d => d.code)).toEqual([WcsDiagnosticCode.BaseHrefMissing]);
    // 指定子の位置を指す
    expect(`<head>${map}</head>${body}`.slice(diags[0].start, diags[0].end)).toBe('@wcstack/router/auto');
    expect(validateDocumentEnv(`<head><base href="/">${map}</head>${body}`)).toHaveLength(0);
  });

  it('インラインの import は <wcs-router> の無いページでは数えない（型だけの import がありうる）。import map のキーだけでも数えない', () => {
    const map = `<script type="importmap">{ "imports": { "@wcstack/router": "https://esm.run/@wcstack/router" } }</script>`;
    expect(validateDocumentEnv(`<head>${map}</head><body><script type="module">import { Router } from "@wcstack/router";</script></body>`)).toHaveLength(0);
    expect(validateDocumentEnv(`<head>${map}</head><body><wcs-router></wcs-router></body>`)).toHaveLength(0);
  });

  it('@wcstack/ のパッケージ名や wcstack.github.io は一括バンドルと取り違えない', () => {
    for (const src of ['https://esm.run/@wcstack/state@4/auto', 'https://wcstack.github.io/tutorial/shop.js']) {
      const html = `<head><script type="module" src="${src}"></script></head><body><wcs-router></wcs-router></body>`;
      expect(validateDocumentEnv(html), src).toHaveLength(0);
    }
  });
});

describe('validateDocumentEnv: 版を付けた URL の script-order', () => {
  it('版を付けた state / 一括バンドルの後の devtools も警告する', () => {
    for (const first of ['https://esm.run/@wcstack/state@4/auto', 'https://cdn.jsdelivr.net/npm/wcstack@4.0.2/dist/auto.min.js', 'https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.2/dist/split/auto.js']) {
      const html = `
<script type="module" src="${first}"></script>
<script type="module" src="https://esm.run/@wcstack/devtools@4/auto"></script>`;
      expect(validateDocumentEnv(html).map(d => d.code), first).toEqual([WcsDiagnosticCode.ScriptOrder]);
    }
  });
});

describe('validateDocumentEnv: signals-dual-entry', () => {
  it('本体と /dom の両方を import しているページをエラーにする', () => {
    const html = `<script type="module">
import { signal } from "@wcstack/signals";
import { h } from "@wcstack/signals/dom";
</script>`;
    const diags = validateDocumentEnv(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.SignalsDualEntry);
    expect(diags[0].severity).toBe('error');
  });

  it('script src と inline import の混在参照も検出する', () => {
    const html = `<script type="module" src="https://esm.run/@wcstack/signals"></script>
<script type="module">import { h } from "@wcstack/signals/dom";</script>`;
    const diags = validateDocumentEnv(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.SignalsDualEntry);
  });

  it('/dom のみなら error にしない（importmap のキー宣言は参照に数えない — 両方を割り当てた map は warning、下の describe）', () => {
    const html = `<script type="importmap">
{ "imports": {
  "@wcstack/signals": "https://esm.run/@wcstack/signals",
  "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom"
} }
</script>
<script type="module">import { signal } from "@wcstack/signals/dom";</script>`;
    expect(validateDocumentEnv(html).map(d => d.severity)).toEqual(['warning']);
  });

  it('本体のみ（バンドラ前提ページ）なら警告しない', () => {
    const html = `<script type="module">import { signal } from "@wcstack/signals";</script>`;
    expect(validateDocumentEnv(html)).toHaveLength(0);
  });

  it('HTML コメント・JS コメント内の言及には反応しない', () => {
    const html = `<!-- Importing \`@wcstack/signals\` AND \`@wcstack/signals/dom\` would break -->
<script type="module">
// do NOT import from "@wcstack/signals" here
import { signal, h } from "@wcstack/signals/dom";
</script>`;
    expect(validateDocumentEnv(html)).toHaveLength(0);
  });
});

describe('validateDocumentEnv: router-outlet-misplaced（docs/router-outlet-placement.md）', () => {
  const codes = (html: string) => validateDocumentEnv(html).filter(d => d.code === WcsDiagnosticCode.RouterOutletMisplaced);

  it('router が上・outlet が <main> の中の形を、outlet の位置で報告する（チュートリアルで踏んだ形）', () => {
    const html = `<body>
<wcs-router><template><wcs-route path="/"><p>home</p></wcs-route></template></wcs-router>
<header>Shop</header>
<main><wcs-outlet></wcs-outlet><aside>cart</aside></main>
</body>`;
    const diags = codes(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(html.slice(diags[0].start, diags[0].end)).toBe('wcs-outlet');
    expect(validateDocumentEnv(html, 'en').find(d => d.code === WcsDiagnosticCode.RouterOutletMisplaced)!.message).toContain('right after the <wcs-router>');
    expect(diags[0].message).toContain('<wcs-router> の直後へ移して');
  });

  it('outlet が router の直後なら報告しない（空白・テキスト・コメントを挟んでも）', () => {
    expect(codes(`<main><wcs-router><template></template></wcs-router>\n  <!-- pages -->\n  <wcs-outlet></wcs-outlet><aside></aside></main>`)).toHaveLength(0);
  });

  it('outlet を書かない（router に作らせる）ページは報告しない', () => {
    expect(codes(`<wcs-router><template></template></wcs-router><main></main>`)).toHaveLength(0);
  });

  it('マルチ Router: 片方が outlet を持たなくても、もう片方の直後の outlet は報告しない', () => {
    const html = `<wcs-router basename="/a"><template></template></wcs-router><section>
<wcs-router basename="/b"><template></template></wcs-router><wcs-outlet></wcs-outlet></section>`;
    expect(codes(html)).toHaveLength(0);
  });

  it('どの router も直後に outlet を持つなら、余った outlet があっても報告しない（ランタイムと同じ条件）', () => {
    expect(codes(`<wcs-router><template></template></wcs-router><wcs-outlet></wcs-outlet><div><wcs-outlet></wcs-outlet></div>`)).toHaveLength(0);
  });

  it('<script> / <style> の中の文字列やコメントの中のタグは数えない', () => {
    const html = `<wcs-router><template></template></wcs-router><wcs-outlet></wcs-outlet>
<script type="module">el.innerHTML = "<p></p><wcs-outlet></wcs-outlet>";</script>
<!-- <wcs-router></wcs-router><div></div><wcs-outlet></wcs-outlet> -->`;
    expect(codes(html)).toHaveLength(0);
  });
});

describe('validateDocumentEnv: signals-dual-entry（両方を割り当てた import map — docs/seam-apps.md、signals-shop）', () => {
  const of = (html: string) => validateDocumentEnv(html).filter(d => d.code === WcsDiagnosticCode.SignalsDualEntry);
  const map = (imports: Record<string, string>) => `<script type="importmap">${JSON.stringify({ imports })}</script>`;

  it('両方のエントリを CDN に割り当てた import map は、このページが /dom だけを import しても warning', () => {
    const html = `${map({ '@wcstack/signals': 'https://esm.run/@wcstack/signals', '@wcstack/signals/dom': 'https://esm.run/@wcstack/signals/dom' })}
<script type="module" src="./cart-model.js"></script>
<script type="module">import { h } from "@wcstack/signals/dom";</script>`;
    const d = of(html);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('warning');
    expect(html.slice(d[0].start, d[0].end)).toBe('@wcstack/signals');
  });

  it('/dom だけの import map、dist のファイル同士（チャンクを共有する）、両方を import するページ（error が出る）では出さない', () => {
    expect(of(map({ '@wcstack/signals/dom': 'https://esm.run/@wcstack/signals/dom' }))).toEqual([]);
    expect(of(map({ '@wcstack/signals': '/packages/signals/dist/index.esm.js', '@wcstack/signals/dom': '/packages/signals/dist/dom.esm.js' }))).toEqual([]);
    const both = `${map({ '@wcstack/signals': 'https://esm.run/@wcstack/signals', '@wcstack/signals/dom': 'https://esm.run/@wcstack/signals/dom' })}
<script type="module">import { signal } from "@wcstack/signals";
import { h } from "@wcstack/signals/dom";</script>`;
    expect(of(both).map(d => d.severity)).toEqual(['error']);
    expect(of(`<script type="importmap">{ not json</script>`)).toEqual([]);
  });
});

describe('validateDocumentEnv: route-bare-mustache（docs/seam-apps.md、router-admin）', () => {
  const of = (html: string) => validateDocumentEnv(html).filter(d => d.code === WcsDiagnosticCode.RouteBareMustache);

  it('<wcs-route> の直下のテキストの {{ }} を warning、要素の中のものは出さない', () => {
    const html = `<wcs-router><template>
  <wcs-route path="*">{{ t.notFound.heading }}<p>{{ t.notFound.body }}</p></wcs-route>
</template></wcs-router><wcs-outlet></wcs-outlet>`;
    const d = validateDocumentEnv(html, 'en').filter(x => x.code === WcsDiagnosticCode.RouteBareMustache);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('warning');
    expect(html.slice(d[0].start, d[0].end)).toBe('{{ t.notFound.heading }}');
    expect(d[0].message).toContain('landing route');
  });

  it('レイアウトのテンプレートの直下のテキストの {{ }} も、そのテンプレートを使うレイアウトがあれば出す', () => {
    const html = `<template id="main">{{ title }}<main><slot></slot></main></template>
<template id="other">{{ x }}</template>
<wcs-router><template><wcs-route path="/"><wcs-layout layout="main"><p>x</p></wcs-layout></wcs-route></template></wcs-router><wcs-outlet></wcs-outlet>`;
    const d = validateDocumentEnv(html, 'en').filter(x => x.code === WcsDiagnosticCode.RouteBareMustache);
    expect(d.map(x => html.slice(x.start, x.end))).toEqual(['{{ title }}']);
    expect(d[0].message).toContain('layout template');
  });

  it('属性・コメント・script の中の {{ }} は数えない', () => {
    const html = `<wcs-route path="/" title="{{ a }}"><!-- {{ b }} --><script>const s = "{{ c }}";</script></wcs-route>`;
    expect(of(html)).toEqual([]);
  });
});

describe('validateDocumentEnv: layout-slot-missing（docs/seam-apps.md、router-admin）', () => {
  const of = (html: string) => validateDocumentEnv(html).filter(d => d.code === WcsDiagnosticCode.LayoutSlotMissing);
  const page = (template: string, layoutBody: string, layoutAttrs = 'layout="admin"') =>
    `<template id="admin">${template}</template>
<wcs-router><template><wcs-route path="/"><wcs-layout ${layoutAttrs}>${layoutBody}</wcs-layout></wcs-route></template></wcs-router><wcs-outlet></wcs-outlet>`;

  it('既定の slot の無いテンプレートに名前付きの外の子（ルート）を渡すと、<wcs-layout> に warning', () => {
    const html = page('<header><slot name="nav"></slot></header><main></main>', '<nav slot="nav">n</nav><wcs-route path="products"><p>x</p></wcs-route>');
    const d = of(html);
    expect(d).toHaveLength(1);
    expect(html.slice(d[0].start, d[0].end)).toBe('wcs-layout');
    expect(d[0].message).toContain('"admin"');
  });

  it('既定の slot（name 無し・空）がある・名前付きの子と空白だけ・src のレイアウト・ページに無いテンプレートでは出さない', () => {
    expect(of(page('<main><slot></slot></main>', '<wcs-route path="a"></wcs-route>'))).toEqual([]);
    expect(of(page('<main><slot name=""></slot></main>', '<wcs-route path="a"></wcs-route>'))).toEqual([]);
    expect(of(page('<slot name="nav"></slot>', '<nav slot="nav">n</nav>\n  '))).toEqual([]);
    expect(of(page('<slot name="nav"></slot>', '<wcs-route path="a"></wcs-route>', 'layout="admin" src="/admin.html"'))).toEqual([]);
    expect(of(page('<slot name="nav"></slot>', '<wcs-route path="a"></wcs-route>', 'layout="missing"'))).toEqual([]);
  });

  it('名前付きの外のテキストも中身として数える', () => {
    expect(of(page('<slot name="nav"></slot>', 'Hello'))).toHaveLength(1);
  });
});
