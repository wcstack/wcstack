/**
 * 名前付き State の deprecation 通知（docs/state-mount-design.md D16）。
 *
 * 1.x には `mount=` が無く、warn を出しても利用者は動けないので既定では黙る。
 * `config.debug` 下でだけ、種別 × 対象ごとに 1 回出す。
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { config } from '../src/config';
import { warnNamedStateDeprecated, clearNamedStateDeprecationReportsForTesting } from '../src/deprecation';
import { parseStatePart } from '../src/bindTextParser/parseStatePart';
import { bootstrapState } from '../src/bootstrapState';
import { State } from '../src/components/State';

beforeAll(() => {
  bootstrapState();
});

describe('deprecation: 名前付き State', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearNamedStateDeprecationReportsForTesting();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    config.debug = false;
  });

  it('config.debug が偽なら何も出さないこと', () => {
    warnNamedStateDeprecated('attribute', 'cart');
    warnNamedStateDeprecated('path', 'total@cart');
    expect(warn).not.toHaveBeenCalled();
  });

  it('debug 下で name 属性は mount= を指して 1 回だけ出すこと', () => {
    config.debug = true;
    warnNamedStateDeprecated('attribute', 'cart');
    warnNamedStateDeprecated('attribute', 'cart');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('[wcs/named-state-deprecated]');
    expect(message).toContain('mount="cart"');
    expect(message).toContain('"cart.<path>"');
  });

  it('debug 下で @name パスは接頭辞への置き換えを指すこと', () => {
    config.debug = true;
    warnNamedStateDeprecated('path', 'total@cart');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('"total@cart"');
    expect(message).toContain('"<name>.<path>"');
  });

  it('種別と対象が違えば別に数えること', () => {
    config.debug = true;
    warnNamedStateDeprecated('attribute', 'cart');
    warnNamedStateDeprecated('path', 'cart');
    warnNamedStateDeprecated('attribute', 'user');
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('parseStatePart が @ を含むパスで通知し、含まなければ通知しないこと', () => {
    config.debug = true;
    parseStatePart('total@cart|number');
    parseStatePart('total');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"total@cart"');
  });

  it('<wcs-state name> が接続時に通知すること（bind-component は除く）', async () => {
    config.debug = true;
    const host = document.createElement('div');
    host.innerHTML = `<wcs-state name="dep-cart" json='{"total":1}'></wcs-state>`;
    document.body.appendChild(host);
    const stateElement = host.querySelector('wcs-state') as State;
    await stateElement.connectedCallbackPromise;
    expect(warn.mock.calls.some((c) => String(c[0]).includes('mount="dep-cart"'))).toBe(true);
    host.remove();
  });
});
