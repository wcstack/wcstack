import { describe, it, expect, afterEach } from 'vitest';
import { getStateElementByName, setStateElementByName } from '../src/stateElementByName';
import { registerComponents } from '../src/registerComponents';
import { config } from '../src/config';


describe('stateElementByName', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    setStateElementByName('default', null);
    setStateElementByName('custom', null);
  });

  it('set/getできること', () => {
    const fake = { name: 'custom' } as any;
    setStateElementByName('custom', fake);
    expect(getStateElementByName('custom')).toBe(fake);

    setStateElementByName('custom', null);
    expect(getStateElementByName('custom')).toBeNull();
  });

  it('default名はDOMから取得できること', () => {
    if (!customElements.get(config.tagNames.state)) {
      registerComponents();
    }

    const el = document.createElement(config.tagNames.state);
    document.body.appendChild(el);

    const found = getStateElementByName('default');
    expect(found).toBe(el);
  });
});
