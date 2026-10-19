import { describe, it, expect } from "vitest";
import { beginRecording, endRecording, isRecording } from "../src/media/recording";
import { FakeMediaStream } from "./helpers";

describe("録画中のストリームの台帳", () => {
  it("2 つの録画が同じストリームを撮るとき、両方が終わるまで録画中のまま", () => {
    const stream = new FakeMediaStream("shared") as unknown as MediaStream;
    beginRecording(stream);
    beginRecording(stream);
    endRecording(stream);
    expect(isRecording(stream)).toBe(true);
    endRecording(stream);
    expect(isRecording(stream)).toBe(false);
  });

  it("始まっていない録画の終わりは何もしない", () => {
    const stream = new FakeMediaStream("never") as unknown as MediaStream;
    endRecording(stream);
    expect(isRecording(stream)).toBe(false);
  });
});
