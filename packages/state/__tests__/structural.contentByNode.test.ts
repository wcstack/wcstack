import { describe, it, expect } from 'vitest';
import { setContentByNode, getContentByNode } from '../src/structural/contentByNode';
import { createContent } from '../src/structural/createContent';

describe('contentByNode', () => {
  it('set/getできること', () => {
    const node = document.createElement('div');
    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    const content = createContent(fragment);
    setContentByNode(node, content);

    expect(getContentByNode(node)).toBe(content);
  });

  it('nullで削除できること', () => {
    const node = document.createElement('div');
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createElement('span'));
    const content = createContent(fragment);

    setContentByNode(node, content);
    setContentByNode(node, null);

    expect(getContentByNode(node)).toBeNull();
  });
});
