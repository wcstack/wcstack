// Setup file for Vitest.
//
// happy-dom implements neither navigator.mediaDevices (getUserMedia /
// enumerateDevices), MediaStream / MediaStreamTrack, nor MediaRecorder, so each
// test installs its own controllable fakes via the helpers in helpers.ts.
// This file is intentionally minimal — see helpers.ts for the fakes.
