import { describe, it, expect } from 'vitest';
import { collectNodesAndBindingInfos, collectNodesAndBindingInfosByFragment, unregisterNode } from '../src/bindings/collectNodesAndBindingInfos';
import { config } from '../src/config';
import { getFragmentNodeInfos } from '../src/structural/getFragmentNodeInfos';


describe('collectNodesAndBindingInfos', () => {
  it('購読ノードとバインディング情報を収集できること', () => {
    const fragment = document.createDocumentFragment();

    const boundEl = document.createElement('div');
    boundEl.setAttribute(config.bindAttributeName, 'textContent: message');

    const comment = document.createComment('@@wcs-text: message');

    fragment.appendChild(boundEl);
    fragment.appendChild(comment);

    const [nodes, bindings] = collectNodesAndBindingInfos(fragment);
    expect(nodes).toHaveLength(2);
    expect(bindings).toHaveLength(2);

    // 2回目は登録済みのためbindingsは空
    const [, bindings2] = collectNodesAndBindingInfos(fragment);
    expect(bindings2).toHaveLength(0);

    // 登録解除後は再取得できる
    unregisterNode(boundEl);
    unregisterNode(comment);
    const [, bindings3] = collectNodesAndBindingInfos(fragment);
    expect(bindings3).toHaveLength(2);
  });

  it('fragmentからノードとバインディング情報を収集できること', () => {
    const fragment = document.createDocumentFragment();

    const boundEl = document.createElement('div');
    boundEl.setAttribute(config.bindAttributeName, 'textContent: message');

    const comment = document.createComment('@@wcs-text: message');

    fragment.appendChild(boundEl);
    fragment.appendChild(comment);

    const nodeInfos = getFragmentNodeInfos(fragment);
    const [nodes, bindings] = collectNodesAndBindingInfosByFragment(fragment, nodeInfos);
    expect(nodes).toHaveLength(2);
    expect(bindings).toHaveLength(2);

    const [, bindings2] = collectNodesAndBindingInfosByFragment(fragment, nodeInfos);
    expect(bindings2).toHaveLength(0);

    unregisterNode(boundEl);
    unregisterNode(comment);
    const [, bindings3] = collectNodesAndBindingInfosByFragment(fragment, nodeInfos);
    expect(bindings3).toHaveLength(2);
  });

  it('fragment内にノードが見つからない場合はエラーになること', () => {
    const fragment = document.createDocumentFragment();
    const boundEl = document.createElement('div');
    boundEl.setAttribute(config.bindAttributeName, 'textContent: message');
    fragment.appendChild(boundEl);

    const nodeInfos = getFragmentNodeInfos(fragment);
    const brokenNodeInfos = [{
      nodePath: [999],
      parseBindTextResults: nodeInfos[0]!.parseBindTextResults,
    }];

    expect(() => collectNodesAndBindingInfosByFragment(fragment, brokenNodeInfos)).toThrow(/Node not found/);

    unregisterNode(boundEl);
  });
});
