import { describe, it, expect } from 'vitest';
import { getNavigation } from '../src/Navigation';

describe('getNavigation', () => {
  it('window.navigation縺後↑縺・ｴ蜷医・null繧定ｿ斐☆縺薙→', () => {
    delete (window as any).navigation;
    expect(getNavigation()).toBeNull();
  });

  it('addEventListener/removeEventListener縺後↑縺・ｴ蜷医・null繧定ｿ斐☆縺薙→', () => {
    (window as any).navigation = { navigate: () => {} };
    expect(getNavigation()).toBeNull();
  });

  it('蠢・ｦ√↑繝｡繧ｽ繝・ラ縺梧純縺｣縺ｦ縺・ｋ蝣ｴ蜷医・navigation繧定ｿ斐☆縺薙→', () => {
    const navigation = {
      navigate: () => {},
      addEventListener: () => {},
      removeEventListener: () => {}
    };
    (window as any).navigation = navigation;
    expect(getNavigation()).toBe(navigation);
  });
});
