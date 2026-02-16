import { describe, it, expect } from 'vitest';
import { getInitializeBindingPromiseByNode, waitInitializeBinding, resolveInitializedBinding } from '../src/bindings/initializeBindingPromiseByNode';

describe('initializeBindingPromiseByNode', () => {
  it('nodeに対してpromiseを取得・初期化できること', async () => {
    const node = document.createElement('div');
    const bindingPromise = getInitializeBindingPromiseByNode(node);

    expect(bindingPromise.promise).toBeInstanceOf(Promise);
    expect(bindingPromise.resolve).toBeTypeOf('function');
    expect(bindingPromise.id).toBeTypeOf('number');

    // 同じノードに対しては同じオブジェクトを返すこと
    const sameBindingPromise = getInitializeBindingPromiseByNode(node);
    expect(sameBindingPromise).toBe(bindingPromise);

    let resolved = false;
    bindingPromise.promise.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    resolveInitializedBinding(node);
    
    await bindingPromise.promise;
    expect(resolved).toBe(true);
  });

  it('waitInitializeBindingで解決を待機できること', async () => {
    const node = document.createElement('span');
    let resolved = false;

    const waitPromise = waitInitializeBinding(node).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    resolveInitializedBinding(node);

    await waitPromise;
    expect(resolved).toBe(true);
  });

  it('既に解決済みの場合は即座に完了すること', async () => {
    const node = document.createElement('p');
    resolveInitializedBinding(node);

    let resolved = false;
    await waitInitializeBinding(node);
    resolved = true;
    expect(resolved).toBe(true);
  });

  it('異なるノードには異なるidが割り当てられること', () => {
    const node1 = document.createElement('div');
    const node2 = document.createElement('div');
    const bp1 = getInitializeBindingPromiseByNode(node1);
    const bp2 = getInitializeBindingPromiseByNode(node2);
    expect(bp1.id).not.toBe(bp2.id);
  });
});
