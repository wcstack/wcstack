/**
 * liveRegionValidator.test.ts — `wcs/live-region-inserted`: a live region inserted together with its text.
 *
 * From the city-library seam app: a route's `role="status"`, a status in an `if:` branch — the region enters the page
 * with its text, and a screen reader announces a region whose text changes while it is in the page. Nothing in the
 * console, the lint or axe said so. `role="alert"` is left out: an alert added to the page is announced (the user agent
 * fires the alert event).
 */
import { describe, it, expect } from 'vitest';
import { validateLiveRegions } from '../src/service/liveRegionValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';

const STATE = `<wcs-state><script type="module">
export default {
  notice: "", error: null, loginErrorMessage: "", count: 0, items: [], offline: false,
  get hasError() { return this.error !== null; },
  get countText() { return String(this.count); },
};
</script></wcs-state>
`;
const found = (body: string, locale = 'en'): { text: string; message: string }[] => {
  const html = STATE + body;
  return validateLiveRegions(html, 'data-wcs', 'wcs-state', locale).map((d: WcsDiagnostic) => ({ text: html.slice(d.start, d.end), message: d.message }));
};
const texts = (body: string): string[] => found(body).map((f) => f.text);

describe('wcs/live-region-inserted — 文と一緒に挿入されるライブリージョン', () => {
  it('if: の枝の中で、文が条件の読むものに束ねてあるリージョンを報告すること', () => {
    const [f] = found(`<template data-wcs="if: notice">
  <p class="notice" role="status" data-wcs="textContent: notice"></p>
</template>`);
    expect(f.text).toBe('role="status"');
    expect(f.message).toContain('its text is bound to what the condition "notice" reads');
    expect(f.message).toContain('an inserted role="alert" is the one form announced on insertion');
    expect(f.message).toContain('a status message meant to be heard belongs in a region that is always in the page');
    expect(f.message).toContain('keep the region outside the template');
  });

  it('role="alert" は報告しないこと — 挿入した alert は読み上げられる（user agent が alert のイベントを出す）。aria-live を併せても同じ', () => {
    expect(texts(`<template data-wcs="if: loginErrorMessage">
  <p class="error" role="alert" data-wcs="textContent: loginErrorMessage"></p>
</template>
<template data-wcs="if: offline"><div role="alert">You are offline.</div></template>
<template data-wcs="if: offline"><div role="alert" aria-live="assertive">You are offline.</div></template>
<template data-wcs="for: items"><li><span role="alert">Failed</span></li></template>
<wcs-router><template><wcs-route path="/"><p role="alert">Session expired</p></wcs-route></template></wcs-router>
<wcs-outlet></wcs-outlet>`)).toEqual([]);
  });

  it('条件の上下のパス・条件や文の getter が読むパス・フィルタ・mustache・コメント束縛・子孫の束縛も、条件に結び付いた文と読むこと', () => {
    expect(texts(`<template data-wcs="if: error"><div role="status"><span data-wcs="textContent: error.message"></span></div></template>
<template data-wcs="if: hasError"><p role="status">{{ error.message }}</p></template>
<template data-wcs="if: notice|truthy"><p aria-live="polite" data-wcs="textContent: notice|trim"></p></template>
<template data-wcs="if: count"><p role="log"><!--@@:countText--></p></template>`)).toEqual([
      'role="status"', 'role="status"', 'aria-live="polite"', 'role="log"',
    ]);
  });

  it('リージョンが文を書いて持っていれば、枝・行・ルートのどれでも報告すること', () => {
    const page = `<template data-wcs="if: offline"><div role="status">You are offline.</div></template>
<template data-wcs="for: items"><li><span aria-live="assertive">Saved <b data-wcs="textContent: .name"></b></span></li></template>
<template data-wcs="if: offline"></template><template data-wcs="else:"><p role="log"><span>Back online</span></p></template>
<wcs-router><template>
  <wcs-route path="/"><section><p role="status">Welcome back</p></section></wcs-route>
</template></wcs-router>
<wcs-outlet></wcs-outlet>`;
    const all = found(page);
    expect(all.map((f) => f.text)).toEqual(['role="status"', 'aria-live="assertive"', 'role="log"', 'role="status"']);
    expect(all.map((f) => f.message.match(/when (its [^(]+)\(/)?.[1].trim())).toEqual([
      'its branch appears', 'its for: row is added', 'its branch appears', 'its <wcs-route> is entered',
    ]);
    expect(all[3].message).toContain('keep the region outside the route');
    expect(all[0].message).toContain('so this text is not announced');
  });

  it('日本語の文面', () => {
    const [f] = found(`<template data-wcs="if: notice"><p role="status" data-wcs="textContent: notice"></p></template>`, 'ja');
    expect(f.message).toContain('このライブリージョン（role="status"）は、枝が現れたときに文ごと挿入されます');
    expect(f.message).toContain('この文は読み上げられません（挿入したときに読み上げられるのは role="alert" だけです）');
    expect(f.message).toContain('聞かせたい知らせは、常にページにあるリージョンに置いてください');
  });

  it('正しい形には黙ること — 常にページにあるリージョン、条件と別の文（後から変わる）、置き換えられる文、aria-live="off"', () => {
    expect(texts(`<p role="status" data-wcs="textContent: notice"></p>
<div role="log" aria-live="polite"><template data-wcs="for: items"><p data-wcs="textContent: .text"></p></template></div>
<template data-wcs="if: count"><form><p class="error" role="status" data-wcs="textContent: loginErrorMessage"></p></form></template>
<template data-wcs="for: items"><li><span role="status" data-wcs="textContent: .error"></span></li></template>
<template data-wcs="if: offline"><p role="status" data-wcs="textContent: notice">placeholder</p></template>
<template data-wcs="if: offline"><p role="status"><span data-wcs="textContent: notice">placeholder</span></p></template>
<template data-wcs="if: offline"><p aria-live="off">Offline</p></template>
<template data-wcs="if: offline"><p role="button">Retry</p><p data-wcs="attr.role: notice">x</p></template>
<template data-wcs="if: offline"><p role="status"> <!-- a comment --> {{ notice }} </p></template>
<wcs-router><template><wcs-route path="/login"><p role="status" data-wcs="textContent: loginErrorMessage"></p></wcs-route></template></wcs-router>
<wcs-outlet></wcs-outlet>`)).toEqual([]);
  });

  it('ページが作らない所（アプリのコードが複製するだけの template・script の文字列・コメント・行の中の入れ子の template）は数えないこと', () => {
    expect(texts(`<template id="toast"><template data-wcs="if: offline"><p role="status">Offline</p></template></template>
<script>const html = '<template data-wcs="if: offline"><p role="status">Offline</p></template>';</script>
<!-- <template data-wcs="if: offline"><p role="status">Offline</p></template> -->
<template data-wcs="for: items"><template><p role="status">Offline</p></template></template>`)).toEqual([]);
  });

  it('validateDocument が報告し、data-wcs-ignore の中は報告しないこと', () => {
    const body = `<template data-wcs="if: offline"><p role="status">Offline</p></template>
<div data-wcs-ignore><template data-wcs="if: offline"><p role="status">Offline</p></template></div>`;
    const diags = validateDocument(STATE + body, { locale: 'en' }).filter((d) => d.code === WcsDiagnosticCode.LiveRegionInserted);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
  });
});
