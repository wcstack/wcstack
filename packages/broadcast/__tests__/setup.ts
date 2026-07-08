// Setup file for Vitest.
//
// happy-dom does not implement BroadcastChannel, so each test installs a
// controllable in-process fake via the helpers in mocks.ts. The fake replicates
// the two semantics that matter: self-exclusion (a context never receives its
// own posts) and structured clone (peers receive a copy, and a non-cloneable
// payload throws DataCloneError). This file is intentionally minimal — see
// mocks.ts for the fake.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
