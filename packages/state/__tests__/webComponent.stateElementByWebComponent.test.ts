import { describe, it, expect } from 'vitest';
import { setStateElementByWebComponent, getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { IStateElement } from '../src/components/types';

describe('stateElementByWebComponent', () => {
  it('stateElementを設定して取得できること', () => {
    const webComponent = document.createElement('div');
    const stateElement = { name: 'test-state' } as IStateElement;

    setStateElementByWebComponent(webComponent, stateElement);
    const result = getStateElementByWebComponent(webComponent);

    expect(result).toBe(stateElement);
  });

  it('未登録のwebComponentに対してはnullを返すこと', () => {
    const webComponent = document.createElement('div');

    const result = getStateElementByWebComponent(webComponent);

    expect(result).toBeNull();
  });

  it('異なるwebComponentに対して独立したstateElementを保持すること', () => {
    const webComponent1 = document.createElement('div');
    const webComponent2 = document.createElement('div');
    const stateElement1 = { name: 'state1' } as IStateElement;
    const stateElement2 = { name: 'state2' } as IStateElement;

    setStateElementByWebComponent(webComponent1, stateElement1);
    setStateElementByWebComponent(webComponent2, stateElement2);

    expect(getStateElementByWebComponent(webComponent1)).toBe(stateElement1);
    expect(getStateElementByWebComponent(webComponent2)).toBe(stateElement2);
  });

  it('同じwebComponentに対してstateElementを上書きできること', () => {
    const webComponent = document.createElement('div');
    const stateElement1 = { name: 'state1' } as IStateElement;
    const stateElement2 = { name: 'state2' } as IStateElement;

    setStateElementByWebComponent(webComponent, stateElement1);
    expect(getStateElementByWebComponent(webComponent)).toBe(stateElement1);

    setStateElementByWebComponent(webComponent, stateElement2);
    expect(getStateElementByWebComponent(webComponent)).toBe(stateElement2);
  });
});
