import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { waitForStateInitialize } from '../src/waitForStateInitialize';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('waitForStateInitialize', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(customElements, 'whenDefined').mockResolvedValue(HTMLElement as any);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('state要素が存在しない場合は即時に解決されること', async () => {
    await expect(waitForStateInitialize(document)).resolves.toBeUndefined();
  });

  it('全てのstate要素のinitializePromiseを待つこと', async () => {
    const deferred1 = createDeferred();
    const deferred2 = createDeferred();

    const el1 = document.createElement('wcs-state') as any;
    const el2 = document.createElement('wcs-state') as any;
    el1.initializePromise = deferred1.promise;
    el2.initializePromise = deferred2.promise;

    document.body.appendChild(el1);
    document.body.appendChild(el2);

    let finished = false;
    const waitPromise = waitForStateInitialize(document).then(() => {
      finished = true;
    });

    await Promise.resolve();
    expect(finished).toBe(false);

    deferred1.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);

    deferred2.resolve();
    await waitPromise;
    expect(finished).toBe(true);
  });
});
