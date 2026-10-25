import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import './setup';
import { bootstrapState } from '../../state/src/exports';
import { engines } from '../../state/src/dom/mount';
import { _resetHeadStack } from '../src/components/Head';
import { settle } from './routeRange.state.shared';
import type { Router } from '../src/components/Router';

beforeAll(() => {
  bootstrapState();
  const base = document.createElement('base');
  base.setAttribute('href', '/');
  document.head.appendChild(base);
});
afterEach(() => {
  engines.delete(document);
  document.body.innerHTML = '';
  document.head.querySelectorAll('title, meta[name="description"]').forEach((n) => n.remove());
  _resetHeadStack();
});

const PAGE = `<wcs-state></wcs-state>
<wcs-router><template>
  <wcs-route path="/t/:id"><wcs-head><title data-wcs="textContent: title"></title><meta name="description" data-wcs="attr.content: title"></wcs-head><h2>t</h2></wcs-route>
  <wcs-route path="/other"><h2>other</h2></wcs-route>
</template></wcs-router>`;

describe('<wcs-head> の束ねた子と @wcstack/state（docs/seam-apps.md、shift-desk）', () => {
  it('遷移のたびに新しいクローンを束ねず、同じクローンを入れ直す — 値は state に追従する', async () => {
    history.replaceState(null, '', '/t/1');
    document.body.innerHTML = PAGE;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
    try {
      await settle();
      const el = document.querySelector('wcs-state') as any;
      el.setInitialState({ title: 'one' });
      await el.connectedCallbackPromise;
      await settle();
      const title = document.head.querySelector('title');
      const meta = document.head.querySelector('meta[name="description"]');
      expect(document.title).toBe('one');
      expect(meta?.getAttribute('content')).toBe('one');

      const router = document.querySelector('wcs-router') as Router;
      // a parameter-only navigation puts the same route content back: the same clones go back in
      for (const id of [2, 3, 4]) {
        await router.navigate(`/t/${id}`);
        await settle();
        expect(document.head.querySelector('title')).toBe(title);
        expect(document.head.querySelector('meta[name="description"]')).toBe(meta);
      }
      // away and back: the bound clone returns, with what the state wrote while it was out
      await router.navigate('/other');
      await settle();
      expect(document.head.querySelector('title')).not.toBe(title);
      el.createState('writable', (s: any) => { s.title = 'two'; });
      await router.navigate('/t/5');
      await settle();
      expect(document.head.querySelector('title')).toBe(title);
      expect(document.title).toBe('two');
      expect(meta?.getAttribute('content')).toBe('two');
      expect(document.head.querySelectorAll('title').length).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});
