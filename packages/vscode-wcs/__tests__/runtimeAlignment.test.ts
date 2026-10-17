/**
 * runtimeAlignment.test.ts
 *
 * lint の重大度と文面を 4.0 のランタイムに合わせた分（docs/mistake-catalogue.md の「目録を作る中で
 * 見つけたもの」— 2026-10-17）。ランタイムが初期化か束縛を失敗させる誤りは error、ランタイムが
 * 文字列として通すもの・ほぼ害の無いものは warning / info に置く。
 */
import { describe, it, expect } from 'vitest';
import { validateSemantics } from '../src/service/semanticValidator.js';
import { validateBindings } from '../src/service/bindingValidator.js';
import { validateDocumentEnv } from '../src/service/documentEnvValidator.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

function script(body: string): string {
  return `<wcs-state><script type="module">export default ${body};</script></wcs-state>`;
}

const severities = (diags: { code: string; severity: string }[], code: string): string[] =>
  diags.filter((d) => d.code === code).map((d) => d.severity);

describe('ランタイムが失敗させる誤りは error', () => {
  it('getter の循環は error（ランタイムは評価で #701 を throw する）', () => {
    const html = script(`{ get a() { return this.b; }, get b() { return this.a; } }`);
    expect(severities(validateSemantics(html), WcsDiagnosticCode.GetterCycle)).toEqual(['error', 'error']);
  });

  it('添字の本数の食い違いは error（ランタイムは #901 / #902 を throw する）', () => {
    const html = script(`{ items: [{ v: 1 }], go() { return this.$resolve("items.*.v", [0, 1]); } }`);
    expect(severities(validateSemantics(html), WcsDiagnosticCode.IndexArity)).toEqual(['error']);
  });

  it('command. の未宣言トークンは error、eventToken. の未宣言トークンは warning のまま', () => {
    const state = `<wcs-state><script type="module">export default { $commandTokens: ["play"], $eventTokens: ["changed"] };</script></wcs-state>`;
    const command = validateBindings(`${state}<my-player data-wcs="command.play: $command.typo"></my-player>`, 'data-wcs');
    expect(severities(command, WcsDiagnosticCode.TokenUndeclared)).toEqual(['error']);
    const event = validateBindings(`${state}<my-input data-wcs="eventToken.value: typo"></my-input>`, 'data-wcs');
    expect(severities(event, WcsDiagnosticCode.TokenUndeclared)).toEqual(['warning']);
  });

  it('command. の右辺が $command. でなければ error（ランタイムは計画で #1201 を throw する）', () => {
    const state = `<wcs-state><script type="module">export default { $commandTokens: ["play"], count: 0 };</script></wcs-state>`;
    const diags = validateBindings(`${state}<my-player data-wcs="command.play: count"></my-player>`, 'data-wcs');
    expect(severities(diags, WcsDiagnosticCode.TokenMisconfigured)).toEqual(['error']);
  });
});

describe('ほぼ害の無いものは info', () => {
  it('state/auto の後の devtools/auto は info（4.0 は既存の束縛を送り直す）', () => {
    const html = [
      '<script type="module" src="https://esm.run/@wcstack/state/auto"></script>',
      '<script type="module" src="https://esm.run/@wcstack/devtools/auto"></script>',
    ].join('\n');
    const diags = validateDocumentEnv(html, 'en').filter((d) => d.code === WcsDiagnosticCode.ScriptOrder);
    expect(diags.map((d) => d.severity)).toEqual(['info']);
    expect(diags[0].message).toContain('timeline starts when it attaches');
  });
});

describe('4.0 に合わせた文面', () => {
  it('外れた宣言キーの読みに、効かない書き換え（正式名を読む）を勧めないこと', () => {
    const html = script(`{ go() { return this.$streams; } }`);
    const diag = validateSemantics(html, 'wcs-state', 'en').find((d) => d.code === WcsDiagnosticCode.DeclarationAliasRead);
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('A declaration cannot be read through this');
    expect(diag!.message).toContain('$streamStatus');
    expect(diag!.message).not.toContain('instead');
  });
});
