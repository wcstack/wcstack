import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListIndexes } from '../src/list/createListIndexes';
import { setListIndexesByList } from '../src/list/listIndexesByList';
import { setStateElementByName } from '../src/stateElementByName';
import { getPathInfo } from '../src/address/PathInfo';
import { createLoopContextStack } from '../src/list/loopContext';
import type { IStateElement } from '../src/components/types';
import type { IBindingInfo } from '../src/types';

const uuid = 'test-uuid';

function createMockStateElement(): IStateElement {
  const bindingInfosByPath = new Map<string, IBindingInfo[]>();
  const listPaths = new Set<string>();
  const state: any = {
    items: [],
    $stack: (_listIndex: any, callback: () => any) => callback(),
  };

  return {
    name: 'default',
    state,
    bindingInfosByPath,
    initializePromise: Promise.resolve(),
    listPaths,
    loopContextStack: createLoopContextStack(),
    addBindingInfo(bindingInfo: IBindingInfo) {
      const list = bindingInfosByPath.get(bindingInfo.statePathName) || [];
      list.push(bindingInfo);
      bindingInfosByPath.set(bindingInfo.statePathName, list);
    },
    deleteBindingInfo(bindingInfo: IBindingInfo) {
      const list = bindingInfosByPath.get(bindingInfo.statePathName) || [];
      const index = list.indexOf(bindingInfo);
      if (index !== -1) {
        list.splice(index, 1);
      }
      if (list.length === 0) {
        bindingInfosByPath.delete(bindingInfo.statePathName);
      }
    }
  };
}

function createFragmentInfo() {
  const fragment = document.createDocumentFragment();
  const span = document.createElement('span');
  span.textContent = 'item';
  fragment.appendChild(span);

  const parseBindTextResult: ParseBindTextResult = {
    propName: 'for',
    propSegments: [],
    propModifiers: [],
    statePathName: 'items',
    statePathInfo: getPathInfo('items'),
    stateName: 'default',
    filterTexts: [],
    bindingType: 'for',
    uuid
  };

  return {
    fragment,
    parseBindTextResult,
    nodeInfos: []
  };
}

afterEach(() => {
  setFragmentInfoByUUID(uuid, null);
  setStateElementByName('default', null);
});

describe('applyChangeToFor', () => {
  it('fragmentInfoが存在しない場合はエラーになること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const placeholder = document.createComment('for');
    expect(() => applyChangeToFor(placeholder, uuid, [])).toThrow(/Fragment with UUID/);
  });

  it('stateElementが存在しない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    setFragmentInfoByUUID(uuid, createFragmentInfo());

    expect(() => applyChangeToFor(placeholder, uuid, [])).toThrow(/State element with name/);
  });

  it('リストに応じてコンテンツを生成すること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());

    const list = [1, 2];
    const listIndexes = createListIndexes(list, null);
    setListIndexesByList(list, listIndexes);

    applyChangeToFor(placeholder, uuid, list);

    // コメントノード + 2つのspan
    expect(container.childNodes.length).toBe(3);
    expect(container.childNodes[1].nodeName).toBe('SPAN');
    expect(container.childNodes[2].nodeName).toBe('SPAN');

    // 後片付け
    setListIndexesByList(list, null);
  });

  it('再適用時に以前のコンテンツをアンマウントすること', () => {
    const stateElement = createMockStateElement();
    setStateElementByName('default', stateElement);

    const container = document.createElement('div');
    const placeholder = document.createComment('for');
    container.appendChild(placeholder);

    setFragmentInfoByUUID(uuid, createFragmentInfo());

    const list = [1, 2];
    const listIndexes = createListIndexes(list, null);
    setListIndexesByList(list, listIndexes);

    applyChangeToFor(placeholder, uuid, list);
    expect(container.childNodes.length).toBe(3);

    // 次の更新は空配列
    applyChangeToFor(placeholder, uuid, []);
    expect(container.childNodes.length).toBe(1);

    // 後片付け
    setListIndexesByList(list, null);
  });
});
