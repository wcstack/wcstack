import { describe, it, expect, afterEach } from 'vitest';
import { getStateElementByName, setStateElementByName } from '../src/stateElementByName';
import { config } from '../src/config';


describe('stateElementByName', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    setStateElementByName(document, 'default', null);
    setStateElementByName(document, 'custom', null);
    setStateElementByName(document, 'debug', null);
  });

  it('set/getできること', () => {
    const fake = { name: 'custom' } as any;
    setStateElementByName(document, 'custom', fake);
    expect(getStateElementByName(document, 'custom')).toBe(fake);

    setStateElementByName(document, 'custom', null);
    expect(getStateElementByName(document, 'custom')).toBeNull();
  });

  it('同じ名前で二重登録するとエラーになること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElementByName(document, 'custom', fake1);
    expect(() => setStateElementByName(document, 'custom', fake2)).toThrow(/already registered/);
  });

  it('解除後は再登録できること', () => {
    const fake1 = { name: 'custom' } as any;
    const fake2 = { name: 'custom' } as any;
    setStateElementByName(document, 'custom', fake1);
    setStateElementByName(document, 'custom', null);
    setStateElementByName(document, 'custom', fake2);
    expect(getStateElementByName(document, 'custom')).toBe(fake2);
  });

  it('未登録の名前はnullを返すこと', () => {
    expect(getStateElementByName(document, 'nonexistent')).toBeNull();
  });

  it('debugモードがfalseの場合でも動作すること', () => {
    const originalDebug = config.debug;
    config.debug = false;
    try {
      const fake = { name: 'debug' } as any;
      setStateElementByName(document, 'debug', fake);
      expect(getStateElementByName(document, 'debug')).toBe(fake);
      setStateElementByName(document, 'debug', null);
      expect(getStateElementByName(document, 'debug')).toBeNull();
    } finally {
      config.debug = originalDebug;
    }
  });
});
