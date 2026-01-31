import { describe, it, expect } from 'vitest';
import { getSubscriberNodes } from '../src/bindings/getSubscriberNodes';
import { config } from '../src/config';

describe('getSubscriberNodes', () => {
  it('data-bind-state属性とコメントノードを取得できること', () => {
    const fragment = document.createDocumentFragment();

    const boundEl = document.createElement('div');
    boundEl.setAttribute(config.bindAttributeName, 'textContent: message');

    const normalEl = document.createElement('span');

    const comment = document.createComment('@@wcs-text: message');

    fragment.appendChild(boundEl);
    fragment.appendChild(normalEl);
    fragment.appendChild(comment);

    const nodes = getSubscriberNodes(fragment);
    expect(nodes).toHaveLength(2);
    expect(nodes).toContain(boundEl);
    expect(nodes).toContain(comment);
  });

  it('バインドがない要素やコメントは除外されること', () => {
    const fragment = document.createDocumentFragment();

    const normalEl = document.createElement('span');
    const invalidComment = document.createComment('not a binding');

    fragment.appendChild(normalEl);
    fragment.appendChild(invalidComment);

    const nodes = getSubscriberNodes(fragment);
    expect(nodes).toHaveLength(0);
  });
});
