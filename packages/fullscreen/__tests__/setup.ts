// Setup file for Vitest.
//
// happy-dom does not implement the Fullscreen API (Element.requestFullscreen,
// document.exitFullscreen, document.fullscreenElement, fullscreenchange), so
// each test installs its own mock via the helpers in mocks.ts. This file is
// intentionally minimal — see mocks.ts for the controllable fakes.
