/**
 * Register a `notificationclick` listener that relays clicks to the page. Call
 * once from the consumer's Service Worker. Safe to call when BroadcastChannel or
 * clients are unavailable (each transport is attempted independently). Idempotent:
 * a second call is a no-op (the listener is registered at most once).
 */
declare function wireNotificationClicks(): void;

export { wireNotificationClicks };
