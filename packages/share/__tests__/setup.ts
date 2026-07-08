// Setup file for Vitest.
//
// happy-dom does not implement the Web Share API (navigator.share /
// navigator.canShare), so each test installs its own fake via the helpers in
// mocks.ts. This file is intentionally minimal — see mocks.ts for the
// controllable double.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
