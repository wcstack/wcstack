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

  it('範囲外の添字・子の無いノードを辿るパスはnullを返すこと', () => {
    const root = document.createElement('div');
    const child = document.createElement('span');
    root.appendChild(child);
    // 兄弟が尽きる
    expect(resolveNodePath(root, [1])).toBeNull();
    // 途中で子が無い（span に子は無い）
    expect(resolveNodePath(root, [0, 0])).toBeNull();
    // 途中で null になった後の段は辿らない
    expect(resolveNodePath(root, [3, 0, 0])).toBeNull();
  });

  it('テキストやコメントも1つの子として数えること', () => {
    const root = document.createElement('div');
    root.innerHTML = 'a<!--c--><b>x</b>';
    expect(resolveNodePath(root, [0])?.nodeType).toBe(Node.TEXT_NODE);
    expect(resolveNodePath(root, [1])?.nodeType).toBe(Node.COMMENT_NODE);
    expect(resolveNodePath(root, [2, 0])?.textContent).toBe('x');
  });
});
