import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpeakCore } from "../src/core/SpeakCore";
import { ListenCore } from "../src/core/ListenCore";
import { anyListening } from "../src/core/listening";
import {
  installSpeechSynthesis, uninstallSpeechSynthesis, makeVoice,
  installSpeechRecognition, uninstallSpeechRecognition, removePermissions, FakeRecognition,
} from "./mocks";

describe("聞き取り中の読み上げ（[wcs/speech-echo]）", () => {
  let recs: FakeRecognition[];

  beforeEach(() => {
    installSpeechSynthesis([makeVoice({ name: "Alice", lang: "en-US" })]);
    recs = installSpeechRecognition();
    removePermissions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallSpeechSynthesis();
    uninstallSpeechRecognition();
    removePermissions();
  });

  function said(warn: ReturnType<typeof vi.spyOn>): unknown[][] {
    return warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("[wcs/speech-echo]"));
  }

  it("<wcs-listen> が聞いている間に話し始めると、要素を添えて 1 回だけ警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listen = new ListenCore();
    listen.start();
    recs[0].fireStart();
    expect(anyListening()).toBe(true);
    const target = new EventTarget();
    const speak = new SpeakCore(target);
    speak.speak("one");
    speak.speak("two");
    expect(said(warn)).toHaveLength(1);
    expect(String(said(warn)[0][0])).toContain("bind manual to the listening flag");
    expect(said(warn)[0][1]).toBe(target);
    listen.dispose();
  });

  it("聞き終えた後（stop・dispose）の読み上げは警告しない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listen = new ListenCore();
    listen.start();
    recs[0].fireStart();
    listen.dispose();
    expect(anyListening()).toBe(false);
    new SpeakCore().speak("after");
    expect(said(warn)).toHaveLength(0);
  });

  it("聞いていなければ警告しない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new SpeakCore().speak("alone");
    expect(said(warn)).toHaveLength(0);
  });
});
