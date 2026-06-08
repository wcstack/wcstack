import { vi } from "vitest";

/**
 * A fake `Blob` carrying a known string, with a `.text()` that resolves to it.
 * happy-dom's Blob support is uneven, so the read-path tests use these instead
 * of real Blobs — ClipboardCore only ever calls `.text()` on a `text/plain`
 * representation and otherwise just stores the object.
 */
export function makeBlob(content: string, type: string): Blob {
  return {
    type,
    text: () => Promise.resolve(content),
  } as unknown as Blob;
}

/**
 * Build a `ClipboardItem`-like object from a `{ mimeType: content }` map. Each
 * `getType(type)` resolves to a fake Blob carrying that content (see makeBlob).
 */
export function makeClipboardItem(entries: Record<string, string>): ClipboardItem {
  const types = Object.keys(entries);
  return {
    types,
    getType: (type: string) => Promise.resolve(makeBlob(entries[type], type)),
  } as unknown as ClipboardItem;
}

export interface ClipboardMock {
  writeText: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
}

/**
 * Install a controllable navigator.clipboard mock.
 *
 * - writeText / write resolve (or reject with `writeError`) on the next
 *   microtask, mimicking the async API.
 * - readText resolves with `readText` (or rejects with `readError`).
 * - read resolves with `readItems` (or rejects with `readError`).
 */
export function installClipboard(opts: {
  readText?: string;
  readItems?: ClipboardItem[];
  writeError?: unknown;
  readError?: unknown;
} = {}): ClipboardMock {
  const writeText = vi.fn(() =>
    opts.writeError !== undefined ? Promise.reject(opts.writeError) : Promise.resolve(),
  );
  const write = vi.fn(() =>
    opts.writeError !== undefined ? Promise.reject(opts.writeError) : Promise.resolve(),
  );
  const readText = vi.fn(() =>
    opts.readError !== undefined ? Promise.reject(opts.readError) : Promise.resolve(opts.readText ?? ""),
  );
  const read = vi.fn(() =>
    opts.readError !== undefined ? Promise.reject(opts.readError) : Promise.resolve(opts.readItems ?? []),
  );

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText, write, readText, read },
    configurable: true,
    writable: true,
  });

  return { writeText, write, readText, read };
}

/** Remove navigator.clipboard so the "unsupported" branches can be tested. */
export function removeClipboard(): void {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

export interface PermissionStatusMock extends EventTarget {
  state: string;
  /** Flip the state and dispatch a `change` event, as the real API does. */
  change: (state: string) => void;
}

/** Build a controllable PermissionStatus-like object. */
export function makePermissionStatus(state = "prompt"): PermissionStatusMock {
  const status = new EventTarget() as PermissionStatusMock;
  status.state = state;
  status.change = (next: string) => {
    status.state = next;
    status.dispatchEvent(new Event("change"));
  };
  return status;
}

/**
 * Install a navigator.permissions mock whose query() resolves to a controllable
 * PermissionStatus. ClipboardCore queries two names (`clipboard-read` then
 * `clipboard-write`); by default the mock ignores the name. Pass `reject: true` to
 * simulate a browser that does not expose the clipboard permission names (e.g.
 * Firefox). By default every query() resolves to the *same* status; pass
 * `distinctPerQuery: true` to return a fresh status each call (read = statuses[0],
 * write = statuses[1], in call order).
 *
 * Pass `byName: true` to honor the queried name: `clipboard-read` and
 * `clipboard-write` each get their own dedicated status, exposed as `readStatus`
 * and `writeStatus`. This lets a test verify that read/write are wired to the
 * *correct* permission (catching a name mix-up), since a name-ignoring mock would
 * pass even if the two were swapped.
 */
export function installPermissions(opts: { state?: string; reject?: boolean; distinctPerQuery?: boolean; byName?: boolean } = {}): PermissionStatusMock & { statuses: PermissionStatusMock[]; readStatus: PermissionStatusMock; writeStatus: PermissionStatusMock } {
  const statuses: PermissionStatusMock[] = [];
  const base = makePermissionStatus(opts.state ?? "prompt");
  const readStatus = makePermissionStatus(opts.state ?? "prompt");
  const writeStatus = makePermissionStatus(opts.state ?? "prompt");

  const query = opts.reject
    ? vi.fn(() => Promise.reject(new TypeError("unsupported permission name")))
    : vi.fn((desc: { name: string }) => {
        if (opts.byName) {
          const s = desc.name === "clipboard-write" ? writeStatus : readStatus;
          statuses.push(s);
          return Promise.resolve(s);
        }
        const s = opts.distinctPerQuery ? makePermissionStatus(opts.state ?? "prompt") : base;
        statuses.push(s);
        return Promise.resolve(s);
      });

  Object.defineProperty(navigator, "permissions", {
    value: { query },
    configurable: true,
    writable: true,
  });

  return Object.assign(base, { statuses, readStatus, writeStatus });
}

/** Remove navigator.permissions so the "unsupported" branch can be tested. */
export function removePermissions(): void {
  Object.defineProperty(navigator, "permissions", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Dispatch a `paste` event on document carrying the given text/plain payload. */
export function dispatchPaste(text: string | null): void {
  const event = new Event("paste", { bubbles: true });
  Object.defineProperty(event, "clipboardData", {
    value: text === null ? null : { getData: (type: string) => (type === "text/plain" ? text : "") },
    configurable: true,
  });
  document.dispatchEvent(event);
}

/** Mock document.getSelection to return the given string (or null for no selection). */
export function mockSelection(text: string | null): void {
  vi.spyOn(document, "getSelection").mockReturnValue(
    text === null ? null : ({ toString: () => text } as unknown as Selection),
  );
}
