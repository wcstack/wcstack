import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './setup';
import { warnUnboundMarkup, _resetUnboundMarkupWarnings } from '../src/unboundMarkupWarning';

// 後から DOM に差し込まれたノードのバインドは効かない（state はバインド構築時に
// document に居たノードしか走査しない）。挙動は変えず、「黙って空になる」を
// 「原因を指す警告」に変えるのがこのモジュールの役割。
describe('warnUnboundMarkup', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const created: Element[] = [];

  const make = (html: string): Element => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const element = host.firstElementChild as Element;
    created.push(element);
    return element;
  };

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    _resetUnboundMarkupWarnings(created);
    created.length = 0;
    vi.restoreAllMocks();
  });

  it('data-wcs を持つ要素自身を報告すること', () => {
    warnUnboundMarkup(make('<h2 data-wcs="textContent: title"></h2>'), 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('here');
    expect(warn.mock.calls[0][0]).toContain('do that');
  });

  it('子孫の data-wcs も報告すること', () => {
    warnUnboundMarkup(make('<section><p><span data-wcs="textContent: x"></span></p></section>'), 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('バインドが無ければ黙っていること', () => {
    warnUnboundMarkup(make('<section><p>static text</p></section>'), 'here', 'do that');
    expect(warn).not.toHaveBeenCalled();
  });

  it('同じ要素では 1 回しか報告しないこと', () => {
    const element = make('<h2 data-wcs="textContent: title"></h2>');
    warnUnboundMarkup(element, 'here', 'do that');
    warnUnboundMarkup(element, 'here', 'do that');
    warnUnboundMarkup(element, 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('要素ごとに独立して報告すること', () => {
    warnUnboundMarkup(make('<h2 data-wcs="textContent: a"></h2>'), 'here', 'do that');
    warnUnboundMarkup(make('<h2 data-wcs="textContent: b"></h2>'), 'here', 'do that');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('原因（バインド構築の時点）に言及すること', () => {
    warnUnboundMarkup(make('<h2 data-wcs="textContent: title"></h2>'), 'here', 'do that');
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain('[@wcstack/router]');
    expect(message).toContain('built its');
    expect(message).toContain('render empty');
  });
});
