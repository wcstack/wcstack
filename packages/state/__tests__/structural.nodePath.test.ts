import { describe, it, expect } from 'vitest';
import { getNodePath } from '../src/structural/getNodePath';
import { resolveNodePath } from '../src/structural/resolveNodePath';

describe('getNodePath / resolveNodePath', () => {
  it('パスから元のノードを解決できること', () => {
    const root = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('p');
    const grand = document.createElement('em');

    root.appendChild(child1);
    root.appendChild(child2);
    child2.appendChild(grand);

    const path = getNodePath(grand);
    expect(path).toEqual([1, 0]);

    const resolved = resolveNodePath(root, path);
    expect(resolved).toBe(grand);
  });

  it('空パスはrootを返すこと', () => {
    const root = document.createElement('div');
    expect(resolveNodePath(root, [])).toBe(root);
  });
});
