import { describe, it, expect } from 'vitest';
import { getRootReloadPaths } from '../src/webComponent/rootReloadPaths';

describe('rootReloadPaths（ルート規則の読み直しパス）', () => {
  it('boundPaths を持たないモックは空配列を返すこと', () => {
    expect(getRootReloadPaths({} as any)).toEqual([]);
  });

  it('登録済みパスの先頭セグメントで畳み、$ 名前空間を除くこと', () => {
    const stateElement = {
      boundPaths: new Set(['name', 'tags', 'tags.*.name', '$1', 'theme.mode', 'theme']),
    } as any;
    expect(getRootReloadPaths(stateElement)).toEqual(['name', 'tags', 'theme']);
  });

  it('登録が無ければ空配列を返すこと', () => {
    expect(getRootReloadPaths({ boundPaths: new Set() } as any)).toEqual([]);
  });
});
