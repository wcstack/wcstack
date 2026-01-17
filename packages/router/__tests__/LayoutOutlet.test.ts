import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LayoutOutlet, createLayoutOutlet } from '../src/components/LayoutOutlet';
import { Layout } from '../src/components/Layout';
import { ILayout } from '../src/components/types';
import './setup';

describe('LayoutOutlet', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('LayoutOutletクラスが存在すること', () => {
    expect(LayoutOutlet).toBeDefined();
    expect(typeof LayoutOutlet).toBe('function');
  });

  it('HTMLElementを継承していること', () => {
    expect(Object.getPrototypeOf(LayoutOutlet.prototype)).toBe(HTMLElement.prototype);
  });

  it('インスタンスを作成できること', () => {
    const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
    expect(layoutOutlet).toBeInstanceOf(LayoutOutlet);
    expect(layoutOutlet).toBeInstanceOf(HTMLElement);
  });

  describe('createLayoutOutlet', () => {
    it('createLayoutOutlet関数でインスタンスを作成できること', () => {
      const layoutOutlet = createLayoutOutlet();
      expect(layoutOutlet).toBeInstanceOf(LayoutOutlet);
    });
  });

  describe('layout プロパティ', () => {
    it('layoutが設定されていない場合にエラーを投げること', () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      expect(() => layoutOutlet.layout).toThrow();
    });

    it('layoutを設定できること', () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const mockLayout: ILayout = {
        name: 'test-layout',
        uuid: 'test-uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(document.createElement('template')),
      } as any;

      layoutOutlet.layout = mockLayout;
      expect(layoutOutlet.layout).toBe(mockLayout);
      expect(layoutOutlet.getAttribute('name')).toBe('test-layout');
    });

    it('nameプロパティがlayout.nameを返すこと', () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const mockLayout: ILayout = {
        name: 'my-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(document.createElement('template')),
      } as any;

      layoutOutlet.layout = mockLayout;
      expect(layoutOutlet.name).toBe('my-layout');
    });
  });

  describe('connectedCallback と _initialize', () => {
    it('shadowRootが有効な場合にshadowRootを作成すること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<div>Shadow Content</div>';

      const mockLayout: ILayout = {
        name: 'shadow-layout',
        uuid: 'uuid',
        enableShadowRoot: true,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(layoutOutlet.shadowRoot).not.toBeNull();
      expect(layoutOutlet.shadowRoot?.innerHTML).toContain('Shadow Content');
    });

    it('shadowRootが無効な場合は通常のDOMとして追加されること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<div>Normal Content</div>';

      const mockLayout: ILayout = {
        name: 'normal-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(layoutOutlet.shadowRoot).toBeNull();
      expect(layoutOutlet.innerHTML).toContain('Normal Content');
    });

    it('shadowRoot使用時にlayout.childNodesを追加すること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<slot></slot>';

      const child1 = document.createElement('div');
      child1.textContent = 'Child 1';
      const child2 = document.createElement('div');
      child2.textContent = 'Child 2';

      const mockLayout: ILayout = {
        name: 'shadow-layout',
        uuid: 'uuid',
        enableShadowRoot: true,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [child1, child2],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(layoutOutlet.contains(child1)).toBe(true);
      expect(layoutOutlet.contains(child2)).toBe(true);
    });

    it('名前付きslotを正しく処理すること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<div><slot name="header"></slot><slot></slot></div>';

      const headerChild = document.createElement('div');
      headerChild.setAttribute('slot', 'header');
      headerChild.textContent = 'Header Content';

      const defaultChild = document.createElement('div');
      defaultChild.textContent = 'Default Content';

      const mockLayout: ILayout = {
        name: 'slot-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [headerChild, defaultChild],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      const content = layoutOutlet.innerHTML;
      expect(content).toContain('Header Content');
      expect(content).toContain('Default Content');
    });

    it('名前付きslotの最初の割り当てでfragmentを作成すること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<div><slot name="header"></slot><slot></slot></div>';

      const headerChild = document.createElement('div');
      headerChild.setAttribute('slot', 'header');
      headerChild.textContent = 'Header First';

      const mockLayout: ILayout = {
        name: 'slot-layout-first',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [headerChild],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(layoutOutlet.innerHTML).toContain('Header First');
    });

    it('同じslot名の複数要素を1つのfragmentに追加すること', async () => {
      const layout = document.createElement('wc-layout') as Layout;
      layout.setAttribute('name', 'multi-header');

      const template = document.createElement('template');
      template.innerHTML = '<div><slot name="header"></slot><slot></slot></div>';

      vi.spyOn(layout, 'loadTemplate').mockResolvedValue(template);
      layout.setAttribute('disable-shadow-root', '');

      const header1 = document.createElement('div');
      header1.setAttribute('slot', 'header');
      header1.textContent = 'Header A';

      const header2 = document.createElement('div');
      header2.setAttribute('slot', 'header');
      header2.textContent = 'Header B';

      layout.appendChild(header1);
      layout.appendChild(header2);

      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      layoutOutlet.layout = layout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      const content = layoutOutlet.innerHTML;
      expect(content).toContain('Header A');
      expect(content).toContain('Header B');
    });

    it('デフォルトslotに要素を配置すること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<div><slot></slot></div>';

      const child = document.createElement('p');
      child.textContent = 'Paragraph';

      const mockLayout: ILayout = {
        name: 'default-slot-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [child],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(layoutOutlet.innerHTML).toContain('Paragraph');
    });

    it('重複するslot名に対して警告を出すこと', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<slot name="test"></slot><slot name="test"></slot>';

      const mockLayout: ILayout = {
        name: 'duplicate-slot-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [],
      } as any;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('duplicate slot name "test"')
      );
      warnSpy.mockRestore();
    });

    it('slot属性がない要素はデフォルトslotに配置されること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<div><slot name="header"></slot><slot></slot></div>';

      const child1 = document.createElement('div');
      child1.textContent = 'No slot attr';

      const child2 = document.createElement('div');
      child2.setAttribute('slot', '');
      child2.textContent = 'Empty slot attr';

      const mockLayout: ILayout = {
        name: 'layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [child1, child2],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(layoutOutlet.innerHTML).toContain('No slot attr');
      expect(layoutOutlet.innerHTML).toContain('Empty slot attr');
    });

    it('非Element childNodeも処理できること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<slot></slot>';

      const textNode = document.createTextNode('Text node content');

      const mockLayout: ILayout = {
        name: 'text-node-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [textNode],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(layoutOutlet.textContent).toContain('Text node content');
    });

    it('_initializeは一度だけ実行されること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<div>Content</div>';

      const loadTemplateMock = vi.fn().mockResolvedValue(template);
      const mockLayout: ILayout = {
        name: 'once-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: loadTemplateMock,
        childNodes: [],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      // 再度appendChild（connectedCallbackが再実行される）
      document.body.removeChild(layoutOutlet);
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      // loadTemplateは一度だけ呼ばれるはず
      expect(loadTemplateMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('assignParams', () => {
    it('子要素のdata-bind属性にパラメータを割り当てること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<slot></slot>';

      const child = document.createElement('div');
      child.setAttribute('data-bind', '');

      const mockLayout: ILayout = {
        name: 'param-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [child],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      layoutOutlet.assignParams({ testProp: 'Test Value' });

      expect((child as any).testProp).toBe('Test Value');
    });

    it('孫要素のdata-bind属性にもパラメータを割り当てること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<slot></slot>';

      const child = document.createElement('div');
      const grandchild = document.createElement('span');
      grandchild.setAttribute('data-bind', 'attr');
      child.appendChild(grandchild);

      const mockLayout: ILayout = {
        name: 'nested-param-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [child],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      layoutOutlet.assignParams({ title: 'New Title' });

      expect(grandchild.getAttribute('title')).toBe('New Title');
    });

    it('非Element childNodeに対してはassignParamsをスキップすること', async () => {
      const layoutOutlet = document.createElement('wc-layout-outlet') as LayoutOutlet;
      const template = document.createElement('template');
      template.innerHTML = '<slot></slot>';

      const textNode = document.createTextNode('Text');

      const mockLayout: ILayout = {
        name: 'text-param-layout',
        uuid: 'uuid',
        enableShadowRoot: false,
        loadTemplate: vi.fn().mockResolvedValue(template),
        childNodes: [textNode],
      } as any;

      layoutOutlet.layout = mockLayout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      // エラーなく実行されること
      expect(() => {
        layoutOutlet.assignParams({ test: 'value' });
      }).not.toThrow();
    });
  });
});
