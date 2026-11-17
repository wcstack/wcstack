/**
 * ioAttributeValidator.test.ts — 組み込みタグのリテラルの属性値で、プラットフォームが拒むもの（継ぎ目アプリ
 * town-archive、4.24）。
 *
 *   - `wcs/root-margin-unit`（warning）— `<wcs-intersect>` / `<wcs-infinite-scroll>` の、px も % も無い `root-margin`。
 *     受ける形は Chromium と Firefox で確かめた: 1〜4 個、それぞれ px か % の付いた数値で、0 にも単位が要る
 *
 * 書いたとおりの意味にならないもの（継ぎ目アプリ stamp-rally、4.25）:
 *
 *   - `wcs/frequency-invalid`（warning）— センサーのタグの、正の有限の数値でない `frequency`（`"60hz"`・`"0"`）。要素の
 *     getter はそれを「指定なし」として読み、センサーはブラウザの既定の頻度で動く
 *   - `wcs/target-selector`（warning）— `target` を CSS セレクタとして読むタグの、裸の語の `target`（`"viewer"`）。文書に
 *     その id の要素があり、そのタグ名の要素が無いとき
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { checkFrequency, checkRootMargin } from '../src/service/ioAttributeValidator.js';

const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (p: string) => files[p] });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);

describe('wcs/root-margin-unit — 単位の無い root-margin', () => {
  const rootMargins = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.RootMarginUnit);

  it('px も % も無い数値のある root-margin を warning で報告し、px を足した書き方を言うこと（0 にも単位が要る）', () => {
    const html = `<wcs-intersect root-margin="200"></wcs-intersect>
<wcs-infinite-scroll target="list" root-margin="0 0 900 0"></wcs-infinite-scroll>
<wcs-intersect root-margin="0 0 900px 0"></wcs-intersect>
<wcs-intersect root-margin='-50 10%'></wcs-intersect>
<wcs-intersect root-margin=300></wcs-intersect>`;
    const found = rootMargins(html);
    expect(found.map((d) => [d.severity, d.tag, textOf(html, d)])).toEqual([
      ['warning', 'wcs-intersect', '200'], ['warning', 'wcs-infinite-scroll', '0 0 900 0'],
      ['warning', 'wcs-intersect', '0 0 900px 0'], ['warning', 'wcs-intersect', '-50 10%'], ['warning', 'wcs-intersect', '300'],
    ]);
    expect(found[0].message).toBe('The browser refuses root-margin="200" (rootMargin must be specified in pixels or percent): "200" is not a number with px or %. So the element observes nothing and observing stays false. Write root-margin="200px"');
    expect(found[1].message).toBe('The browser refuses root-margin="0 0 900 0" (rootMargin must be specified in pixels or percent): "0", "900" are not numbers with px or % (a 0 needs its unit too). So the element observes nothing and no page is loaded. Write root-margin="0px 0px 900px 0px"');
    expect(found[2].message).toContain('"0" is not a number with px or % (a 0 needs its unit too)');
    expect(found[3].message).toContain('Write root-margin="-50px 10%"');
    const ja = rootMargins(html, 'ja');
    expect(ja[0].message).toBe('ブラウザは root-margin="200" を拒みます（rootMargin must be specified in pixels or percent）: "200" は px か % の付いた数値ではありません。そのため要素は何も監視せず、observing は false のままです。root-margin="200px" と書いてください');
    expect(ja[1].message).toContain('"0"・"900" は px か % の付いた数値ではありません（0 にも単位が要ります）。そのため要素は何も監視せず、次のページは読み込まれません');
  });

  it('ほかの単位・5 個以上の値も同じ理由でブラウザが拒むので報告し、書き換えは一般の形で言うこと', () => {
    const html = `<wcs-intersect root-margin="1em 10px"></wcs-intersect>
<wcs-intersect root-margin="1px 2px 3px 4px 5px"></wcs-intersect>
<wcs-intersect root-margin="10px,20px"></wcs-intersect>`;
    const found = rootMargins(html);
    expect(found.map((d) => textOf(html, d))).toEqual(['1em 10px', '1px 2px 3px 4px 5px', '10px,20px']);
    expect(found[0].message).toContain('"1em" is not a number with px or %. So');
    expect(found[0].message).toContain('Write one to four values, each a number with px or %');
    expect(found[1].message).toContain('it takes one to four values');
  });

  it('単位の付いた値・空の値・束ねた rootMargin・サーバーテンプレートの値・ほかのタグの root-margin には出さないこと', () => {
    const html = `<wcs-state><script type="module">export default { margin: "200", seen: false };</script></wcs-state>
<wcs-intersect root-margin="200px"></wcs-intersect>
<wcs-intersect root-margin="0px 0px 900px 0px"></wcs-intersect>
<wcs-intersect root-margin="10% -50px"></wcs-intersect>
<wcs-intersect root-margin=".5px 1e2px 0% +5PX"></wcs-intersect>
<wcs-intersect root-margin=""></wcs-intersect>
<wcs-intersect data-wcs="intersecting: seen"></wcs-intersect>
<wcs-intersect root-margin="200" data-wcs="rootMargin: margin"></wcs-intersect>
<wcs-intersect root-margin="200" data-wcs=".rootMargin#ro: margin; intersecting: seen"></wcs-intersect>
<wcs-infinite-scroll target="list" root-margin="{{ margin }}"></wcs-infinite-scroll>
<wcs-resize root-margin="200"></wcs-resize>
<div root-margin="200" data-root-margin="200"></div>
<!-- <wcs-intersect root-margin="200"></wcs-intersect> -->`;
    expect(rootMargins(html)).toEqual([]);
  });

  it('checkRootMargin: ブラウザが受ける形（1〜4 個、px か % の付いた数値）だけを通すこと', () => {
    for (const ok of ['', ' ', '0px', '200px', '10%', '-50px', '0px 0px 900px 0px', '.5%', '1e2px', '+5px', '10PX', '5px  5px', '\t5px\n']) {
      expect(checkRootMargin(ok), ok).toBeNull();
    }
    expect(checkRootMargin('0')).toEqual({ refused: ['0'], suggested: '0px' });
    expect(checkRootMargin('0 0 900 0')).toEqual({ refused: ['0', '900'], suggested: '0px 0px 900px 0px' });
    expect(checkRootMargin('-50')).toEqual({ refused: ['-50'], suggested: '-50px' });
    expect(checkRootMargin('1em')).toEqual({ refused: ['1em'], suggested: null });
    expect(checkRootMargin('auto')).toEqual({ refused: ['auto'], suggested: null });
    expect(checkRootMargin('10 px')).toEqual({ refused: ['10', 'px'], suggested: null });
    expect(checkRootMargin('calc(1px)')).toEqual({ refused: ['calc(1px)'], suggested: null });
    expect(checkRootMargin('1px 2px 3px 4px 5px')).toEqual({ refused: [], suggested: null });
    expect(checkRootMargin('1 2 3 4 5')).toEqual({ refused: ['1', '2', '3', '4', '5'], suggested: null });
  });

  it('CLI: warning なので既定では exit 0、--strict では exit 1', () => {
    const html = `<wcs-intersect root-margin="200"></wcs-intersect>`;
    const loose = runValidation([{ source: 'page.html', text: html, kind: 'html' }], { locale: 'en' });
    expect(loose.warningCount).toBe(1);
    expect(loose.exitCode).toBe(0);
    expect(runValidation([{ source: 'page.html', text: html, kind: 'html' }], { strict: true, locale: 'en' }).exitCode).toBe(1);
  });
});

describe('wcs/frequency-invalid — 正の数値でないセンサーの frequency', () => {
  const frequencies = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.FrequencyInvalid);

  it('4 つのセンサーのタグの、正の有限の数値でない frequency を warning で報告すること（数値で始まれば、その数値を言う）', () => {
    const html = `<wcs-accelerometer frequency="60hz"></wcs-accelerometer>
<wcs-gyroscope frequency="0"></wcs-gyroscope>
<wcs-magnetometer frequency='-5'></wcs-magnetometer>
<wcs-ambient-light-sensor frequency=fast></wcs-ambient-light-sensor>
<wcs-accelerometer frequency="59.94 fps"></wcs-accelerometer>
<wcs-gyroscope frequency="Infinity"></wcs-gyroscope>
<wcs-gyroscope frequency="60,30"></wcs-gyroscope>`;
    const found = frequencies(html);
    expect(found.map((d) => [d.severity, d.tag, d.member, textOf(html, d)])).toEqual([
      ['warning', 'wcs-accelerometer', 'frequency', '60hz'], ['warning', 'wcs-gyroscope', 'frequency', '0'],
      ['warning', 'wcs-magnetometer', 'frequency', '-5'], ['warning', 'wcs-ambient-light-sensor', 'frequency', 'fast'],
      ['warning', 'wcs-accelerometer', 'frequency', '59.94 fps'], ['warning', 'wcs-gyroscope', 'frequency', 'Infinity'],
      ['warning', 'wcs-gyroscope', 'frequency', '60,30'],
    ]);
    expect(found[0].message).toBe('frequency="60hz" is not a positive number, so <wcs-accelerometer> reads it as "none" and the sensor runs at the browser\'s default rate, without a word. Write the number alone: frequency="60"');
    expect(found[1].message).toBe('frequency="0" is not a positive number, so <wcs-gyroscope> reads it as "none" and the sensor runs at the browser\'s default rate, without a word. Write a positive number (Hz), or remove the attribute for the default rate');
    expect(found[4].message).toContain('Write the number alone: frequency="59.94"');
    const ja = frequencies(html, 'ja');
    expect(ja[0].message).toBe('frequency="60hz" は正の数値ではないので、<wcs-accelerometer> はこれを「指定なし」として読み、センサーはブラウザの既定の頻度で動きます（何も知らせません）。数値だけを書いてください: frequency="60"');
    expect(ja[2].message).toContain('正の数値（Hz）を書くか、既定の頻度でよければ属性を外してください');
  });

  it('正の数値（Number() が読む形）・空の値（指定なし）・束ねた frequency・サーバーテンプレートの値・ほかのタグの frequency には出さないこと', () => {
    const html = `<wcs-state><script type="module">export default { hz: 30, x: 0 };</script></wcs-state>
<wcs-accelerometer frequency="60"></wcs-accelerometer>
<wcs-accelerometer frequency="1000"></wcs-accelerometer>
<wcs-gyroscope frequency=" 30 "></wcs-gyroscope>
<wcs-gyroscope frequency="0.5"></wcs-gyroscope>
<wcs-magnetometer frequency="1e1"></wcs-magnetometer>
<wcs-magnetometer frequency="0x10"></wcs-magnetometer>
<wcs-ambient-light-sensor frequency=""></wcs-ambient-light-sensor>
<wcs-ambient-light-sensor frequency="  "></wcs-ambient-light-sensor>
<wcs-accelerometer data-wcs="x: x"></wcs-accelerometer>
<wcs-accelerometer frequency="60hz" data-wcs="frequency: hz"></wcs-accelerometer>
<wcs-accelerometer frequency="{{ hz }}"></wcs-accelerometer>
<wcs-osc frequency="60hz"></wcs-osc>
<div frequency="60hz" data-frequency="0"></div>
<!-- <wcs-accelerometer frequency="60hz"></wcs-accelerometer> -->`;
    expect(frequencies(html)).toEqual([]);
  });

  it('checkFrequency: 要素の getter と同じ判定（空白だけは指定なし・Number() が正の有限の数値）であること', () => {
    for (const ok of ['', ' ', '60', ' 60 ', '0.5', '.5', '1e2', '+30', '0x10', '1000']) expect(checkFrequency(ok), ok).toBeNull();
    expect(checkFrequency('60hz')).toEqual({ suggested: '60' });
    expect(checkFrequency('59.94fps')).toEqual({ suggested: '59.94' });
    expect(checkFrequency('0')).toEqual({ suggested: null });
    expect(checkFrequency('-5')).toEqual({ suggested: null });
    expect(checkFrequency('0hz')).toEqual({ suggested: null });
    expect(checkFrequency('fast')).toEqual({ suggested: null });
    expect(checkFrequency('NaN')).toEqual({ suggested: null });
    expect(checkFrequency('Infinity')).toEqual({ suggested: null });
    expect(checkFrequency('60,30')).toEqual({ suggested: '60' });
  });

  it('CLI: warning なので既定では exit 0、--strict では exit 1', () => {
    const html = `<wcs-accelerometer frequency="60hz"></wcs-accelerometer>`;
    const loose = runValidation([{ source: 'page.html', text: html, kind: 'html' }], { locale: 'en' });
    expect([loose.warningCount, loose.exitCode]).toEqual([1, 0]);
    expect(runValidation([{ source: 'page.html', text: html, kind: 'html' }], { strict: true, locale: 'en' }).exitCode).toBe(1);
  });
});

describe('wcs/target-selector — id の名前をセレクタの位置に書いた target', () => {
  const targets = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.TargetSelector);

  it('target を CSS セレクタとして読む 5 つのタグの、裸の語の target を warning で報告すること（その id の要素があり、そのタグ名の要素が無いとき）', () => {
    const html = `<div id="viewer"></div><video id="player"></video><canvas id="scene"></canvas><section id="feature_1"></section><div id="card-2"></div>
<wcs-fullscreen target="viewer"></wcs-fullscreen>
<wcs-pip target='player'></wcs-pip>
<wcs-pointer-lock target=scene></wcs-pointer-lock>
<wcs-intersect target="feature_1"></wcs-intersect>
<wcs-resize target=" card-2 "></wcs-resize>`;
    const found = targets(html);
    expect(found.map((d) => [d.severity, d.tag, d.member, textOf(html, d)])).toEqual([
      ['warning', 'wcs-fullscreen', 'target', 'viewer'], ['warning', 'wcs-pip', 'target', 'player'],
      ['warning', 'wcs-pointer-lock', 'target', 'scene'], ['warning', 'wcs-intersect', 'target', 'feature_1'],
      ['warning', 'wcs-resize', 'target', ' card-2 '],
    ]);
    expect(found[0].message).toBe('The target of <wcs-fullscreen> is a CSS selector: target="viewer" selects <viewer> elements, and this document has none — it has an element with id="viewer". No target is found, so requestFullscreen() fails, and only the error output says so. To name the id, write target="#viewer"');
    expect(found[1].message).toContain('so requestPictureInPicture() fails, and only the error output says so');
    expect(found[2].message).toContain('so requestPointerLock() fails, and only the error output says so');
    expect(found[3].message).toContain('so the element observes nothing and observing stays false. To name the id, write target="#feature_1"');
    expect(found[4].message).toContain('target="card-2" selects <card-2> elements');
    const ja = targets(html, 'ja');
    expect(ja[0].message).toBe('<wcs-fullscreen> の target は CSS セレクタです。target="viewer" は <viewer> 要素を選びますが、この文書にその要素は無く、id="viewer" の要素があります。対象が見つからないので、requestFullscreen() は失敗し、それを知らせるのは error の出力だけです。id を指すなら target="#viewer" と書いてください');
    expect(ja[3].message).toContain('対象が見つからないので、要素は何も監視せず、observing は false のままです');
  });

  it('template の中の要素の id も文書の id として数えること（ルートの中身・後から描かれる枝）', () => {
    const html = `<wcs-fullscreen target="viewer"></wcs-fullscreen>
<template data-wcs="if: open"><div id="viewer"></div></template>`;
    expect(targets(html).map((d) => textOf(html, d))).toEqual(['viewer']);
  });

  it('セレクタとして書いた target・self・省略・そのタグ名の要素がある語・その id の要素が無い語（断片）には出さないこと', () => {
    const html = `<wcs-state><script type="module">export default { which: "viewer", on: false };</script></wcs-state>
<div id="viewer"></div><video id="video"></video><main id="main"></main><div id="self"></div><my-card id="my-card"></my-card>
<wcs-fullscreen target="#viewer"></wcs-fullscreen>
<wcs-fullscreen target=".viewer"></wcs-fullscreen>
<wcs-fullscreen target="[id=viewer]"></wcs-fullscreen>
<wcs-fullscreen target="div#viewer"></wcs-fullscreen>
<wcs-fullscreen target="self"></wcs-fullscreen>
<wcs-fullscreen target=""></wcs-fullscreen>
<wcs-fullscreen><div></div></wcs-fullscreen>
<wcs-pip target="video"></wcs-pip>
<wcs-intersect target="main"></wcs-intersect>
<wcs-intersect target="MAIN"></wcs-intersect>
<wcs-resize target="my-card"></wcs-resize>
<wcs-fullscreen target="elsewhere"></wcs-fullscreen>
<wcs-fullscreen target="Viewer"></wcs-fullscreen>
<wcs-fullscreen target="viewer" data-wcs="target: which"></wcs-fullscreen>
<wcs-fullscreen target="viewer" data-wcs=".target#ro: which; active: on"></wcs-fullscreen>
<wcs-fullscreen target="{{ viewer }}"></wcs-fullscreen>
<wcs-infinite-scroll target="viewer"></wcs-infinite-scroll>
<wcs-fetch target="viewer"></wcs-fetch>
<a target="viewer" data-target="viewer"></a>
<!-- <wcs-fullscreen target="viewer"></wcs-fullscreen> -->`;
    expect(targets(html)).toEqual([]);
  });

  it('その語のタグ名の要素が文書にあれば、id の要素があっても出さないこと（書いたとおりのセレクタ）', () => {
    const html = `<video id="clip"></video><clip></clip>
<wcs-pip target="clip"></wcs-pip>`;
    expect(targets(html)).toEqual([]);
  });
});
