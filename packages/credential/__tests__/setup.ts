// Setup file for Vitest.
//
// happy-dom does not implement the Credential Management API
// (navigator.credentials), so each test installs its own controllable fake
// via the helpers in mocks.ts. This file is intentionally minimal.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
