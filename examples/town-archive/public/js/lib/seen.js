// 見た写真 — which photos have been seen, sent to the server in batches, each id once per
// visit of the page. Plain class, no DOM, no timers (the page drives it).

export const SEEN_BATCH_MAX = 100; // the server takes at most 100 ids per request
export const SEEN_BATCH_SOON = 30; // send without waiting once this many are waiting

/** Is a card "seen": at least half of it on the screen, or — for a card taller than twice the
 *  screen — at least half of the screen covered by it. `entry` is an IntersectionObserver
 *  entry snapshot (`intersectionRatio`, `intersectionRect`, `rootBounds`). */
export function isSeen(entry) {
  if (!entry || !entry.isIntersecting) return false;
  if (entry.intersectionRatio >= 0.5) return true;
  const rootH = entry.rootBounds?.height ?? 0;
  const visibleH = entry.intersectionRect?.height ?? 0;
  return rootH > 0 && visibleH >= rootH * 0.5;
}

export class SeenBatcher {
  constructor() {
    this.reported = new Set(); // queued, in flight or sent during this visit
    this.queue = [];
    this.inFlight = [];
  }
  /** Record a seen id. Returns true when it is new for this visit. */
  add(id) {
    if (this.reported.has(id)) return false;
    this.reported.add(id);
    this.queue.push(id);
    return true;
  }
  get waiting() { return this.queue.length; }
  /** Take the next batch to send (moves it to in-flight). */
  take(max = SEEN_BATCH_MAX) {
    if (this.inFlight.length) return [];
    this.inFlight = this.queue.slice(0, max);
    this.queue = this.queue.slice(max);
    return this.inFlight.slice();
  }
  /** The in-flight batch was accepted. */
  done() { this.inFlight = []; }
  /** The in-flight batch failed: put it back at the front. */
  failed() { this.queue = this.inFlight.concat(this.queue); this.inFlight = []; }
  /** Everything not yet confirmed, for a beacon when the page goes away (at most `max`). */
  drainForBeacon(max = SEEN_BATCH_MAX) {
    const ids = this.inFlight.concat(this.queue);
    this.inFlight = [];
    this.queue = [];
    const batches = [];
    for (let i = 0; i < ids.length; i += max) batches.push(ids.slice(i, i + max));
    return batches;
  }
}
