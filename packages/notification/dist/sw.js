// Service Worker helper for `@wcstack/notification`.
//
// `notificationclick` fires inside the *consumer's* Service Worker — a global
// scope this package cannot inject into. So the consumer imports this one helper
// into their sw.js and calls it once:
//
//   import { wireNotificationClicks } from "@wcstack/notification/sw";
//   wireNotificationClicks();
//
// It relays each click back to the page over BroadcastChannel (primary) *and*
// clients.postMessage (fallback), tagged so `NotificationCore` on the page can
// turn it into the `wcs-notify:click` event-token. The page de-dups the two
// transports by the per-click `id`.
//
// This module runs in ServiceWorkerGlobalScope (not the DOM), but the package's
// tsconfig uses the DOM lib (the rest of the package is DOM code), and pulling in
// the "webworker" lib here would clash with it. Rather than fall back to `any`, we
// declare minimal structural types covering only the members we actually touch —
// just enough to keep this file type-checked without the conflicting lib.
const CHANNEL_NAME = "wcs-notify";
// Per-click sequence so the two relay transports of the SAME click share an `id`
// (de-duped on the page), while two genuine clicks on the same notification tag
// get distinct ids (both delivered).
let _seq = 0;
// Idempotency guard: registering the `notificationclick` listener twice would
// relay every click twice, and because each relay mints a fresh `id` the page's
// de-dup window cannot fold the duplicates — every click would fire the
// `wcs-notify:click` event-token twice. The helper is documented as call-once,
// but a defensive module-scope flag keeps a stray second call a no-op, matching
// NotificationCore's `_clicksSubscribed` guard on the page side.
let _wired = false;
/**
 * Register a `notificationclick` listener that relays clicks to the page. Call
 * once from the consumer's Service Worker. Safe to call when BroadcastChannel or
 * clients are unavailable (each transport is attempted independently). Idempotent:
 * a second call is a no-op (the listener is registered at most once).
 */
function wireNotificationClicks() {
    if (_wired)
        return;
    _wired = true;
    const scope = self;
    scope.addEventListener("notificationclick", (event) => {
        const notification = event.notification;
        const tag = (notification && notification.tag) || "";
        const message = {
            __wcsNotify: true,
            // Unique per click: the monotonic counter coalesces this click's two relay
            // transports (they share this one object), and the random suffix prevents a
            // collision with a stale id still in the page's de-dup window after a SW
            // restart resets the counter (same tag reused → would otherwise drop a click).
            id: `${tag}#${_seq++}-${Math.random().toString(36).slice(2, 10)}`,
            tag,
            data: notification ? notification.data : undefined,
            action: event.action || "",
        };
        // Dismiss the notification, as a click conventionally should.
        if (notification && typeof notification.close === "function") {
            notification.close();
        }
        // Primary transport: BroadcastChannel reaches every same-origin context.
        try {
            const channel = new BroadcastChannel(CHANNEL_NAME);
            channel.postMessage(message);
            channel.close();
        }
        catch {
            // BroadcastChannel unavailable — rely on the postMessage fallback.
        }
        // Fallback transport: post to every controlled window client.
        const relay = (async () => {
            try {
                const clients = await scope.clients.matchAll({ includeUncontrolled: true, type: "window" });
                for (const client of clients) {
                    client.postMessage(message);
                }
            }
            catch {
                // No clients API / no clients — the BroadcastChannel path covers it.
            }
        })();
        if (typeof event.waitUntil === "function") {
            event.waitUntil(relay);
        }
    });
}

export { wireNotificationClicks };
//# sourceMappingURL=sw.js.map
