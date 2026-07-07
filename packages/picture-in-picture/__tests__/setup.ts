// Setup file for Vitest.
//
// happy-dom does not implement the Picture-in-Picture API
// (HTMLVideoElement.prototype.requestPictureInPicture,
// document.exitPictureInPicture/pictureInPictureElement, or
// enterpictureinpicture/leavepictureinpicture events), so each test installs
// its own controllable fake via the helpers in mocks.ts. This file is
// intentionally minimal — see mocks.ts for the fakes.
