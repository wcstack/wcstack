import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/registerComponents', () => ({
  registerComponents: vi.fn()
}));

vi.mock('../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config')>();
  return {
    ...actual,
    setConfig: vi.fn()
  };
});

vi.mock('../src/devtools/bridge', () => ({
  registerDevtoolsSource: vi.fn()
}));

import { bootstrapState } from '../src/bootstrapState';
import { registerComponents } from '../src/registerComponents';
import { setConfig } from '../src/config';
import { registerDevtoolsSource } from '../src/devtools/bridge';

const registerComponentsMock = vi.mocked(registerComponents);
const setConfigMock = vi.mocked(setConfig);
const registerDevtoolsSourceMock = vi.mocked(registerDevtoolsSource);

describe('bootstrapState', () => {
  it('registerComponentsを呼ぶこと', () => {
    bootstrapState();
    expect(registerComponentsMock).toHaveBeenCalledTimes(1);
  });

  it('registerDevtoolsSourceを呼ぶこと', () => {
    registerDevtoolsSourceMock.mockClear();
    bootstrapState();
    expect(registerDevtoolsSourceMock).toHaveBeenCalledTimes(1);
  });

  it('configが指定された場合、setConfigを呼ぶこと', () => {
    const config = { locale: 'ja-JP', debug: true };
    bootstrapState(config);
    expect(setConfigMock).toHaveBeenCalledWith(config);
    expect(registerComponentsMock).toHaveBeenCalled();
  });

  it('configも<html lang>も無い場合、setConfigを呼ばないこと', () => {
    setConfigMock.mockClear();
    bootstrapState();
    expect(setConfigMock).not.toHaveBeenCalled();
  });
});

// ロケール依存フィルタを設定できる公開の入口は bootstrapState({ locale }) だけで、
// auto エントリは引数なしで呼ぶ。CDN 一発のページがロケールを指定できるよう
// <html lang> を既定に採る（docs/i18n-impl-plan.md Phase 0-結果-5）。
describe('bootstrapState — <html lang> を既定ロケールにする', () => {
  const originalLang = document.documentElement.lang;

  afterEach(() => {
    document.documentElement.lang = originalLang;
    vi.restoreAllMocks();
  });

  it('<html lang> をロケールとして採ること', () => {
    setConfigMock.mockClear();
    document.documentElement.lang = 'ja-JP';
    bootstrapState();
    expect(setConfigMock).toHaveBeenCalledWith({ locale: 'ja-JP' });
  });

  it('明示指定が <html lang> より優先すること', () => {
    setConfigMock.mockClear();
    document.documentElement.lang = 'ja-JP';
    bootstrapState({ locale: 'fr-FR' });
    expect(setConfigMock).toHaveBeenCalledWith({ locale: 'fr-FR' });
  });

  it('他の設定と併用できること', () => {
    setConfigMock.mockClear();
    document.documentElement.lang = 'ja-JP';
    bootstrapState({ debug: true });
    expect(setConfigMock).toHaveBeenCalledWith({ debug: true, locale: 'ja-JP' });
  });

  it('空の lang は無視すること', () => {
    setConfigMock.mockClear();
    document.documentElement.lang = '';
    bootstrapState();
    expect(setConfigMock).not.toHaveBeenCalled();
  });

  // 不正なタグをそのまま採ると、既定 'en' で動いていたページのフィルタが
  // Intl の RangeError で落ちる。既定へ落として警告する。
  it('不正な BCP-47 タグは警告して既定へ落とすこと', () => {
    setConfigMock.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.documentElement.lang = 'not a language tag';
    bootstrapState();
    expect(setConfigMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid BCP-47 language tag'));
  });
});
