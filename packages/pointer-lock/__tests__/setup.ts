// Setup file for Vitest.
//
// happy-dom does not implement the Pointer Lock API (Element.requestPointerLock,
// document.exitPointerLock/pointerLockElement, the pointerlockchange event), so
// each test installs its own fake via the helpers in mocks.ts. This file is
// intentionally minimal — see mocks.ts for the controllable fake.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet either
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
