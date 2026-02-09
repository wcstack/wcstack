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

  it('default名はDOMに追加されると自動的に登録されること', async () => {
    if (!customElements.get(config.tagNames.state)) {
      registerComponents();
    }

    const el = document.createElement(config.tagNames.state) as any;
    document.body.appendChild(el);

    // connectedCallback内での非同期登録を待つ
    await el.initializePromise;

    const found = getStateElementByName('default');
    expect(found).toBe(el);
  });
});
