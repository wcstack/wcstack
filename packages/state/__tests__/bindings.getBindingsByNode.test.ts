import { describe, it, expect } from 'vitest';
import { getBindingsByNode, setBindingsByNode } from '../src/bindings/getBindingsByNode';
import { IBindingInfo } from '../src/types';

describe('getBindingsByNode', () => {
  it('nodeに対してbindingsをset/getできること', () => {
    const node = document.createElement('div');
    const bindings: IBindingInfo[] = [
      { statePathName: 'path1' } as IBindingInfo,
      { statePathName: 'path2' } as IBindingInfo,
    ];

    setBindingsByNode(node, bindings);
    expect(getBindingsByNode(node)).toBe(bindings);
  });

  it('未登録のnodeに対してはnullを返すこと', () => {
    const node = document.createElement('span');
    expect(getBindingsByNode(node)).toBeNull();
  });
});
