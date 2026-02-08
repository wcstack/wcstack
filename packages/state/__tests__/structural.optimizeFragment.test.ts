import { describe, it, expect } from 'vitest';
import { optimizeFragment } from '../src/structural/optimizeFragment';

describe('optimizeFragment', () => {
  it('空白のみのテキストノードが除去されること', () => {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('  '));
    fragment.appendChild(document.createTextNode('\n'));
    fragment.appendChild(document.createTextNode('\t'));

    expect(fragment.childNodes.length).toBe(3);

    optimizeFragment(fragment);

    expect(fragment.childNodes.length).toBe(0);
  });

  it('内容のあるテキストノードは保持されること', () => {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('hello'));
    fragment.appendChild(document.createTextNode(' world '));

    optimizeFragment(fragment);

    expect(fragment.childNodes.length).toBe(2);
    expect(fragment.childNodes[0].textContent).toBe('hello');
    expect(fragment.childNodes[1].textContent).toBe(' world ');
  });

  it('要素ノードは保持されること', () => {
    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    fragment.appendChild(span);

    optimizeFragment(fragment);

    expect(fragment.childNodes.length).toBe(1);
    expect(fragment.childNodes[0]).toBe(span);
  });

  it('空白テキストノードのみが除去され他のノードは保持されること', () => {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('\n  '));
    const span = document.createElement('span');
    fragment.appendChild(span);
    fragment.appendChild(document.createTextNode('  \t  '));
    fragment.appendChild(document.createTextNode('content'));
    fragment.appendChild(document.createTextNode('   '));

    expect(fragment.childNodes.length).toBe(5);

    optimizeFragment(fragment);

    expect(fragment.childNodes.length).toBe(2);
    expect(fragment.childNodes[0]).toBe(span);
    expect(fragment.childNodes[1].textContent).toBe('content');
  });

  it('空のフラグメントでもエラーにならないこと', () => {
    const fragment = document.createDocumentFragment();

    expect(() => optimizeFragment(fragment)).not.toThrow();
    expect(fragment.childNodes.length).toBe(0);
  });

  it('textContentがnullのテキストノードが除去されること', () => {
    const fragment = document.createDocumentFragment();
    const textNode = document.createTextNode('');
    Object.defineProperty(textNode, 'textContent', { get: () => null });
    fragment.appendChild(textNode);

    optimizeFragment(fragment);

    expect(fragment.childNodes.length).toBe(0);
  });

  it('コメントノードは保持されること', () => {
    const fragment = document.createDocumentFragment();
    const comment = document.createComment('test comment');
    fragment.appendChild(document.createTextNode('  '));
    fragment.appendChild(comment);

    optimizeFragment(fragment);

    expect(fragment.childNodes.length).toBe(1);
    expect(fragment.childNodes[0]).toBe(comment);
  });
});
