import { describe, it, expect } from 'vitest';
import { getLoopContextByNode, setLoopContextByNode } from '../src/list/loopContextByNode';
import { createListIndex } from '../src/list/createListIndex';
import { getPathInfo } from '../src/address/PathInfo';
import type { ILoopContext } from '../src/list/types';

describe('loopContextByNode', () => {
  it('set/get できること', () => {
    const node = document.createElement('div');
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('users.*'),
      listIndex: createListIndex(null, 0)
    };

    setLoopContextByNode(node, loopContext);
    expect(getLoopContextByNode(node)).toBe(loopContext);
  });

  it('nullで削除できること', () => {
    const node = document.createElement('div');
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('users.*'),
      listIndex: createListIndex(null, 1)
    };

    setLoopContextByNode(node, loopContext);
    setLoopContextByNode(node, null);

    expect(getLoopContextByNode(node)).toBeNull();
  });
});
