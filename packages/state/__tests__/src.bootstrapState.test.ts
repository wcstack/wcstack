import { describe, it, expect, vi } from 'vitest';

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

  it('configが指定されない場合、setConfigを呼ばないこと', () => {
    setConfigMock.mockClear();
    bootstrapState();
    expect(setConfigMock).not.toHaveBeenCalled();
  });
});
