import { describe, it, expect, afterEach } from 'vitest';
import { getStateElementByName, setStateElementByName } from '../src/stateElementByName';
import { config } from '../src/config';


describe('stateElementByName', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    setStateElementByName('default', null);
    setStateElementByName('custom', null);
    setStateElementByName('debug', null);
  });

  it('set/getできること', () => {
    const fake = { name: 'custom' } as any;
    setStateElementByName('custom', fake);
    expect(getStateElementByName('custom')).toBe(fake);

    setStateElementByName('custom', null);
    expect(getStateElementByName('custom')).toBeNull();
  });

  it('同じ名前で二重登録するとエラーになること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElementByName('custom', fake1);
    expect(() => setStateElementByName('custom', fake2)).toThrow(/already registered/);
  });

  it('解除後は再登録できること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElementByName('custom', fake1);
    setStateElementByName('custom', null);
    setStateElementByName('custom', fake2);
    expect(getStateElementByName('custom')).toBe(fake2);
  });

  it('未登録の名前はnullを返すこと', () => {
    expect(getStateElementByName('nonexistent')).toBeNull();
  });

  it('debugモードがfalseの場合でも動作すること', () => {
    const originalDebug = config.debug;
    config.debug = false;
    try {
      const fake = { name: 'debug' } as any;
      setStateElementByName('debug', fake);
      expect(getStateElementByName('debug')).toBe(fake);
      setStateElementByName('debug', null);
      expect(getStateElementByName('debug')).toBeNull();
    } finally {
      config.debug = originalDebug;
    }
  });
});
