// Setup file for Vitest.
//
// happy-dom does not implement the Idle Detection API (IdleDetector), so each
// test installs its own controllable fake global class via the helpers in
// mocks.ts. This file is intentionally minimal — see mocks.ts for the fake.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
