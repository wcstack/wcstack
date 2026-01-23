import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrapAutoloader } from '../src/bootstrapAutoloader';
import * as configModule from '../src/config';
import * as registerHandlerModule from '../src/registerHandler';

describe('bootstrapAutoloader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('設定なしで呼び出した場合、registerHandlerが呼ばれること', async () => {
    const registerHandlerSpy = vi.spyOn(registerHandlerModule, 'registerHandler').mockResolvedValue();
    const setConfigSpy = vi.spyOn(configModule, 'setConfig');

    await bootstrapAutoloader();

    expect(setConfigSpy).not.toHaveBeenCalled();
    expect(registerHandlerSpy).toHaveBeenCalled();
  });

  it('設定ありで呼び出した場合、setConfigとregisterHandlerが呼ばれること', async () => {
    const registerHandlerSpy = vi.spyOn(registerHandlerModule, 'registerHandler').mockResolvedValue();
    const setConfigSpy = vi.spyOn(configModule, 'setConfig');

    await bootstrapAutoloader({ observable: false });

    expect(setConfigSpy).toHaveBeenCalledWith({ observable: false });
    expect(registerHandlerSpy).toHaveBeenCalled();
  });
});
