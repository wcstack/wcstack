/**
 * `_ensureShadow` の upgrade は registry が引けない場合でも落ちてはならない。
 * 定義先（ホスト由来）は引けるが生成インスタンスの shadow が null レジストリ、
 * という状況を作って upgrade 経路だけを無効化する。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/platform/customElementRegistry', () => ({
  getCustomElementRegistry: vi.fn((owner: unknown) =>
    owner instanceof ShadowRoot ? null : customElements),
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

  it('定義先レジストリが引けない場合は落ちること', () => {
    vi.mocked(getCustomElementRegistry).mockReturnValueOnce(null as any);
    const host = document.createElement('dcc-no-definition-registry');
    const shadow = host.attachShadow({ mode: 'open' });

    expect(() => defineDCC(host, shadow, { count: 0 })).toThrow(
      /CustomElementRegistry is unavailable/
    );
  });
});
