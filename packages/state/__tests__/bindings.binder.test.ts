import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BINDER_KEY, getBinder, bindSubtree, wasBoundBy, flushPendingBinds } from '../src/protocol/binder';
import { registerBinder, _unregisterBinder } from '../src/bindings/binder';

// binder プロトコル（docs/binder-protocol-design.md）。
// state がバインドを構築した時点で document に居なかったノードは、そのままでは
// 永久にバインドされない。`bind()` はそれを 1 サブツリー分だけ埋める。
describe('binder protocol', () => {
  const globals = globalThis as Record<symbol, unknown>;

  beforeEach(() => {
    _unregisterBinder();
    delete globals[Symbol.for('wcstack.binder.pending')];
    delete globals[Symbol.for('wcstack.binder.taken')];
  });

  afterEach(() => {
    _unregisterBinder();
    delete globals[Symbol.for('wcstack.binder.pending')];
    delete globals[Symbol.for('wcstack.binder.taken')];
  });

  describe('発見', () => {
    it('未登録なら null を返すこと', () => {
      expect(getBinder()).toBeNull();
    });

    it('登録すると見つかること', () => {
      registerBinder();
      expect(getBinder()?.protocol).toBe('wcs-binder');
    });

    it('登録は冪等で、先客を追い出さないこと', () => {
      const other = { protocol: 'wcs-binder', version: 1, bind: () => undefined };
      globals[BINDER_KEY] = other;
      registerBinder();
      expect(globals[BINDER_KEY]).toBe(other);
    });

    it('プロトコル名が違うものは採らないこと', () => {
      globals[BINDER_KEY] = { protocol: 'something-else', version: 1, bind: () => undefined };
      expect(getBinder()).toBeNull();
      delete globals[BINDER_KEY];
    });

    it('version が 1 未満のものは採らないこと', () => {
      globals[BINDER_KEY] = { protocol: 'wcs-binder', version: 0, bind: () => undefined };
      expect(getBinder()).toBeNull();
      delete globals[BINDER_KEY];
    });

    it('bind を持たないものは採らないこと', () => {
      globals[BINDER_KEY] = { protocol: 'wcs-binder', version: 1 };
      expect(getBinder()).toBeNull();
      delete globals[BINDER_KEY];
    });
  });

  describe('保留キュー', () => {
    // router の auto バンドルは state のものより先に走るので、`<wcs-head>` は
    // binder が居ない時点でクローンを差し出す。捨てずに預かる必要がある。
    it('binder が居なければ預かり、false を返すこと', () => {
      const node = document.createElement('div');
      expect(bindSubtree(node)).toBe(false);
      expect(wasBoundBy(node)).toBe(false);
    });

    it('binder が現れたら預かった分を引き取ること', () => {
      const taken: Node[] = [];
      const node = document.createElement('div');
      bindSubtree(node);

      globals[BINDER_KEY] = {
        protocol: 'wcs-binder',
        version: 1,
        bind: (subtree: Node) => { taken.push(subtree); },
      };
      flushPendingBinds();

      expect(taken).toEqual([node]);
      expect(wasBoundBy(node)).toBe(true);
      delete globals[BINDER_KEY];
    });

    it('引き取りは一度きりで、二度目は何も起きないこと', () => {
      const taken: Node[] = [];
      bindSubtree(document.createElement('div'));
      globals[BINDER_KEY] = {
        protocol: 'wcs-binder',
        version: 1,
        bind: (subtree: Node) => { taken.push(subtree); },
      };
      flushPendingBinds();
      flushPendingBinds();
      expect(taken).toHaveLength(1);
      delete globals[BINDER_KEY];
    });

    it('binder が居なければ引き取りは何もしないこと', () => {
      bindSubtree(document.createElement('div'));
      expect(() => flushPendingBinds()).not.toThrow();
    });

    it('binder が居るなら即座に渡し、true を返すこと', () => {
      const taken: Node[] = [];
      globals[BINDER_KEY] = {
        protocol: 'wcs-binder',
        version: 1,
        bind: (subtree: Node) => { taken.push(subtree); },
      };
      const node = document.createElement('div');
      expect(bindSubtree(node)).toBe(true);
      expect(taken).toEqual([node]);
      expect(wasBoundBy(node)).toBe(true);
      delete globals[BINDER_KEY];
    });
  });

  describe('bind の入口', () => {
    it('要素以外は無視すること', () => {
      registerBinder();
      expect(() => getBinder()?.bind(document.createTextNode('x'))).not.toThrow();
    });

    it('既にバインド済みのサブツリー（自身が台帳に居る）は二度バインドしないこと', async () => {
      const { bootstrapState } = await import('../src/bootstrapState');
      const { State } = await import('../src/components/State');
      bootstrapState();
      registerBinder();

      const host = document.createElement('binder-rebind-host');
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML =
        `<wcs-state json='{"msg":"m1"}'></wcs-state><div id="late"></div>`;
      document.body.appendChild(host);
      await (shadowRoot.querySelector('wcs-state') as InstanceType<typeof State>).connectedCallbackPromise;
      await State.getBindingsReady(shadowRoot);

      // 後入れのサブツリー（ルート自身が data-wcs を持つ）を binder で 1 回バインド
      const late = document.createElement('span');
      late.setAttribute('data-wcs', 'textContent: msg');
      shadowRoot.querySelector('#late')!.appendChild(late);
      getBinder()?.bind(late);
      await new Promise((r) => setTimeout(r));
      expect(late.textContent).toBe('m1');

      // 2 回目は alreadyBound（要素自身が台帳に居る）で即戻る
      expect(() => getBinder()?.bind(late)).not.toThrow();

      // ルートが属性を持たず、バインド済みの子孫を含む形も既バインド扱い
      const wrap = document.createElement('div');
      shadowRoot.querySelector('#late')!.appendChild(wrap);
      wrap.appendChild(late);
      expect(() => getBinder()?.bind(wrap)).not.toThrow();
      expect(late.textContent).toBe('m1');

      host.remove();
    });

    it('宣言を持たないサブツリーは何も起こさないこと', () => {
      registerBinder();
      const node = document.createElement('div');
      node.innerHTML = '<p>static</p>';
      document.body.appendChild(node);
      expect(() => getBinder()?.bind(node)).not.toThrow();
      node.remove();
    });
  });
});
