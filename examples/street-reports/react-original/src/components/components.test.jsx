import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from './Pagination.jsx';
import { CommentForm } from './CommentForm.jsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useLocalStorage } from '../hooks/useLocalStorage.js';

describe('useDebouncedValue', () => {
  afterEach(() => vi.useRealTimers());

  it('only settles after the value stops changing', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: 'a' } });
    rerender({ value: 'ab' });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: 'abc' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('abc');
  });
});

describe('useLocalStorage', () => {
  it('persists values and follows storage events from other tabs', () => {
    const { result } = renderHook(() => useLocalStorage('test:key', 'light'));
    expect(result.current[0]).toBe('light');
    act(() => result.current[1]('dark'));
    expect(localStorage.getItem('test:key')).toBe('"dark"');
    act(() => {
      localStorage.setItem('test:key', '"sepia"');
      window.dispatchEvent(new StorageEvent('storage', { key: 'test:key', newValue: '"sepia"', storageArea: localStorage }));
    });
    expect(result.current[0]).toBe('sepia');
  });
});

describe('Pagination', () => {
  it('shows the position and disables the ends', async () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination page={1} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByText('1 / 3 ページ')).toBeTruthy();
    expect(screen.getByRole('button', { name: '前へ' }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(<Pagination page={3} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: '次へ' }).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '前へ' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it('renders nothing for a single page', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onPageChange={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('CommentForm', () => {
  it('counts characters and disables 送信 when blank or too long', async () => {
    render(<CommentForm onSubmit={vi.fn()} />);
    const textarea = screen.getByLabelText('コメント');
    const send = screen.getByRole('button', { name: '送信' });
    expect(screen.getByText('0 / 500')).toBeTruthy();
    expect(send.disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: '  ' } });
    expect(send.disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: 'x'.repeat(501) } });
    expect(screen.getByText('501 / 500')).toBeTruthy();
    expect(send.disabled).toBe(true);
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
  });

  it('submits with Ctrl+Enter, clears the text and keeps the focus', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CommentForm onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText('コメント');
    await userEvent.type(textarea, '確認しました');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledWith('確認しました');
    expect(textarea.value).toBe('');
    expect(document.activeElement).toBe(textarea);
  });

  it('keeps the text and shows an error when sending fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('500'));
    render(<CommentForm onSubmit={onSubmit} />);
    const textarea = screen.getByLabelText('コメント');
    await userEvent.type(textarea, '送れない');
    await userEvent.click(screen.getByRole('button', { name: '送信' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(textarea.value).toBe('送れない');
  });
});
