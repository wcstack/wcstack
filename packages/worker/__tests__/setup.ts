// Setup file for Vitest.
//
// happy-dom does not implement the Worker constructor, so each test installs a
// controllable in-process fake via the helpers in mocks.ts. The fake records
// posts and exposes emit* drivers for the worker's inbound surfaces (message /
// messageerror / error), and structured-clones payloads so a non-cloneable post
// throws DataCloneError exactly as the platform does. This file is intentionally
// minimal — see mocks.ts for the fake.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
