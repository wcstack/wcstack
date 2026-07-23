/**
 * 診断メッセージの ja / en 切り替えテスト。
 * 安定契約は {code, range, severity} — locale を変えても code / range は不変であること。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { resolveLocale } from '../src/core/messages.js';
import { parseArgs } from '../src/cli.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

const BROKEN = `<wcs-state><script type="module">
export default {
  reload: true,
  items: [],
};
</script></wcs-state>
<wcs-fetch data-wcs="valu: items; trigger: reload"></wcs-fetch>
<div data-wcs="textContent: missing|nofilter"></div>`;

describe('resolveLocale', () => {
  it('未指定・ja 系は ja、それ以外は en', () => {
    expect(resolveLocale(undefined)).toBe('ja');
    expect(resolveLocale('')).toBe('ja');
    expect(resolveLocale('ja')).toBe('ja');
    expect(resolveLocale('ja-JP')).toBe('ja');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
  });
});

describe('validateDocument: locale 切り替え', () => {
  it('既定（locale 未指定）は日本語メッセージ', () => {
    const diags = validateDocument(BROKEN);
    const member = diags.find(d => d.code === WcsDiagnosticCode.TagMemberUnknown);
    expect(member?.message).toContain('メンバーではありません');
  });

  it("locale: 'en' で英語メッセージになる", () => {
    const diags = validateDocument(BROKEN, { locale: 'en' });
    const member = diags.find(d => d.code === WcsDiagnosticCode.TagMemberUnknown);
    expect(member?.message).toContain('is not a wcBindable member');
    expect(member?.message).toContain('Did you mean "value"?');
    const trigger = diags.find(d => d.code === WcsDiagnosticCode.TriggerSeededTruthy);
    expect(trigger?.message).toContain('Seed it with false');
    const filter = diags.find(d => d.code === WcsDiagnosticCode.FilterUnknown);
    expect(filter?.message).toContain('is not a built-in filter');
    const path = diags.find(d => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(path?.message).toContain('does not exist in the state definition');
  });

  it('locale を変えても code / range / severity / 件数は不変', () => {
    const ja = validateDocument(BROKEN);
    const en = validateDocument(BROKEN, { locale: 'en' });
    expect(en.length).toBe(ja.length);
    for (let i = 0; i < ja.length; i++) {
      expect(en[i].code).toBe(ja[i].code);
      expect(en[i].start).toBe(ja[i].start);
      expect(en[i].end).toBe(ja[i].end);
      expect(en[i].severity).toBe(ja[i].severity);
    }
  });
});

describe('CLI: --lang フラグ', () => {
  it('parseArgs が --lang=en を locale に写す', () => {
    const { options, files } = parseArgs(['--lang=en', 'app.html']);
    expect(options.locale).toBe('en');
    expect(files).toEqual(['app.html']);
  });

  it('runValidation に locale が伝搬して整形行が英語になる', () => {
    const result = runValidation(
      [{ source: 'app.html', text: BROKEN, kind: 'html' }],
      { locale: 'en' },
    );
    const memberLine = result.lines.find(l => l.includes('wcs/tag-member-unknown'));
    expect(memberLine).toContain('is not a wcBindable member');
  });
});
