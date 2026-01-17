import { describe, it, expect } from 'vitest';
import { getNavigation } from '../src/Navigation';

describe('getNavigation', () => {
  it('window.navigationがない場合はnullを返すこと', () => {
    delete (window as any).navigation;
    expect(getNavigation()).toBeNull();
  });

  it('addEventListener/removeEventListenerがない場合はnullを返すこと', () => {
    (window as any).navigation = { navigate: () => {} };
    expect(getNavigation()).toBeNull();
  });

  it('必要なメソッドが揃っている場合はnavigationを返すこと', () => {
    const navigation = {
      navigate: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    (window as any).navigation = navigation;
    expect(getNavigation()).toBe(navigation);
  });
});
