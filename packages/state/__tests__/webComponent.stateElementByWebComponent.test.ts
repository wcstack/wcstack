import { describe, it, expect } from 'vitest';
import { setStateElementByWebComponent, getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { IStateElement } from '../src/components/types';

describe('stateElementByWebComponent', () => {
  it('stateElementを設定して取得できること', () => {
    const webComponent = document.createElement('div');
    const stateElement = { name: 'test-state' } as IStateElement;

    setStateElementByWebComponent(webComponent, 'state', stateElement);
    const result = getStateElementByWebComponent(webComponent, 'state');

    expect(result).toBe(stateElement);
  });

  it('未登録のwebComponentに対してはnullを返すこと', () => {
    const webComponent = document.createElement('div');

    const result = getStateElementByWebComponent(webComponent, 'state');

    expect(result).toBeNull();
  });

  it('未登録のstateNameに対してはnullを返すこと', () => {
    const webComponent = document.createElement('div');
    const stateElement = { name: 'test-state' } as IStateElement;

    setStateElementByWebComponent(webComponent, 'state', stateElement);
    const result = getStateElementByWebComponent(webComponent, 'props');

    expect(result).toBeNull();
  });

  it('異なるwebComponentに対して独立したstateElementを保持すること', () => {
    const webComponent1 = document.createElement('div');
    const webComponent2 = document.createElement('div');
    const stateElement1 = { name: 'state1' } as IStateElement;
    const stateElement2 = { name: 'state2' } as IStateElement;

    setStateElementByWebComponent(webComponent1, 'state', stateElement1);
    setStateElementByWebComponent(webComponent2, 'state', stateElement2);

    expect(getStateElementByWebComponent(webComponent1, 'state')).toBe(stateElement1);
    expect(getStateElementByWebComponent(webComponent2, 'state')).toBe(stateElement2);
  });

  it('同じwebComponentに対してstateElementを上書きできること', () => {
    const webComponent = document.createElement('div');
    const stateElement1 = { name: 'state1' } as IStateElement;
    const stateElement2 = { name: 'state2' } as IStateElement;

    setStateElementByWebComponent(webComponent, 'state', stateElement1);
    expect(getStateElementByWebComponent(webComponent, 'state')).toBe(stateElement1);

    setStateElementByWebComponent(webComponent, 'state', stateElement2);
    expect(getStateElementByWebComponent(webComponent, 'state')).toBe(stateElement2);
  });

  it('同じwebComponentに複数のstateNameで異なるstateElementを保持できること', () => {
    const webComponent = document.createElement('div');
    const stateElement = { name: 'state' } as IStateElement;
    const propsElement = { name: 'props' } as IStateElement;
    const contextElement = { name: 'context' } as IStateElement;

    setStateElementByWebComponent(webComponent, 'state', stateElement);
    setStateElementByWebComponent(webComponent, 'props', propsElement);
    setStateElementByWebComponent(webComponent, 'context', contextElement);

    expect(getStateElementByWebComponent(webComponent, 'state')).toBe(stateElement);
    expect(getStateElementByWebComponent(webComponent, 'props')).toBe(propsElement);
    expect(getStateElementByWebComponent(webComponent, 'context')).toBe(contextElement);
  });
});
