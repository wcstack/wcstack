import { describe, it, expect } from 'vitest';
import { validateStateSources } from '../src/service/stateSourceValidator.js';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode } from '../src/core/diagnostics.js';

const files: Record<string, string> = {
  'app/state.js': 'export default { roomName: "A" };',
  'typed.ts': 'export default { roomName: "A" };',
  'data.json': '{ "roomName": "A" }',
};
const reader = (path: string): string | undefined => files[path];

const page = (attrs: string, body = ''): string => `<wcs-state ${attrs}></wcs-state>${body}`;

describe('読めない <wcs-state src>（wcs/state-src-unread — lint の限界の告知）', () => {
  it('/ から始まる src は読めないと src の上で info で言うこと', () => {
    const html = page('src="/booking/app/state.js"');
    const diags = validateStateSources(html, 'wcs-state', 'en', reader);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(WcsDiagnosticCode.StateSrcUnread);
    expect(diags[0].severity).toBe('info');
    expect(html.slice(diags[0].start, diags[0].end)).toBe('src="/booking/app/state.js"');
    expect(diags[0].message).toContain('"/booking/app/state.js" cannot be read');
  });

  it('無いファイル・URL・JSON の無いファイルも言うこと', () => {
    for (const src of ['app/nope.js', 'https://cdn.example/state.js', 'missing.json', 'state.mjs']) {
      expect(validateStateSources(page(`src="${src}"`), 'wcs-state', 'ja', reader).map((d) => d.code), src).toEqual([WcsDiagnosticCode.StateSrcUnread]);
    }
  });

  it('読める src（.js・並びの .ts・.json）は何も言わないこと', () => {
    for (const src of ['app/state.js', 'typed.js', 'data.json']) {
      expect(validateStateSources(page(`src="${src}"`), 'wcs-state', 'en', reader), src).toEqual([]);
    }
  });

  it('bind-component・state= の要素と、読む口の無い検査は対象にしないこと', () => {
    expect(validateStateSources(page('bind-component="state" src="/x.js"'), 'wcs-state', 'en', reader)).toEqual([]);
    expect(validateStateSources(page('state="main" src="/x.js"'), 'wcs-state', 'en', reader)).toEqual([]);
    expect(validateStateSources(page('src="/x.js"'), 'wcs-state', 'en')).toEqual([]);
  });

  it('validateDocument では 1 回だけ出し、読めない state の束縛はこれまでどおり検査しないこと', () => {
    const html = page('src="/booking/app/state.js"', '<p data-wcs="textContent: roomNmae"></p>');
    const diags = validateDocument(html, { fileReader: reader, locale: 'en' });
    expect(diags.map((d) => d.code)).toEqual([WcsDiagnosticCode.StateSrcUnread]);
    // the same page with a src the reader reads reports the typo instead
    const readable = validateDocument(page('src="app/state.js"', '<p data-wcs="textContent: roomNmae"></p>'), { fileReader: reader, locale: 'en' });
    expect(readable.map((d) => d.code)).toEqual([WcsDiagnosticCode.BindingPathMissing]);
  });
});
