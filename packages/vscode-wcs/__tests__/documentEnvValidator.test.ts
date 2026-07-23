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
