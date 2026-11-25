import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});
