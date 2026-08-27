import { describe, it, expect, afterEach } from 'vitest';
import { applyA11yPolicies } from '../src/a11yPolicies';
import type { IRoute, IRouteMatchResult, IRouter } from '../src/components/types';
import './setup';

function stubRouter(
  overrides: Partial<Pick<IRouter, 'announcePolicy' | 'focusPolicy' | 'a11yRegion'>> = {}
): IRouter {
  return {
    announcePolicy: null,
    focusPolicy: null,
    a11yRegion: null,
    ...overrides,
  } as unknown as IRouter;
}

function matchResultOf(nodes: Node[]): IRouteMatchResult {
  return {
    routes: [{ childNodeArray: nodes } as unknown as IRoute],
    params: {},
    typedParams: {},
    path: '/x',
    lastPath: '/',
  };
}

describe('applyA11yPolicies', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.title = '';
  });

  describe('announce="title" (D2)', () => {
    it('announcePolicy が "title" のとき live region へ document.title のスナップショットを書き込むこと', () => {
      const region = document.createElement('div');
      document.title = 'New Page';
      const router = stubRouter({ announcePolicy: 'title', a11yRegion: region });

      applyA11yPolicies(router, matchResultOf([]));

      expect(region.textContent).toBe('New Page');
    });

    it('announcePolicy が無いときは live region に書き込まないこと', () => {
      const region = document.createElement('div');
      document.title = 'New Page';

      applyA11yPolicies(stubRouter({ a11yRegion: region }), matchResultOf([]));

      expect(region.textContent).toBe('');
    });

    it('live region が無くても throw しないこと', () => {
      const router = stubRouter({ announcePolicy: 'title', a11yRegion: null });
      expect(() => applyA11yPolicies(router, matchResultOf([]))).not.toThrow();
    });
  });

  describe('focus="heading" (D1)', () => {
    it('トップレベルの見出しに tabindex="-1" を付けてフォーカスすること', () => {
      const h1 = document.createElement('h1');
      document.body.appendChild(h1);

      applyA11yPolicies(stubRouter({ focusPolicy: 'heading' }), matchResultOf([h1]));

      expect(h1.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(h1);
    });

    it('入れ子の見出しも document order で最初のものを選ぶこと', () => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<p>lead</p><section><h2 id="target">head</h2><h3>later</h3></section>';
      document.body.appendChild(wrapper);

      applyA11yPolicies(stubRouter({ focusPolicy: 'heading' }), matchResultOf([wrapper]));

      expect(document.activeElement).toBe(wrapper.querySelector('#target'));
    });

    it('テキストノードをスキップし、自身が見出しである要素を選ぶこと', () => {
      const text = document.createTextNode('hello');
      const h2 = document.createElement('h2');
      document.body.append(text, h2);

      applyA11yPolicies(stubRouter({ focusPolicy: 'heading' }), matchResultOf([text, h2]));

      expect(document.activeElement).toBe(h2);
    });

    it('リーフ route に見出しが無ければ何もしないこと（§3-4 の規定）', () => {
      const div = document.createElement('div');
      div.innerHTML = '<p>no headings</p>';
      const outside = document.createElement('button');
      document.body.append(div, outside);
      outside.focus();

      applyA11yPolicies(stubRouter({ focusPolicy: 'heading' }), matchResultOf([div]));

      expect(document.activeElement).toBe(outside);
    });

    it('既存の tabindex を上書きしないこと', () => {
      const h1 = document.createElement('h1');
      h1.setAttribute('tabindex', '0');
      document.body.appendChild(h1);

      applyA11yPolicies(stubRouter({ focusPolicy: 'heading' }), matchResultOf([h1]));

      expect(h1.getAttribute('tabindex')).toBe('0');
      expect(document.activeElement).toBe(h1);
    });

    it('focusPolicy が無いときはフォーカスも tabindex 付与もしないこと', () => {
      const h1 = document.createElement('h1');
      document.body.appendChild(h1);

      applyA11yPolicies(stubRouter(), matchResultOf([h1]));

      expect(h1.hasAttribute('tabindex')).toBe(false);
    });

    it('リーフ（routes 末尾）の内容だけを探索し、祖先 route の見出しへは遡らないこと', () => {
      const parentHeading = document.createElement('h1');
      const leafDiv = document.createElement('div');
      leafDiv.innerHTML = '<p>leaf has no heading</p>';
      const outside = document.createElement('button');
      document.body.append(parentHeading, leafDiv, outside);
      outside.focus();

      const matchResult: IRouteMatchResult = {
        routes: [
          { childNodeArray: [parentHeading] } as unknown as IRoute,
          { childNodeArray: [leafDiv] } as unknown as IRoute,
        ],
        params: {},
        typedParams: {},
        path: '/x/y',
        lastPath: '/',
      };

      applyA11yPolicies(stubRouter({ focusPolicy: 'heading' }), matchResult);

      // 祖先の h1 は選ばれない
      expect(document.activeElement).toBe(outside);
      expect(parentHeading.hasAttribute('tabindex')).toBe(false);
    });
  });
});
