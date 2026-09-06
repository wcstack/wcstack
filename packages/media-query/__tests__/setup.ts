// Setup file for Vitest.
//
// happy-dom does implement window.matchMedia, but its MediaQueryList change
// delivery cannot be driven deterministically (docs/a11y-design.md §6-3, the
// @wcstack/raf precedent), so each test installs its own controllable fake via
// the helpers in mocks.ts — injected into the Core directly, or installed on
// globalThis for the Shell. This file is intentionally minimal.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
