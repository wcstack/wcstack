/**
 * documentEnvValidator のテスト — 読み込み構成（script 順・base href・signals 混在）。
 */
import { describe, it, expect } from 'vitest';
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

  it('/dom のみなら警告しない（importmap のキー宣言は参照に数えない）', () => {
    const html = `<script type="importmap">
{ "imports": {
  "@wcstack/signals": "https://esm.run/@wcstack/signals",
  "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom"
} }
</script>
<script type="module">import { signal } from "@wcstack/signals/dom";</script>`;
    expect(validateDocumentEnv(html)).toHaveLength(0);
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
