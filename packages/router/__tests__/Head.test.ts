import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './setup';
import { Head, _resetHeadStack } from '../src/components/Head';

describe('Head', () => {
  let container: HTMLDivElement;
  let originalTitle: string;
  let originalHeadHTML: string;

  beforeEach(() => {
    _resetHeadStack();
    container = document.createElement('div');
    document.body.appendChild(container);
    originalTitle = document.title;
    originalHeadHTML = document.head.innerHTML;
  });

  afterEach(() => {
    container.remove();
    document.title = originalTitle;
    document.head.innerHTML = originalHeadHTML;
    _resetHeadStack();
  });

  describe('constructor', () => {
    it('display:noneが設定されること', () => {
      const head = document.createElement('wcs-head') as Head;
      expect(head.style.display).toBe('none');
    });
  });

  describe('初期化', () => {
    it('子要素がchildElementArrayに保持されDOMから削除されること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<title>Test Title</title><meta name="description" content="Test">';
      
      container.appendChild(head);
      
      expect(head.childElementArray.length).toBe(2);
      expect(head.children.length).toBe(0);
    });

    it('初期化前にchildElementArrayにアクセスするとエラーになること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<title>Test Title</title>';
      
      expect(() => head.childElementArray).toThrow('Head component is not initialized yet.');
    });

    it('複数回初期化しても重複しないこと', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<title>Test Title</title>';
      
      container.appendChild(head);
      container.removeChild(head);
      container.appendChild(head);
      
      expect(head.childElementArray.length).toBe(1);
    });
  });

  describe('connectedCallback - title', () => {
    it('titleが書き換わること', () => {
      document.title = 'Original Title';
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<title>New Title</title>';
      container.appendChild(head);
      
      expect(document.title).toBe('New Title');
    });

    it('disconnectedでtitleが元に戻ること', () => {
      document.title = 'Original Title';
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<title>New Title</title>';
      container.appendChild(head);
      
      expect(document.title).toBe('New Title');
      
      container.removeChild(head);
      
      expect(document.title).toBe('Original Title');
    });
  });

  describe('connectedCallback - meta', () => {
    it('meta[name]が書き換わること', () => {
      const existingMeta = document.createElement('meta');
      existingMeta.setAttribute('name', 'description');
      existingMeta.setAttribute('content', 'Original description');
      document.head.appendChild(existingMeta);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta name="description" content="New description">';
      container.appendChild(head);
      
      const meta = document.head.querySelector('meta[name="description"]');
      expect(meta?.getAttribute('content')).toBe('New description');
    });

    it('meta[property]が書き換わること', () => {
      const existingMeta = document.createElement('meta');
      existingMeta.setAttribute('property', 'og:title');
      existingMeta.setAttribute('content', 'Original OG Title');
      document.head.appendChild(existingMeta);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta property="og:title" content="New OG Title">';
      container.appendChild(head);
      
      const meta = document.head.querySelector('meta[property="og:title"]');
      expect(meta?.getAttribute('content')).toBe('New OG Title');
    });

    it('meta[http-equiv]が書き換わること', () => {
      const existingMeta = document.createElement('meta');
      existingMeta.setAttribute('http-equiv', 'refresh');
      existingMeta.setAttribute('content', '30');
      document.head.appendChild(existingMeta);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta http-equiv="refresh" content="60">';
      container.appendChild(head);
      
      const meta = document.head.querySelector('meta[http-equiv="refresh"]');
      expect(meta?.getAttribute('content')).toBe('60');
    });

    it('meta[charset]が書き換わること', () => {
      const existingMeta = document.createElement('meta');
      existingMeta.setAttribute('charset', 'UTF-8');
      document.head.appendChild(existingMeta);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta charset="ISO-8859-1">';
      container.appendChild(head);
      
      const meta = document.head.querySelector('meta[charset]');
      expect(meta?.getAttribute('charset')).toBe('ISO-8859-1');
    });

    it('meta[media]で異なるmediaが区別されること', () => {
      const lightMeta = document.createElement('meta');
      lightMeta.setAttribute('name', 'theme-color');
      lightMeta.setAttribute('content', '#ffffff');
      lightMeta.setAttribute('media', '(prefers-color-scheme: light)');
      document.head.appendChild(lightMeta);
      
      const darkMeta = document.createElement('meta');
      darkMeta.setAttribute('name', 'theme-color');
      darkMeta.setAttribute('content', '#000000');
      darkMeta.setAttribute('media', '(prefers-color-scheme: dark)');
      document.head.appendChild(darkMeta);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta name="theme-color" content="#333333" media="(prefers-color-scheme: dark)">';
      container.appendChild(head);
      
      // lightは変わらない
      const lightMetaResult = document.head.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
      expect(lightMetaResult?.getAttribute('content')).toBe('#ffffff');
      
      // darkは書き換わる
      const darkMetaResult = document.head.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');
      expect(darkMetaResult?.getAttribute('content')).toBe('#333333');
    });

    it('disconnectedでmetaが元に戻ること', () => {
      const existingMeta = document.createElement('meta');
      existingMeta.setAttribute('name', 'description');
      existingMeta.setAttribute('content', 'Original description');
      document.head.appendChild(existingMeta);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta name="description" content="New description">';
      container.appendChild(head);
      
      container.removeChild(head);
      
      const meta = document.head.querySelector('meta[name="description"]');
      expect(meta?.getAttribute('content')).toBe('Original description');
    });

    it('元々存在しなかったmetaがdisconnectedで削除されること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta name="new-meta" content="New value">';
      container.appendChild(head);
      
      expect(document.head.querySelector('meta[name="new-meta"]')).not.toBeNull();
      
      container.removeChild(head);
      
      expect(document.head.querySelector('meta[name="new-meta"]')).toBeNull();
    });
  });

  describe('connectedCallback - link', () => {
    it('link[rel]が書き換わること', () => {
      const existingLink = document.createElement('link');
      existingLink.setAttribute('rel', 'canonical');
      existingLink.setAttribute('href', 'https://example.com/original');
      document.head.appendChild(existingLink);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<link rel="canonical" href="https://example.com/original">';
      container.appendChild(head);
      
      const links = document.head.querySelectorAll('link[rel="canonical"]');
      expect(links.length).toBe(1);
    });

    it('link[rel]のみで識別できること（hrefなし）', () => {
      const existingLink = document.createElement('link');
      existingLink.setAttribute('rel', 'preconnect');
      document.head.appendChild(existingLink);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<link rel="preconnect">';
      container.appendChild(head);
      
      const links = document.head.querySelectorAll('link[rel="preconnect"]');
      expect(links.length).toBe(1);
    });

    it('link（mediaなし）が正しく識別されること', () => {
      const existingLink = document.createElement('link');
      existingLink.setAttribute('rel', 'icon');
      existingLink.setAttribute('href', '/favicon.ico');
      document.head.appendChild(existingLink);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<link rel="icon" href="/new-favicon.ico">';
      container.appendChild(head);
      
      // 異なるhrefなので追加される（置換ではない）
      const icons = document.head.querySelectorAll('link[rel="icon"]');
      expect(icons.length).toBe(2);
    });

    it('link[media]で異なるmediaが区別されること', () => {
      const screenLink = document.createElement('link');
      screenLink.setAttribute('rel', 'stylesheet');
      screenLink.setAttribute('href', 'screen.css');
      screenLink.setAttribute('media', 'screen');
      document.head.appendChild(screenLink);
      
      const printLink = document.createElement('link');
      printLink.setAttribute('rel', 'stylesheet');
      printLink.setAttribute('href', 'print.css');
      printLink.setAttribute('media', 'print');
      document.head.appendChild(printLink);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<link rel="stylesheet" href="print.css" media="print">';
      container.appendChild(head);
      
      // screenは1つのまま
      const screenLinks = document.head.querySelectorAll('link[media="screen"]');
      expect(screenLinks.length).toBe(1);
      
      // printも1つのまま（置換された）
      const printLinks = document.head.querySelectorAll('link[media="print"]');
      expect(printLinks.length).toBe(1);
    });

    it('disconnectedでlinkが元に戻ること', () => {
      const existingLink = document.createElement('link');
      existingLink.setAttribute('rel', 'canonical');
      existingLink.setAttribute('href', 'https://example.com/original');
      document.head.appendChild(existingLink);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<link rel="canonical" href="https://example.com/new">';
      container.appendChild(head);
      
      container.removeChild(head);
      
      const link = document.head.querySelector('link[rel="canonical"]');
      expect(link?.getAttribute('href')).toBe('https://example.com/original');
    });
  });

  describe('connectedCallback - base', () => {
    it('baseが書き換わること', () => {
      const existingBase = document.createElement('base');
      existingBase.setAttribute('href', 'https://example.com/');
      document.head.appendChild(existingBase);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<base href="https://example.com/admin/">';
      container.appendChild(head);
      
      const base = document.head.querySelector('base');
      expect(base?.getAttribute('href')).toBe('https://example.com/admin/');
    });

    it('disconnectedでbaseが元に戻ること', () => {
      const existingBase = document.createElement('base');
      existingBase.setAttribute('href', 'https://example.com/');
      document.head.appendChild(existingBase);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<base href="https://example.com/admin/">';
      container.appendChild(head);
      
      container.removeChild(head);
      
      const base = document.head.querySelector('base');
      expect(base?.getAttribute('href')).toBe('https://example.com/');
    });
  });

  describe('connectedCallback - その他の要素', () => {
    it('scriptタグが追加されること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<script src="test.js"></script>';
      container.appendChild(head);
      
      const scripts = document.head.querySelectorAll('script[src="test.js"]');
      expect(scripts.length).toBe(1);
    });

    it('styleタグが追加されること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<style>.test { color: red; }</style>';
      container.appendChild(head);
      
      const styles = document.head.querySelectorAll('style');
      const hasTestStyle = Array.from(styles).some(s => s.textContent?.includes('.test'));
      expect(hasTestStyle).toBe(true);
    });
  });

  describe('複数要素の同時適用', () => {
    it('複数要素が同時に適用されること', () => {
      document.title = 'Original';
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = `
        <title>New Title</title>
        <meta name="description" content="New description">
        <meta name="keywords" content="test, keywords">
      `;
      container.appendChild(head);
      
      expect(document.title).toBe('New Title');
      expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('New description');
      expect(document.head.querySelector('meta[name="keywords"]')?.getAttribute('content')).toBe('test, keywords');
    });

    it('disconnectedで複数要素が同時に復元されること', () => {
      document.title = 'Original';
      const existingMeta = document.createElement('meta');
      existingMeta.setAttribute('name', 'description');
      existingMeta.setAttribute('content', 'Original description');
      document.head.appendChild(existingMeta);
      
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = `
        <title>New Title</title>
        <meta name="description" content="New description">
        <meta name="keywords" content="test, keywords">
      `;
      container.appendChild(head);
      container.removeChild(head);
      
      expect(document.title).toBe('Original');
      expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Original description');
      expect(document.head.querySelector('meta[name="keywords"]')).toBeNull();
    });
  });

  describe('ネストされたHead', () => {
    it('後からconnectedされたHeadが優先されること', () => {
      document.title = 'Original';
      
      const head1 = document.createElement('wcs-head') as Head;
      head1.innerHTML = '<title>First Title</title>';
      container.appendChild(head1);
      
      expect(document.title).toBe('First Title');
      
      const head2 = document.createElement('wcs-head') as Head;
      head2.innerHTML = '<title>Second Title</title>';
      container.appendChild(head2);
      
      expect(document.title).toBe('Second Title');
    });

    it('後からconnectedされたHeadがdisconnectedされると前のHeadの値に戻ること', () => {
      document.title = 'Original';
      
      const head1 = document.createElement('wcs-head') as Head;
      head1.innerHTML = '<title>First Title</title>';
      container.appendChild(head1);
      
      const head2 = document.createElement('wcs-head') as Head;
      head2.innerHTML = '<title>Second Title</title>';
      container.appendChild(head2);
      
      container.removeChild(head2);
      
      // head2がdisconnectedされると、head2がconnected時点で記憶した"First Title"に戻る
      expect(document.title).toBe('First Title');
    });

    it('両方のHeadがdisconnectedされると元の値に戻ること', () => {
      document.title = 'Original';
      
      const head1 = document.createElement('wcs-head') as Head;
      head1.innerHTML = '<title>First Title</title>';
      container.appendChild(head1);
      
      const head2 = document.createElement('wcs-head') as Head;
      head2.innerHTML = '<title>Second Title</title>';
      container.appendChild(head2);
      
      container.removeChild(head2);
      container.removeChild(head1);
      
      expect(document.title).toBe('Original');
    });

    it('先にconnectedされたHeadが先にdisconnectedされても後のHeadの値が維持されること', () => {
      document.title = 'Original';
      
      const head1 = document.createElement('wcs-head') as Head;
      head1.innerHTML = '<title>First Title</title>';
      container.appendChild(head1);
      
      const head2 = document.createElement('wcs-head') as Head;
      head2.innerHTML = '<title>Second Title</title>';
      container.appendChild(head2);
      
      // 先にhead1を切断（逆順）
      container.removeChild(head1);
      
      // head2の値が維持される
      expect(document.title).toBe('Second Title');
      
      // head2を切断すると初期値に戻る
      container.removeChild(head2);
      expect(document.title).toBe('Original');
    });

    it('3つのHeadがスタックで正しく動作すること', () => {
      document.title = 'Original';
      
      const head1 = document.createElement('wcs-head') as Head;
      head1.innerHTML = '<title>First</title>';
      container.appendChild(head1);
      expect(document.title).toBe('First');
      
      const head2 = document.createElement('wcs-head') as Head;
      head2.innerHTML = '<title>Second</title>';
      container.appendChild(head2);
      expect(document.title).toBe('Second');
      
      const head3 = document.createElement('wcs-head') as Head;
      head3.innerHTML = '<title>Third</title>';
      container.appendChild(head3);
      expect(document.title).toBe('Third');
      
      // 中間のhead2を切断
      container.removeChild(head2);
      expect(document.title).toBe('Third'); // head3が最後なのでThirdのまま
      
      // head3を切断
      container.removeChild(head3);
      expect(document.title).toBe('First'); // head1が残っている
      
      // head1を切断
      container.removeChild(head1);
      expect(document.title).toBe('Original');
    });
  });

  describe('内部分岐のカバレッジ', () => {
    it('初期化を複数回呼んでも重複しないこと', () => {
      const titleEl = document.createElement('title');
      titleEl.textContent = 'Original';
      document.head.appendChild(titleEl);
      document.title = 'Original';

      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<title>Once</title>';

      container.appendChild(head);
      (head as any)._initialize();

      expect(document.title).toBe('Once');
      expect(head.childElementArray.length).toBe(1);

      container.removeChild(head);
      expect(document.title).toBe('Original');
    });

    it('初期に存在しない要素はdisconnectedで削除されること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<meta name="temp-meta" content="temp">';

      head.connectedCallback();
      expect(document.head.querySelector('meta[name="temp-meta"]')).not.toBeNull();

      head.disconnectedCallback();
      expect(document.head.querySelector('meta[name="temp-meta"]')).toBeNull();
    });

    it('link/base/scriptのキー判定が適用されること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = `
        <link rel="canonical" href="https://example.com/">
        <base href="https://example.com/">
        <script>console.log('test');</script>
      `;

      head.connectedCallback();

      expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();
      expect(document.head.querySelector('base')).not.toBeNull();
      expect(document.head.querySelector('script')).not.toBeNull();

      head.disconnectedCallback();
      expect(document.head.querySelector('script')).toBeNull();
    });

    it('未接続のHeadを切断してもエラーにならないこと', () => {
      const head = document.createElement('wcs-head') as Head;
      head.disconnectedCallback();
      expect(true).toBe(true);
    });

    it('内部ヘルパーの分岐が通ること', () => {
      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<title>Init</title><link rel="canonical" href="https://example.com/">';

      (head as any)._initialize();
      (head as any)._captureInitialHead();
      (head as any)._captureInitialHead();

      const linkEl = document.createElement('link');
      linkEl.setAttribute('rel', 'canonical');
      linkEl.setAttribute('href', 'https://example.com/');
      expect((head as any)._getKey(linkEl)).toContain('link:canonical');

      head.connectedCallback();
      (head as any)._reapplyHead();
      head.disconnectedCallback();
    });

    it('既存head内のlinkでもキー判定が通ること', () => {
      const existingLink = document.createElement('link');
      existingLink.setAttribute('rel', 'canonical');
      existingLink.setAttribute('href', 'https://example.com/');
      document.head.appendChild(existingLink);

      const head = document.createElement('wcs-head') as Head;
      head.innerHTML = '<link rel="canonical" href="https://example.com/">';
      head.connectedCallback();

      expect(document.head.querySelector('link[rel="canonical"]')).not.toBeNull();

      head.disconnectedCallback();
    });

    it('同一キーで先頭のHeadが優先される経路が通ること', () => {
      const head1 = document.createElement('wcs-head') as Head;
      head1.innerHTML = '<title>First</title>';
      head1.connectedCallback();

      const head2 = document.createElement('wcs-head') as Head;
      head2.innerHTML = '<title>Second</title>';
      head2.connectedCallback();

      (head2 as any)._reapplyHead();
      expect(document.title).toBe('Second');

      head2.disconnectedCallback();
      head1.disconnectedCallback();
    });

    it('linkのrelが未指定でもキー判定が通ること', () => {
      const head = document.createElement('wcs-head') as Head;
      const linkEl = document.createElement('link');
      expect((head as any)._getKey(linkEl)).toContain('link:');
    });

    it('キーがHeadに存在しない場合の分岐が通ること', () => {
      const headWithTitle = document.createElement('wcs-head') as Head;
      headWithTitle.innerHTML = '<title>Init</title>';
      headWithTitle.connectedCallback();
      headWithTitle.disconnectedCallback();

      const headWithMeta = document.createElement('wcs-head') as Head;
      headWithMeta.innerHTML = '<meta name="only-meta" content="v">';
      headWithMeta.connectedCallback();

      expect(document.head.querySelector('meta[name="only-meta"]')).not.toBeNull();

      headWithMeta.disconnectedCallback();
    });
  });
});
