import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectStructuralFragments } from '../src/structural/collectStructuralFragments';
import { getFragmentInfoByUUID, setFragmentInfoByUUID } from '../src/structural/fragmentInfoByUUID';
import { config } from '../src/config';

vi.mock('../src/getUUID', () => ({
  getUUID: () => 'uuid-collect'
}));

describe('collectStructuralFragments', () => {
  afterEach(() => {
    setFragmentInfoByUUID('uuid-collect', null);
    document.body.innerHTML = '';
  });

  it('templateをコメントに置換しfragmentInfoを登録すること', () => {
    const root = document.createElement('div');
    const template = document.createElement('template');
    template.setAttribute(config.bindAttributeName, 'for: items');

    const inner = document.createElement('span');
    inner.setAttribute(config.bindAttributeName, 'textContent: message');
    template.content.appendChild(inner);

    root.appendChild(template);

    collectStructuralFragments(root);

    const first = root.firstChild as Comment;
    expect(first.nodeType).toBe(Node.COMMENT_NODE);
    expect(first.data).toBe(`@@${config.commentForPrefix}:uuid-collect`);

    const info = getFragmentInfoByUUID('uuid-collect');
    expect(info).not.toBeNull();
    expect(info?.parseBindTextResult.bindingType).toBe('for');
    expect(info?.nodeInfos.length).toBe(1);
  });
});
