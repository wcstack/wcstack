import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/registerComponents', () => ({
  registerComponents: vi.fn()
}));

vi.mock('../src/config', () => ({
  setConfig: vi.fn()
}));

import { bootstrapState } from '../src/bootstrapState';
import { registerComponents } from '../src/registerComponents';
import { setConfig } from '../src/config';

const registerComponentsMock = vi.mocked(registerComponents);
const setConfigMock = vi.mocked(setConfig);

describe('bootstrapState', () => {
  it('registerComponentsを呼ぶこと', () => {
    bootstrapState();
    expect(registerComponentsMock).toHaveBeenCalledTimes(1);
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
