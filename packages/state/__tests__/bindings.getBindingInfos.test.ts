import { describe, it, expect } from 'vitest';
import { getBindingInfos } from '../src/bindings/getBindingInfos';
import { parseBindTextForEmbeddedNode } from '../src/bindTextParser/parseBindTextForEmbeddedNode';
import { parseBindTextsForElement } from '../src/bindTextParser/parseBindTextsForElement';


describe('getBindingInfos', () => {
  it('textバインディングの場合はプレースホルダーがTextになること', () => {
    const comment = document.createComment('@@wcs-text: message');
    const parseResult = parseBindTextForEmbeddedNode('message');
    const bindingInfos = getBindingInfos(comment, [parseResult]);

    expect(bindingInfos).toHaveLength(1);
    expect(bindingInfos[0].bindingType).toBe('text');
    expect(bindingInfos[0].node).toBe(comment);
    expect(bindingInfos[0].placeHolderNode).not.toBe(comment);
    expect(bindingInfos[0].placeHolderNode.nodeType).toBe(Node.TEXT_NODE);
  });

  it('propバインディングの場合はplaceHolderNodeが要素になること', () => {
    const el = document.createElement('span');
    const parseResult = parseBindTextsForElement('textContent: message')[0];
    const bindingInfos = getBindingInfos(el, [parseResult]);

    expect(bindingInfos).toHaveLength(1);
    expect(bindingInfos[0].bindingType).toBe('prop');
    expect(bindingInfos[0].node).toBe(el);
    expect(bindingInfos[0].placeHolderNode).toBe(el);
  });
});
