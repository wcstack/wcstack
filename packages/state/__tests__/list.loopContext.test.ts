import { describe, it, expect } from 'vitest';
import { createLoopContextStack } from '../src/list/loopContext';
import { createListIndex } from '../src/list/createListIndex';
import { getPathInfo } from '../src/address/PathInfo';

describe('loopContext', () => {
  it('ループコンテキストがない状態でwildcardが1以外ならエラーになること', () => {
    const stack = createLoopContextStack();
    const listIndex = createListIndex(null, 0);
    const pathInfo = getPathInfo('users.*.orders.*'); // wildcardCount = 2

    expect(() => stack.createLoopContext(pathInfo, listIndex, () => undefined)).toThrow(
      /Cannot push loop context for a list with wildcard positions when there is no active loop context/,
    );
  });

  it('ネスト時にwildcard数が+1でない場合はエラーになること', () => {
    const stack = createLoopContextStack();
    const rootIndex = createListIndex(null, 0);
    const childIndex = createListIndex(rootIndex, 0);
    const outerPath = getPathInfo('users.*.orders'); // wildcardCount = 1
    const innerPath = getPathInfo('users.*.orders'); // wildcardCount = 1

    stack.createLoopContext(outerPath, rootIndex, () => {
      expect(() => stack.createLoopContext(innerPath, childIndex, () => undefined)).toThrow(
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

    stack.createLoopContext(outerPath, rootIndex, () => {
      expect(() => stack.createLoopContext(innerPath, childIndex, () => undefined)).toThrow(
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

    stack.createLoopContext(outerPath, rootIndex, (outer) => {
      expect(outer.elementPathInfo).toBe(outerPath);
      stack.createLoopContext(innerPath, childIndex, (inner) => {
        expect(inner.elementPathInfo).toBe(innerPath);
      });
    });
  });

  it('非同期コールバックでもスタックが後始末されること', async () => {
    const stack = createLoopContextStack();
    const listIndex = createListIndex(null, 0);
    const pathInfo = getPathInfo('users.*');

    await stack.createLoopContext(pathInfo, listIndex, async () => {
      return Promise.resolve();
    });

    // after async, should allow new root context
    expect(() => stack.createLoopContext(pathInfo, listIndex, () => undefined)).not.toThrow();
  });
});
