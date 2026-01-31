import { describe, it, expect } from 'vitest';
import { createContent } from '../src/structural/createContent';

describe('createContent', () => {
  it('mountAfterでノードを挿入できること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    const span2 = document.createElement('span');
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    const content = createContent(fragment);
    content.mountAfter(placeholder);

    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1]).toBe(span1);
    expect(container.childNodes[2]).toBe(span2);
  });

  it('unmountでノードを削除できること', () => {
    const container = document.createElement('div');
    const placeholder = document.createComment('placeholder');
    container.appendChild(placeholder);

    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    const content = createContent(fragment);
    content.mountAfter(placeholder);
    expect(container.childNodes.length).toBe(2);

    content.unmount();
    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0]).toBe(placeholder);

    content.unmount();
    expect(container.childNodes.length).toBe(1);
  });

  it('firstNode/lastNode が取得できること', () => {
    const fragment = document.createDocumentFragment();
    const span1 = document.createElement('span');
    const span2 = document.createElement('span');
    fragment.appendChild(span1);
    fragment.appendChild(span2);

    const content = createContent(fragment);
    expect(content.firstNode).toBe(span1);
    expect(content.lastNode).toBe(span2);
  });

  it('空のfragmentではfirstNode/lastNodeがnullになること', () => {
    const fragment = document.createDocumentFragment();
    const content = createContent(fragment);
    expect(content.firstNode).toBeNull();
    expect(content.lastNode).toBeNull();
  });

  it('mountAfterで親が無い場合は何もしないこと', () => {
    const placeholder = document.createComment('placeholder');
    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    const content = createContent(fragment);
    content.mountAfter(placeholder);

    expect(span.parentNode).toBe(fragment);
  });
});
