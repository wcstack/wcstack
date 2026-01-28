import { describe, it, expect } from 'vitest';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';
import { config } from '../src/config';


describe('getFragmentNodeInfos', () => {
  it('fragment内の購読ノードを収集できること', () => {
    const fragment = document.createDocumentFragment();

    const boundEl = document.createElement('span');
    boundEl.setAttribute(config.bindAttributeName, 'textContent: message');

    const comment = document.createComment('@@wcs-text: message');

    fragment.appendChild(boundEl);
    fragment.appendChild(comment);

    const infos = getFragmentNodeInfos(fragment);
    expect(infos.length).toBe(2);
    expect(infos[0].nodePath.length).toBeGreaterThan(0);
    expect(infos[0].parseBindTextResults.length).toBeGreaterThan(0);
  });
});
