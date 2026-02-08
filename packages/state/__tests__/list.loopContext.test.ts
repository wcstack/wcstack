import { describe, it, expect } from 'vitest';
import { createLoopContextStack } from '../src/list/loopContext';
import { createListIndex } from '../src/list/createListIndex';
import { getPathInfo } from '../src/address/PathInfo';
import { createStateAddress } from '../src/address/StateAddress';
import { MAX_LOOP_DEPTH } from '../src/define';

describe('loopContext', () => {
  it('ループコンテキストがない状態でwildcardが1以外ならエラーになること', () => {
    const stack = createLoopContextStack();
    const listIndex = createListIndex(null, 0);
    const pathInfo = getPathInfo('users.*.orders.*'); // wildcardCount = 2

    expect(() => stack.createLoopContext(createStateAddress(pathInfo, listIndex), () => undefined)).toThrow(
      /Cannot push loop context for a list with wildcard positions when there is no active loop context/,
    );
  });

  it('ネスト時にwildcard数が+1でない場合はエラーになること', () => {
    const stack = createLoopContextStack();
    const rootIndex = createListIndex(null, 0);
    const childIndex = createListIndex(rootIndex, 0);
    const outerPath = getPathInfo('users.*.orders'); // wildcardCount = 1
    const innerPath = getPathInfo('users.*.orders'); // wildcardCount = 1

    stack.createLoopContext(createStateAddress(outerPath, rootIndex), () => {
      expect(() => stack.createLoopContext(createStateAddress(innerPath, childIndex), () => undefined)).toThrow(
        /wildcard count is not exactly one more/,
      );
    });
  });

  it('ネスト時に親wildcardパスが一致しない場合はエラーになること', () => {
    const stack = createLoopContextStack();
    const rootIndex = createListIndex(null, 0);
    const childIndex = createListIndex(rootIndex, 0);
    const outerPath = getPathInfo('users.*'); // wildcardCount = 1
    const innerPath = getPathInfo('users.*.orders.*'); // wildcardCount = 2, parent path mismatch

    stack.createLoopContext(createStateAddress(outerPath, rootIndex), () => {
      expect(() => stack.createLoopContext(createStateAddress(innerPath, childIndex), () => undefined)).toThrow(
        /parent wildcard path info does not match/,
      );
    });
  });

  it('正しい階層でネストできること', () => {
    const stack = createLoopContextStack();
    const rootIndex = createListIndex(null, 0);
    const childIndex = createListIndex(rootIndex, 1);
    const outerPath = getPathInfo('users.*.orders'); // wildcardCount = 1
    const innerPath = getPathInfo('users.*.orders.*'); // last wildcard parent path == outerPath

    stack.createLoopContext(createStateAddress(outerPath, rootIndex), (outer) => {
      expect(outer.pathInfo).toBe(outerPath);
      stack.createLoopContext(createStateAddress(innerPath, childIndex), (inner) => {
        expect(inner.pathInfo).toBe(innerPath);
      });
    });
  });

  it('非同期コールバックでもスタックが後始末されること', async () => {
    const stack = createLoopContextStack();
    const listIndex = createListIndex(null, 0);
    const pathInfo = getPathInfo('users.*');

    await stack.createLoopContext(createStateAddress(pathInfo, listIndex), async () => {
      return Promise.resolve();
    });

    // after async, should allow new root context
    expect(() => stack.createLoopContext(createStateAddress(pathInfo, listIndex), () => undefined)).not.toThrow();
  });

  it('listIndexがnullのStateAddressを渡すとエラーになること', () => {
    const stack = createLoopContextStack();
    const pathInfo = getPathInfo('users.*');
    const address = createStateAddress(pathInfo, null);

    expect(() => stack.createLoopContext(address, () => undefined)).toThrow(
      /Cannot create loop context for a state address that does not have a list index/,
    );
  });

  it('MAX_LOOP_DEPTHを超えるとエラーになること', () => {
    const stack = createLoopContextStack();
    (stack as any)._length = MAX_LOOP_DEPTH;

    const listIndex = createListIndex(null, 0);
    const pathInfo = getPathInfo('users.*');

    expect(() => stack.createLoopContext(createStateAddress(pathInfo, listIndex), () => undefined)).toThrow(
      /Exceeded maximum loop context stack depth/,
    );
  });
});
