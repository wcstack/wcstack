/**
 * event/handlerBindingRegistry.ts — ハンドラ共有台帳の重複と部分解除。
 */
import { describe, it, expect } from 'vitest';
import { createHandlerBindingRegistry } from '../src/event/handlerBindingRegistry';
import type { IBindingInfo } from '../src/types';

const binding = (): IBindingInfo => ({ propName: 'onclick' } as IBindingInfo);

describe('handlerBindingRegistry', () => {
  it('同じ binding の二重 add は false を返し数えないこと', () => {
    const registry = createHandlerBindingRegistry();
    const b = binding();
    expect(registry.add('k', b)).toBe(true);
    expect(registry.add('k', b)).toBe(false);
    expect(registry.remove('k', b)).toBe(true);
    // 数えていないので 1 回の remove でキーごと空になっている
    expect(registry.remove('k', b)).toBe(false);
  });

  it('同キー複数 binding は最後の 1 つが消えるまでキーを保持すること', () => {
    const registry = createHandlerBindingRegistry();
    const a = binding();
    const b = binding();
    registry.add('k', a);
    registry.add('k', b);
    expect(registry.remove('k', a)).toBe(false); // まだ b が残る（キー保持）
    expect(registry.remove('k', b)).toBe(true);  // 最後の 1 つでキーごと解放
  });

  it('未登録キーの remove は false', () => {
    const registry = createHandlerBindingRegistry();
    expect(registry.remove('none', binding())).toBe(false);
  });
});
