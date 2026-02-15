import { describe, it, expect } from 'vitest';
import { getBindingsByNode, setBindingsByNode, addBindingByNode } from '../src/bindings/getBindingsByNode';
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

describe('addBindingByNode', () => {
  it('未登録のnodeに対して新しい配列を作成してバインディングを追加すること', () => {
    const node = document.createElement('div');
    const binding: IBindingInfo = { statePathName: 'path1' } as IBindingInfo;

    addBindingByNode(node, binding);

    const bindings = getBindingsByNode(node);
    expect(bindings).not.toBeNull();
    expect(bindings).toHaveLength(1);
    expect(bindings![0]).toBe(binding);
  });

  it('既存のバインディング配列に新しいバインディングを追加すること', () => {
    const node = document.createElement('div');
    const binding1: IBindingInfo = { statePathName: 'path1' } as IBindingInfo;
    const binding2: IBindingInfo = { statePathName: 'path2' } as IBindingInfo;

    setBindingsByNode(node, [binding1]);
    addBindingByNode(node, binding2);

    const bindings = getBindingsByNode(node);
    expect(bindings).not.toBeNull();
    expect(bindings).toHaveLength(2);
    expect(bindings![0]).toBe(binding1);
    expect(bindings![1]).toBe(binding2);
  });

  it('複数回addBindingByNodeを呼んで複数のバインディングを追加できること', () => {
    const node = document.createElement('div');
    const binding1: IBindingInfo = { statePathName: 'path1' } as IBindingInfo;
    const binding2: IBindingInfo = { statePathName: 'path2' } as IBindingInfo;
    const binding3: IBindingInfo = { statePathName: 'path3' } as IBindingInfo;

    addBindingByNode(node, binding1);
    addBindingByNode(node, binding2);
    addBindingByNode(node, binding3);

    const bindings = getBindingsByNode(node);
    expect(bindings).not.toBeNull();
    expect(bindings).toHaveLength(3);
    expect(bindings![0]).toBe(binding1);
    expect(bindings![1]).toBe(binding2);
    expect(bindings![2]).toBe(binding3);
  });
});
