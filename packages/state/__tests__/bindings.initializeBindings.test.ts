import { describe, it, expect, afterEach } from 'vitest';
import { initializeBindings } from '../src/bindings/initializeBindings';
import { setStateElementByName } from '../src/stateElementByName';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';

function createMockStateElement(): IStateElement {
  const bindingInfosByPath = new Map<string, IBindingInfo[]>();
  const listPaths = new Set<string>();
  const state: any = {
    message: 'hello',
    $stack: (_listIndex: any, callback: () => any) => callback(),
  };

  return {
    name: 'default',
    state,
    bindingInfosByPath,
    initializePromise: Promise.resolve(),
    listPaths,
    addBindingInfo(bindingInfo: IBindingInfo) {
      const list = bindingInfosByPath.get(bindingInfo.statePathName) || [];
      list.push(bindingInfo);
      bindingInfosByPath.set(bindingInfo.statePathName, list);
    }
  };
}

describe('initializeBindings', () => {
  afterEach(() => {
    setStateElementByName('default', null);
  });

  it('コメントノードのtextバインディングを初期化できること', async () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const comment = document.createComment('@@wcs-text: message');
    container.appendChild(comment);

    await initializeBindings(container, null);

    expect(container.childNodes.length).toBe(1);
    expect(container.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(container.childNodes[0].nodeValue).toBe('hello');

    const bindingInfos = stateElement.bindingInfosByPath.get('message') || [];
    expect(bindingInfos.length).toBe(1);
  });
});
