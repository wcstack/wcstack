/**
 * Let a state write reach the DOM.
 *
 * `@wcstack/state` applies updates on the microtask queue; two microtask turns
 * cover the write → apply chain, and one macrotask (`setTimeout(0)`) covers
 * anything a binding defers (e.g. a `customElements.whenDefined` re-apply).
 * This is exactly the wait the README recipe uses, fixed in one place.
 */
export async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
