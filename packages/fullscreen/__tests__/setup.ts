// Setup file for Vitest.
//
// happy-dom does not implement the Fullscreen API (Element.requestFullscreen,
// document.exitFullscreen, document.fullscreenElement, fullscreenchange), so
// each test installs its own mock via the helpers in mocks.ts. This file is
// intentionally minimal — see mocks.ts for the controllable fakes.

import { installElementInternalsShim } from "./helpers";

// happy-dom does not implement ElementInternals / CustomStateSet yet
// (docs/custom-state-reflection-design.md §3.6). Installs only when absent.
installElementInternalsShim();
