/**
 * `_ensureShadow` の upgrade は registry が引けない環境（browser globals が無い等）でも
 * 落ちてはならない。defineDCC 自身は global の customElements を直接使うため、
 * adapter だけを差し替えれば upgrade 経路だけを無効化できる。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/platform/customElementRegistry', () => ({
  getCustomElementRegistry: vi.fn(() => null),
  upgradeCustomElement: vi.fn(),
}));

import { defineDCC } from '../src/dcc/defineDCC';
import { getCustomElementRegistry, upgradeCustomElement } from '../src/platform/customElementRegistry';

describe('dcc/defineDCC (registry が引けない環境)', () => {
  it('upgradeをスキップしてもshadowの構築は成功すること', () => {
    const tag = 'dcc-no-registry';
    const host = document.createElement(tag);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>hello</p>';
    defineDCC(host, shadow, { count: 0 });

    const instance = document.createElement(tag);
    document.body.appendChild(instance);

    expect(instance.shadowRoot).not.toBeNull();
    expect(instance.shadowRoot!.querySelectorAll('p').length).toBe(1);
    expect(getCustomElementRegistry).toHaveBeenCalled();
    expect(upgradeCustomElement).not.toHaveBeenCalled();

    instance.remove();
  });
});
