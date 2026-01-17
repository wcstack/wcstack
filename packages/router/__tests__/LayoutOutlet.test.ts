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

  it('LayoutOutlet繧ｯ繝ｩ繧ｹ縺悟ｭ伜惠縺吶ｋ縺薙→', () => {
    expect(LayoutOutlet).toBeDefined();
    expect(typeof LayoutOutlet).toBe('function');
  });

  it('HTMLElement繧堤ｶ呎価縺励※縺・ｋ縺薙→', () => {
    expect(Object.getPrototypeOf(LayoutOutlet.prototype)).toBe(HTMLElement.prototype);
  });

  it('繧､繝ｳ繧ｹ繧ｿ繝ｳ繧ｹ繧剃ｽ懈・縺ｧ縺阪ｋ縺薙→', () => {
    const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
    expect(layoutOutlet).toBeInstanceOf(LayoutOutlet);
    expect(layoutOutlet).toBeInstanceOf(HTMLElement);
  });

  describe('createLayoutOutlet', () => {
    it('createLayoutOutlet髢｢謨ｰ縺ｧ繧､繝ｳ繧ｹ繧ｿ繝ｳ繧ｹ繧剃ｽ懈・縺ｧ縺阪ｋ縺薙→', () => {
      const layoutOutlet = createLayoutOutlet();
      expect(layoutOutlet).toBeInstanceOf(LayoutOutlet);
    });
  });

  describe('layout 繝励Ο繝代ユ繧｣', () => {
    it('layout縺瑚ｨｭ螳壹＆繧後※縺・↑縺・ｴ蜷医↓繧ｨ繝ｩ繝ｼ繧呈兜縺偵ｋ縺薙→', () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
      expect(() => layoutOutlet.layout).toThrow();
    });

    it('layout繧定ｨｭ螳壹〒縺阪ｋ縺薙→', () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('name繝励Ο繝代ユ繧｣縺畦ayout.name繧定ｿ斐☆縺薙→', () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

  describe('connectedCallback 縺ｨ _initialize', () => {
    it('shadowRoot縺梧怏蜉ｹ縺ｪ蝣ｴ蜷医↓shadowRoot繧剃ｽ懈・縺吶ｋ縺薙→', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('shadowRoot縺檎┌蜉ｹ縺ｪ蝣ｴ蜷医・騾壼ｸｸ縺ｮDOM縺ｨ縺励※霑ｽ蜉縺輔ｌ繧九％縺ｨ', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('shadowRoot菴ｿ逕ｨ譎ゅ↓layout.childNodes繧定ｿｽ蜉縺吶ｋ縺薙→', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('蜷榊燕莉倥″slot繧呈ｭ｣縺励￥蜃ｦ逅・☆繧九％縺ｨ', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('蜷榊燕莉倥″slot縺ｮ譛蛻昴・蜑ｲ繧雁ｽ薙※縺ｧfragment繧剃ｽ懈・縺吶ｋ縺薙→', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('蜷後§slot蜷阪・隍・焚隕∫ｴ繧・縺､縺ｮfragment縺ｫ霑ｽ蜉縺吶ｋ縺薙→', async () => {
      const layout = document.createElement('wcs-layout') as Layout;
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

      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
      layoutOutlet.layout = layout;
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      const content = layoutOutlet.innerHTML;
      expect(content).toContain('Header A');
      expect(content).toContain('Header B');
    });

    it('繝・ヵ繧ｩ繝ｫ繝・lot縺ｫ隕∫ｴ繧帝・鄂ｮ縺吶ｋ縺薙→', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('驥崎､・☆繧虐lot蜷阪↓蟇ｾ縺励※隴ｦ蜻翫ｒ蜃ｺ縺吶％縺ｨ', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('slot螻樊ｧ縺後↑縺・ｦ∫ｴ縺ｯ繝・ヵ繧ｩ繝ｫ繝・lot縺ｫ驟咲ｽｮ縺輔ｌ繧九％縺ｨ', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('髱昿lement childNode繧ょ・逅・〒縺阪ｋ縺薙→', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('_initialize縺ｯ荳蠎ｦ縺縺大ｮ溯｡後＆繧後ｋ縺薙→', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

      // 蜀榊ｺｦappendChild・・onnectedCallback縺悟・螳溯｡後＆繧後ｋ・・
      document.body.removeChild(layoutOutlet);
      document.body.appendChild(layoutOutlet);

      await new Promise(resolve => setTimeout(resolve, 0));

      // loadTemplate縺ｯ荳蠎ｦ縺縺大他縺ｰ繧後ｋ縺ｯ縺・
      expect(loadTemplateMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('assignParams', () => {
    it('蟄占ｦ∫ｴ縺ｮdata-bind螻樊ｧ縺ｫ繝代Λ繝｡繝ｼ繧ｿ繧貞牡繧雁ｽ薙※繧九％縺ｨ', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('蟄ｫ隕∫ｴ縺ｮdata-bind螻樊ｧ縺ｫ繧ゅヱ繝ｩ繝｡繝ｼ繧ｿ繧貞牡繧雁ｽ薙※繧九％縺ｨ', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

    it('髱昿lement childNode縺ｫ蟇ｾ縺励※縺ｯassignParams繧偵せ繧ｭ繝・・縺吶ｋ縺薙→', async () => {
      const layoutOutlet = document.createElement('wcs-layout-outlet') as LayoutOutlet;
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

      // 繧ｨ繝ｩ繝ｼ縺ｪ縺丞ｮ溯｡後＆繧後ｋ縺薙→
      expect(() => {
        layoutOutlet.assignParams({ test: 'value' });
      }).not.toThrow();
    });
  });
});
