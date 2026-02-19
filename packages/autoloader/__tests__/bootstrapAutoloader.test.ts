import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrapAutoloader } from '../src/bootstrapAutoloader';
import * as configModule from '../src/config';
import * as registerComponentsModule from '../src/registerComponents';

describe('bootstrapAutoloader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('設定なしで呼び出した場合、registerComponentsが呼ばれること', () => {
    const registerComponentsSpy = vi.spyOn(registerComponentsModule, 'registerComponents').mockImplementation(() => {});
    const setConfigSpy = vi.spyOn(configModule, 'setConfig');

    bootstrapAutoloader();

    expect(setConfigSpy).not.toHaveBeenCalled();
    expect(registerComponentsSpy).toHaveBeenCalled();
  });

  it('設定ありで呼び出した場合、setConfigとregisterComponentsが呼ばれること', () => {
    const registerComponentsSpy = vi.spyOn(registerComponentsModule, 'registerComponents').mockImplementation(() => {});
    const setConfigSpy = vi.spyOn(configModule, 'setConfig');

    bootstrapAutoloader({ observable: false });

    expect(setConfigSpy).toHaveBeenCalledWith({ observable: false });
    expect(registerComponentsSpy).toHaveBeenCalled();
  });
});
