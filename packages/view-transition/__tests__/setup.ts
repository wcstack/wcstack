// Setup file for Vitest.
//
// happy-dom implements neither document.startViewTransition nor matchMedia, so
// each test installs its own fakes via the helpers in mocks.ts.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
