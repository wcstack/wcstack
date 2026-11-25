// The hooks and contexts of the React app live in the root state (state/app.js) and in wcstack I/O nodes.
// These tests mount the real state file with a slice of index.html's markup (@wcstack/testing, resolveModule)
// and drive it the way a handler or the user does.
//   useLocalStorage  → <wcs-storage> + themeStored / staffIdStored
//   useDebouncedValue → <wcs-debounce> + listTextSettled
//   ToastContext     → toasts / visibleToasts / the 4 s timers
//   ReportsStore     → summary / statusChanged
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle, fire } from '@wcstack/testing';

const resolveModule = (url) => new URL('../public' + url.pathname, import.meta.url);
const bootstrap = [
  async () => (await import('@wcstack/state')).bootstrapState(),
  async () => (await import('@wcstack/storage')).bootstrapStorage(),
  async () => (await import('@wcstack/debounce')).bootstrapDebounce(),
  async () => (await import('@wcstack/sse')).bootstrapSse(),
];

class FakeEventSource {
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; FakeEventSource.opened.push(url); FakeEventSource.last = this; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== fn); }
  close() { this.readyState = 2; FakeEventSource.closed.push(this.url); }
  /** A named event from the server, as the browser delivers it. */
  emit(type, data) { for (const fn of this.listeners[type] ?? []) fn({ type, data: JSON.stringify(data), lastEventId: '' }); }
}

beforeEach(() => {
  FakeEventSource.opened = [];
  FakeEventSource.closed = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // the summary command has no <wcs-fetch> here
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SHELL = `
  <wcs-state src="state/app.js"></wcs-state>
  <wcs-storage key="street-reports:theme" data-wcs="value#init=element: themeStored"></wcs-storage>
  <wcs-storage key="street-reports:staffId" data-wcs="value#init=element: staffIdStored"></wcs-storage>
  <wcs-sse url="/api/events" events="report" data-wcs="eventToken.message: summaryEvent"></wcs-sse>
  <button id="theme" type="button" data-wcs="onclick: toggleTheme; textContent: themeLabel"></button>
  <div class="toasts" role="status">
    <template data-wcs="for: visibleToasts">
      <div class="toast"><span data-wcs="textContent: .message"></span>
        <button type="button" class="toast-close" data-wcs="onclick: dismissToast">×</button></div>
    </template>
  </div>`;

describe('ThemeContext / useLocalStorage → <wcs-storage>', () => {
  it('persists the theme and follows a storage event from another tab', async () => {
    const app = await mount(SHELL, { bootstrap, resolveModule });
    const button = app.root.querySelector('#theme');
    expect(button.textContent).toBe('テーマ: ライト');
    fire(button, 'click');
    await settle();
    expect(button.textContent).toBe('テーマ: ダーク');
    expect(localStorage.getItem('street-reports:theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    localStorage.setItem('street-reports:theme', 'light');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'street-reports:theme', newValue: 'light', oldValue: 'dark', storageArea: localStorage,
    }));
    await settle();
    expect(button.textContent).toBe('テーマ: ライト');
    app.unmount();
  });

  it('the stored 担当者 wins over the first staff member', async () => {
    localStorage.setItem('street-reports:staffId', '3');
    const app = await mount(SHELL, { bootstrap, resolveModule });
    await app.state().write((s) => { s['staffFetch.value'] = [{ id: 1, name: 'A' }, { id: 3, name: 'C' }]; });
    await settle();
    expect(app.state().read((s) => s.currentStaffId)).toBe(3);
    app.unmount();
  });
});

describe('useDebouncedValue → <wcs-debounce>', () => {
  it('only settles after the value stops changing', async () => {
    const app = await mount(`${SHELL}
      <wcs-debounce wait="300" data-wcs="source: listText; value: listTextSettled"></wcs-debounce>`, { bootstrap, resolveModule });
    const write = (text) => app.state().write((s) => { s.listText = text; });
    await write('a');
    await new Promise((r) => setTimeout(r, 200));
    await write('ab');
    await new Promise((r) => setTimeout(r, 200));
    await write('abc');
    await new Promise((r) => setTimeout(r, 200));
    expect(app.state().read((s) => s.listTextSettled)).toBeNull();
    await new Promise((r) => setTimeout(r, 150));
    expect(app.state().read((s) => s.listTextSettled)).toBe('abc');
    app.unmount();
  });
});

describe('ToastContext → toasts', () => {
  it('shows at most 3, dismisses after 4 s or via ×, and the queued one gets its own 4 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const app = await mount(SHELL, { bootstrap, resolveModule });
    const closeButtons = () => app.root.querySelectorAll('.toast-close');
    for (let i = 1; i <= 4; i += 1) await app.state().write((s) => s.showToast(`通知 ${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(closeButtons()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(3999);
    expect(closeButtons()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(closeButtons()).toHaveLength(1);
    expect(app.root.querySelector('.toast span').textContent).toBe('通知 4');
    fire(closeButtons()[0], 'click');
    await vi.advanceTimersByTimeAsync(0);
    expect(closeButtons()).toHaveLength(0);
    app.unmount();
  });
});

describe('ReportsStore', () => {
  it('opens one session stream (<wcs-sse>), a report event refreshes the summary, and the badge counts move optimistically', async () => {
    const app = await mount(SHELL, { bootstrap, resolveModule });
    await settle();
    expect(FakeEventSource.opened).toEqual(['/api/events']);
    // useEventSource('/api/events', 'report', refreshSummary) → $on.summaryEvent
    const refreshed = vi.fn();
    await app.state().write((s) => { s.refreshSummary = refreshed; });
    FakeEventSource.last.emit('report', { id: 1, status: 'triaged' });
    await settle();
    expect(refreshed).toHaveBeenCalledTimes(1);
    await app.state().write((s) => { s.summary = { new: 3, triaged: 1, assigned: 0, done: 0 }; });
    await app.state().write((s) => s.statusChanged('new', 'triaged'));
    expect(app.state().read((s) => s.badgeText)).toBe('新規 2 件');
    app.unmount();
    expect(FakeEventSource.closed).toEqual(['/api/events']);
  });
});
