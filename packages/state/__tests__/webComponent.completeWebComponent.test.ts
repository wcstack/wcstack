import { describe, it, expect } from 'vitest';
import { markWebComponentAsComplete, isWebComponentComplete } from '../src/webComponent/completeWebComponent';

describe('completeWebComponent', () => {
  it('初期状態ではisWebComponentCompleteがfalseを返すこと', () => {
    const component = document.createElement('div');
    expect(isWebComponentComplete(component, 'state')).toBe(false);
  });

  it('markWebComponentAsComplete後にisWebComponentCompleteがtrueを返すこと', () => {
    const component = document.createElement('div');
    markWebComponentAsComplete(component, 'state');
    expect(isWebComponentComplete(component, 'state')).toBe(true);
  });

  it('異なるstatePropではfalseを返すこと', () => {
    const component = document.createElement('div');
    markWebComponentAsComplete(component, 'state');
    expect(isWebComponentComplete(component, 'state')).toBe(true);
    expect(isWebComponentComplete(component, 'other')).toBe(false);
  });

  it('異なるwebComponentではfalseを返すこと', () => {
    const component1 = document.createElement('div');
    const component2 = document.createElement('div');
    markWebComponentAsComplete(component1, 'state');
    expect(isWebComponentComplete(component1, 'state')).toBe(true);
    expect(isWebComponentComplete(component2, 'state')).toBe(false);
  });

  it('同じwebComponentに複数のstatePropを登録できること', () => {
    const component = document.createElement('div');
    markWebComponentAsComplete(component, 'state');
    markWebComponentAsComplete(component, 'other');
    expect(isWebComponentComplete(component, 'state')).toBe(true);
    expect(isWebComponentComplete(component, 'other')).toBe(true);
  });

  it('同じstatePropを二度登録しても冪等であること', () => {
    const component = document.createElement('div');
    markWebComponentAsComplete(component, 'state');
    markWebComponentAsComplete(component, 'state');
    expect(isWebComponentComplete(component, 'state')).toBe(true);
  });
});
