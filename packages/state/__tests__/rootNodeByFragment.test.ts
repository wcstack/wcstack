import { describe, it, expect } from 'vitest';
import { setRootNodeByFragment, getRootNodeByFragment } from '../src/apply/rootNodeByFragment';

describe('rootNodeByFragment', () => {
  it('setで登録したrootNodeをgetで取得できること', () => {
    const fragment = document.createDocumentFragment();
    const rootNode = document.createElement('div');

    setRootNodeByFragment(fragment, rootNode);
    expect(getRootNodeByFragment(fragment)).toBe(rootNode);
  });

  it('未登録のfragmentはnullを返すこと', () => {
    const fragment = document.createDocumentFragment();
    expect(getRootNodeByFragment(fragment)).toBeNull();
  });

  it('nullを設定すると登録が削除されること', () => {
    const fragment = document.createDocumentFragment();
    const rootNode = document.createElement('div');

    setRootNodeByFragment(fragment, rootNode);
    expect(getRootNodeByFragment(fragment)).toBe(rootNode);

    setRootNodeByFragment(fragment, null);
    expect(getRootNodeByFragment(fragment)).toBeNull();
  });
});
