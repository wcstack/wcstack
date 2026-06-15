// Setup file for Vitest.
//
// happy-dom implements the Custom Elements registry natively, so — unlike
// @wcstack/permission, which had to mock navigator.permissions — these tests use
// the real `customElements` and just register tags on demand. See helpers.ts for
// unique-name generation (the registry has no un-define) and microtask flushing.
