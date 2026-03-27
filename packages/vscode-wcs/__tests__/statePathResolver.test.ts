import { describe, it, expect } from 'vitest';
import { getStatePathsFromHtml } from '../src/service/statePathResolver';

describe('getStatePathsFromHtml', () => {
  describe('inner <script type="module">（既存動作）', () => {
    it('インナースクリプトからパスを解決する', () => {
      const html = `<wcs-state>
  <script type="module">
export default { count: 0, name: "test" };
  </script>
</wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(pathNames).toContain('name');
    });
  });

  describe('json 属性', () => {
    it('json 属性からパスを解決する', () => {
      const html = `<wcs-state json='{"count": 0, "name": "test"}'></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(pathNames).toContain('name');
    });

    it('json 属性で配列のワイルドカードパスが生成される', () => {
      const html = `<wcs-state json='{"users": [{"name": "Alice"}]}'></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('users');
      expect(pathNames).toContain('users.*');
      expect(pathNames).toContain('users.*.name');
    });

    it('json 属性で name 属性の stateName が設定される', () => {
      const html = `<wcs-state name="cart" json='{"items": []}'></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      expect(paths[0].stateName).toBe('cart');
    });
  });

  describe('state 属性', () => {
    it('state 属性で参照された <script type="application/json"> からパスを解決する', () => {
      const html = `
<script type="application/json" id="my-state">
  { "count": 0, "items": [{ "name": "item1" }] }
</script>
<wcs-state state="my-state"></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(pathNames).toContain('items');
      expect(pathNames).toContain('items.*');
      expect(pathNames).toContain('items.*.name');
    });

    it('参照先が存在しない場合はフォールバックする', () => {
      const html = `<wcs-state state="nonexistent" json='{"fallback": true}'></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      expect(paths.map(p => p.path)).toContain('fallback');
    });
  });

  describe('src 属性 (.json)', () => {
    it('fileReader 経由で外部 JSON ファイルからパスを解決する', () => {
      const html = `<wcs-state src="./data.json"></wcs-state>`;
      const fileReader = (path: string) => {
        if (path === './data.json') return '{"count": 0, "label": "hello"}';
        return undefined;
      };
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(pathNames).toContain('label');
    });

    it('fileReader が undefined を返した場合はフォールバックする', () => {
      const html = `<wcs-state src="./missing.json" json='{"fallback": true}'></wcs-state>`;
      const fileReader = () => undefined;
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      expect(paths.map(p => p.path)).toContain('fallback');
    });

    it('fileReader が未指定の場合は src をスキップする', () => {
      const html = `<wcs-state src="./data.json" json='{"fallback": true}'></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      expect(paths.map(p => p.path)).toContain('fallback');
    });
  });

  describe('src 属性 (.js)', () => {
    it('外部 JS ファイルの export default からパスを解決する', () => {
      const html = `<wcs-state src="./state.js"></wcs-state>`;
      const fileReader = (path: string) => {
        if (path === './state.js') return `export default { count: 0, name: "test" };`;
        return undefined;
      };
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(pathNames).toContain('name');
    });

    it('メソッドや getter を含む JS ファイルを解析する', () => {
      const html = `<wcs-state src="./state.js"></wcs-state>`;
      const fileReader = (path: string) => {
        if (path === './state.js') return `export default {
  count: 0,
  users: [{ name: "Alice", age: 30 }],
  increment() { this.count++; },
  get "users.*.label"() { return "x"; },
};`;
        return undefined;
      };
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(pathNames).toContain('users');
      expect(pathNames).toContain('users.*');
      expect(pathNames).toContain('users.*.name');
      expect(paths.find(p => p.path === 'increment')?.kind).toBe('method');
      expect(paths.find(p => p.path === 'users.*.label')?.kind).toBe('computed');
    });

    it('.ts ファイルが存在する場合は .js より .ts を優先する', () => {
      const html = `<wcs-state src="./state.js"></wcs-state>`;
      const fileReader = (path: string) => {
        if (path === './state.ts') return `export default { fromTs: true };`;
        if (path === './state.js') return `export default { fromJs: true };`;
        return undefined;
      };
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('fromTs');
      expect(pathNames).not.toContain('fromJs');
    });

    it('.ts ファイルが存在しない場合は .js にフォールバックする', () => {
      const html = `<wcs-state src="./state.js"></wcs-state>`;
      const fileReader = (path: string) => {
        if (path === './state.js') return `export default { fromJs: true };`;
        return undefined;
      };
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      expect(paths.map(p => p.path)).toContain('fromJs');
    });

    it('fileReader が未指定の場合は .js をスキップする', () => {
      const html = `<wcs-state src="./state.js" json='{"fallback": true}'></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      expect(paths.map(p => p.path)).toContain('fallback');
    });
  });

  describe('src 属性 (.ts)', () => {
    it('外部 TS ファイルの export default からパスを解決する', () => {
      const html = `<wcs-state src="./state.ts"></wcs-state>`;
      const fileReader = (path: string) => {
        if (path === './state.ts') return `export default { count: 0, label: "hello" };`;
        return undefined;
      };
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(pathNames).toContain('label');
    });

    it('defineState でラップされた TS ファイルを解析する', () => {
      const html = `<wcs-state src="./state.ts"></wcs-state>`;
      const fileReader = (path: string) => {
        if (path === './state.ts') return `import { defineState } from '@wcstack/state';
export default defineState({
  count: 0,
  increment() { this.count++; },
});`;
        return undefined;
      };
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('count');
      expect(paths.find(p => p.path === 'increment')?.kind).toBe('method');
    });

    it('fileReader が undefined を返した場合はフォールバックする', () => {
      const html = `<wcs-state src="./missing.ts" json='{"fallback": true}'></wcs-state>`;
      const fileReader = () => undefined;
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      expect(paths.map(p => p.path)).toContain('fallback');
    });
  });

  describe('優先順位', () => {
    it('state 属性が json 属性より優先される', () => {
      const html = `
<script type="application/json" id="s">{ "fromState": true }</script>
<wcs-state state="s" json='{"fromJson": true}'></wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('fromState');
      expect(pathNames).not.toContain('fromJson');
    });

    it('src 属性が json 属性より優先される', () => {
      const html = `<wcs-state src="./data.json" json='{"fromJson": true}'></wcs-state>`;
      const fileReader = () => '{"fromSrc": true}';
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('fromSrc');
      expect(pathNames).not.toContain('fromJson');
    });

    it('json 属性がインナースクリプトより優先される', () => {
      const html = `<wcs-state json='{"fromJson": true}'>
  <script type="module">export default { fromScript: true };</script>
</wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      const pathNames = paths.map(p => p.path);
      expect(pathNames).toContain('fromJson');
      expect(pathNames).not.toContain('fromScript');
    });

    it('state → src → json → script の完全な優先順位', () => {
      const html = `
<script type="application/json" id="s">{ "winner": "state" }</script>
<wcs-state state="s" src="./data.json" json='{"winner": "json"}'>
  <script type="module">export default { winner: "script" };</script>
</wcs-state>`;
      const fileReader = () => '{"winner": "src"}';
      const paths = getStatePathsFromHtml(html, 'wcs-state', fileReader);
      expect(paths.find(p => p.path === 'winner')?.typeHint).toBe('string');
      // state 属性が最優先
      expect(paths).toHaveLength(1);
    });
  });

  describe('複数の <wcs-state>', () => {
    it('異なる初期化方法の複数 state を同時に解析する', () => {
      const html = `
<script type="application/json" id="s1">{ "a": 1 }</script>
<wcs-state name="first" state="s1"></wcs-state>
<wcs-state name="second" json='{"b": 2}'></wcs-state>
<wcs-state name="third">
  <script type="module">export default { c: 3 };</script>
</wcs-state>`;
      const paths = getStatePathsFromHtml(html);
      expect(paths.find(p => p.path === 'a')?.stateName).toBe('first');
      expect(paths.find(p => p.path === 'b')?.stateName).toBe('second');
      expect(paths.find(p => p.path === 'c')?.stateName).toBe('third');
    });
  });
});
