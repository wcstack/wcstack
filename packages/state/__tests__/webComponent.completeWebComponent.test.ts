import { describe, it, expect } from 'vitest';
import { markWebComponentAsComplete, isWebComponentComplete } from '../src/webComponent/completeWebComponent';

describe('completeWebComponent', () => {
  it('初期状態ではisWebComponentCompleteがfalseを返すこと', () => {
    const component = document.createElement('div');
    const stateElement = {} as any;
    expect(isWebComponentComplete(component, stateElement)).toBe(false);
  });

  it('markWebComponentAsComplete後にisWebComponentCompleteがtrueを返すこと', () => {
    const component = document.createElement('div');
    const stateElement = {} as any;
    markWebComponentAsComplete(component, stateElement);
    expect(isWebComponentComplete(component, stateElement)).toBe(true);
  });

  it('異なるstateElementではfalseを返すこと', () => {
    const component = document.createElement('div');
    const stateElement1 = {} as any;
    const stateElement2 = {} as any;
    markWebComponentAsComplete(component, stateElement1);
    expect(isWebComponentComplete(component, stateElement1)).toBe(true);
    expect(isWebComponentComplete(component, stateElement2)).toBe(false);
  });

  it('異なるwebComponentではfalseを返すこと', () => {
    const component1 = document.createElement('div');
    const component2 = document.createElement('div');
    const stateElement = {} as any;
    markWebComponentAsComplete(component1, stateElement);
    expect(isWebComponentComplete(component1, stateElement)).toBe(true);
    expect(isWebComponentComplete(component2, stateElement)).toBe(false);
  });

  it('同じwebComponentに複数のstateElementを登録できること', () => {
    const component = document.createElement('div');
    const stateElement1 = {} as any;
    const stateElement2 = {} as any;
    markWebComponentAsComplete(component, stateElement1);
    markWebComponentAsComplete(component, stateElement2);
    expect(isWebComponentComplete(component, stateElement1)).toBe(true);
    expect(isWebComponentComplete(component, stateElement2)).toBe(true);
  });
});
