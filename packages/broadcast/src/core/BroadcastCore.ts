import { IWcBindable, WcsBroadcastErrorDetail } from "../types.js";

/**
 * Headless cross-tab messaging primitive. A thin, framework-agnostic wrapper
 * around the BroadcastChannel API exposed through the wc-bindable protocol.
 *
 * BroadcastChannel is a same-origin pub/sub bus: every context (tab, iframe,
 * worker) that opens a channel with the same `name` receives every other
 * context's posts — but NOT its own. This self-exclusion is the whole point:
 * `post` is a `state → element` action (command-token) and an incoming
 * `message` is an `element → state` notification (event-token), but the two
 * only close the loop *across* a context boundary. Within a single tab a lone
 * `<wcs-broadcast>` never hears itself; open the page in two tabs to see the
 * round-trip.
 *
 * Unlike WebSocketCore there is no connection state, no reconnect, and no wire
 * encoding: a channel is "open" the moment it is constructed, and payloads ride
 * the browser's structured clone (objects pass through as-is, no JSON
 * round-trip). The only failure surfaces are a non-cloneable `post`
 * (`DataCloneError`), a `messageerror` (a peer posted something this context
 * cannot deserialize), and an absent `BroadcastChannel` constructor
 * (`unsupported`). All three flow through the `error` property — the Core never
 * throws — symmetrical with FetchCore / ClipboardCore.
 */
export class BroadcastCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "message", event: "wcs-broadcast:message" },
      { name: "error", event: "wcs-broadcast:error" },
    ],
    commands: [
      { name: "open" },
      { name: "post" },
      { name: "close" },
    ],
  };

  private _target: EventTarget;
  private _channel: BroadcastChannel | null = null;
  private _name: string | null = null;
  private _message: any = null;
  private _error: WcsBroadcastErrorDetail | null = null;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get message(): any {
    return this._message;
  }

  get error(): WcsBroadcastErrorDetail | null {
    return this._error;
  }

  // --- State setters with event dispatch ---

  // Deliberately NO same-value guard (unlike `error` below). A received message
  // is an event, not idempotent state: a peer posting the same value twice is
  // two distinct occurrences and must re-fire wcs-broadcast:message each time so
  // a `message:` binding and any `eventToken.message:` subscriber see both.
  private _setMessage(message: any): void {
    this._message = message;
    this._target.dispatchEvent(new CustomEvent("wcs-broadcast:message", {
      detail: message,
      bubbles: true,
    }));
  }

  private _setError(error: WcsBroadcastErrorDetail | null): void {
    // Same-value guard. `error` has no derived state, so suppressing redundant
    // null→null dispatches (e.g. a successful open clearing an already-null
    // error) avoids spurious events. Reference identity is sufficient: each
    // failure builds a fresh object, and the clear path always passes null.
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-broadcast:error", {
      detail: error,
      bubbles: true,
    }));
  }

  // --- Public API ---

  /**
   * Join the named channel. Any previously-open channel is closed first, so
   * calling `open()` again switches channels. When the BroadcastChannel
   * constructor is unavailable this surfaces an `unsupported` error and leaves
   * the Core channel-less (a later `post()` then errors loudly rather than
   * silently dropping).
   */
  open(name: string): void {
    if (!this._hasBroadcastChannel()) {
      this._setError(this._unsupportedError());
      return;
    }
    // Idempotent on the same channel: re-opening the channel we are already on
    // is pure churn (BroadcastChannel has no reconnect semantics). This also
    // absorbs the custom-element *upgrade* path — when a connected element with
    // a `name` attribute is upgraded (autoloader defines the tag after the
    // markup exists), the spec fires attributeChangedCallback (isConnected ===
    // true) *and* connectedCallback, so the Shell calls open() twice. Without
    // this guard that would create a channel and immediately tear it down.
    if (this._channel && this._name === name) return;
    this._closeChannel();
    this._setError(null);
    const channel = new BroadcastChannel(name);
    channel.addEventListener("message", this._onMessage);
    channel.addEventListener("messageerror", this._onMessageError);
    this._channel = channel;
    this._name = name;
  }

  /**
   * Post a structured-cloneable value to every other context on the channel.
   * The local context never receives it (self-exclusion). Never throws:
   * a non-cloneable value surfaces as a `DataCloneError` through `error`, and
   * posting with no open channel surfaces an `InvalidStateError`.
   */
  post(data: any): void {
    if (!this._hasBroadcastChannel()) {
      this._setError(this._unsupportedError());
      return;
    }
    if (!this._channel) {
      this._setError({
        name: "InvalidStateError",
        message: "Channel is not open. Call open(name) before post().",
      });
      return;
    }
    try {
      this._channel.postMessage(data);
    } catch (err) {
      this._setError(this._normalizeError(err));
    }
  }

  /** Leave the channel. Idempotent — a no-op when no channel is open. */
  close(): void {
    this._closeChannel();
  }

  /**
   * Tear the Core down for a disconnected Shell: close the channel and reset the
   * error shadow silently (no dispatch on a torn-down element). A later
   * reconnect re-opens via the Shell's connectedCallback.
   *
   * Asymmetry by design: `_message` is deliberately NOT reset. `error` is
   * transient connection state — a stale error from a previous channel would be
   * misleading after a reconnect, so it is cleared. `message` is the last value
   * received (an event payload), not connection state; it is retained as the
   * Core's last-known datum so a binding still reads it across a disconnect/
   * reconnect, and it is naturally overwritten by the next incoming message.
   */
  dispose(): void {
    this._closeChannel();
    this._error = null;
  }

  // --- Internal ---

  private _onMessage = (event: MessageEvent): void => {
    this._setMessage(event.data);
  };

  // Fired when a peer posted a value this context cannot deserialize. The event
  // carries no usable payload, so report a synthetic DataError.
  private _onMessageError = (): void => {
    this._setError({
      name: "DataError",
      message: "Failed to deserialize a message received on the channel.",
    });
  };

  private _closeChannel(): void {
    if (!this._channel) return;
    this._channel.removeEventListener("message", this._onMessage);
    this._channel.removeEventListener("messageerror", this._onMessageError);
    this._channel.close();
    this._channel = null;
    this._name = null;
  }

  private _hasBroadcastChannel(): boolean {
    return typeof BroadcastChannel !== "undefined";
  }

  private _normalizeError(err: unknown): WcsBroadcastErrorDetail {
    if (err instanceof Error) {
      // DOMException is an Error subclass; its `name` (DataCloneError, etc.) is
      // the meaningful discriminator for consumers switching on failure kind.
      return { name: err.name, message: err.message };
    }
    return { name: "Error", message: String(err) };
  }

  private _unsupportedError(): WcsBroadcastErrorDetail {
    return {
      name: "NotSupportedError",
      message: "BroadcastChannel is not available in this environment.",
    };
  }
}
