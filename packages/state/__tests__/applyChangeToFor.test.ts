import { describe, it, expect, afterEach } from 'vitest';
import { applyChangeToFor } from '../src/apply/applyChangeToFor';
import { setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import type { ParseBindTextResult } from '../src/bindTextParser/types';
import { createListIndexes } from '../src/list/createListIndexes';
import { setListIndexesByList } from '../src/list/listIndexesByList';

const uuid = 'test-uuid';

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
    statePathInfo: null,
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
});

describe('applyChangeToFor', () => {
  it('fragmentInfoが存在しない場合はエラーになること', () => {
    const placeholder = document.createComment('for');
    expect(() => applyChangeToFor(placeholder, uuid, [])).toThrow(/Fragment with UUID/);
  });

  it('リストに応じてコンテンツを生成すること', () => {
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
