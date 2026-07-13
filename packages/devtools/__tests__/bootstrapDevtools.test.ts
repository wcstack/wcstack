import { describe, it, expect, vi, afterEach } from 'vitest';
import { bootstrapDevtools } from '../src/bootstrapDevtools';
import { DEVTOOLS_HOOK_GLOBAL } from '../src/protocol/types';

describe('bootstrapDevtools', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-wcs-server');
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>)[DEVTOOLS_HOOK_GLOBAL];
  });

  it('SSRでは定義も挿入もしないこと', () => {
    document.documentElement.setAttribute('data-wcs-server', '');
    bootstrapDevtools();
    expect(customElements.get('wcs-devtools')).toBeUndefined();
    expect(document.querySelector('wcs-devtools')).toBeNull();
  });

  it('要素を定義しbody末尾に自動挿入すること（再実行は冪等）', () => {
    bootstrapDevtools();
    expect(customElements.get('wcs-devtools')).toBeDefined();
    expect(document.querySelectorAll('wcs-devtools')).toHaveLength(1);
    // 既にある場合は挿入しない（define 済みの再実行も安全）
    bootstrapDevtools();
    expect(document.querySelectorAll('wcs-devtools')).toHaveLength(1);
  });

  it('bodyが未パースの場合はDOMContentLoadedまで挿入を遅延すること', () => {
    document.body.innerHTML = '';
    const bodySpy = vi.spyOn(document, 'body', 'get').mockReturnValue(null as unknown as HTMLElement);
    try {
      bootstrapDevtools();
    } finally {
      bodySpy.mockRestore();
    }
    expect(document.querySelector('wcs-devtools')).toBeNull();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.querySelectorAll('wcs-devtools')).toHaveLength(1);
  });
});
