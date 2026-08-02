import { describe, it, expect } from "vitest";
import { parseMessage, MIDI_MESSAGE_TYPES } from "../src/midi/parseMessage";

describe("parseMessage", () => {
  describe("チャンネルボイスメッセージ", () => {
    it("note on を type=noteon で返し velocity を 0-1 に正規化する", () => {
      const parsed = parseMessage([0x90, 60, 127]);
      expect(parsed.type).toBe("noteon");
      expect(parsed.channel).toBe(1);
      expect(parsed.note).toBe(60);
      expect(parsed.velocity).toBe(1);
      expect(parsed.control).toBeNull();
      expect(parsed.value).toBeNull();
    });

    it("note off（0x8n）を type=noteoff で返しリリースベロシティも正規化する", () => {
      const parsed = parseMessage([0x80, 60, 64]);
      expect(parsed.type).toBe("noteoff");
      expect(parsed.note).toBe(60);
      expect(parsed.velocity).toBeCloseTo(64 / 127);
    });

    it("velocity 0 の note on は noteoff に正規化される（stuck note の防止）", () => {
      const parsed = parseMessage([0x90, 60, 0]);
      expect(parsed.type).toBe("noteoff");
      expect(parsed.note).toBe(60);
      expect(parsed.velocity).toBe(0);
    });

    it("チャンネルは 1 始まりで返る（status の下位ニブル + 1）", () => {
      expect(parseMessage([0x90, 60, 100]).channel).toBe(1);
      expect(parseMessage([0x9f, 60, 100]).channel).toBe(16);
      expect(parseMessage([0x87, 60, 100]).channel).toBe(8);
    });

    it("polyphonic aftertouch は note と value を持つ", () => {
      const parsed = parseMessage([0xa2, 64, 90]);
      expect(parsed.type).toBe("polyaftertouch");
      expect(parsed.channel).toBe(3);
      expect(parsed.note).toBe(64);
      expect(parsed.value).toBe(90);
      expect(parsed.velocity).toBeNull();
    });

    it("control change は control と value を生の 0-127 で返す", () => {
      const parsed = parseMessage([0xb0, 7, 100]);
      expect(parsed.type).toBe("controlchange");
      expect(parsed.control).toBe(7);
      expect(parsed.value).toBe(100);
      expect(parsed.note).toBeNull();
    });

    it("program change は value にプログラム番号を持つ", () => {
      const parsed = parseMessage([0xc1, 42]);
      expect(parsed.type).toBe("programchange");
      expect(parsed.channel).toBe(2);
      expect(parsed.value).toBe(42);
    });

    it("channel aftertouch は value に圧力を持つ", () => {
      const parsed = parseMessage([0xd0, 77]);
      expect(parsed.type).toBe("aftertouch");
      expect(parsed.value).toBe(77);
    });

    it("pitch bend は 14bit を -1..1 に正規化する（中央=0）", () => {
      expect(parseMessage([0xe0, 0x00, 0x40]).value).toBe(0);
      expect(parseMessage([0xe0, 0x00, 0x00]).value).toBe(-1);
      expect(parseMessage([0xe0, 0x7f, 0x7f]).value).toBeCloseTo(1, 3);
      expect(parseMessage([0xe0, 0x00, 0x40]).type).toBe("pitchbend");
    });
  });

  describe("システムメッセージ", () => {
    it("0xF0 は sysex・channel は null", () => {
      const parsed = parseMessage([0xf0, 0x7e, 0x00, 0xf7]);
      expect(parsed.type).toBe("sysex");
      expect(parsed.channel).toBeNull();
    });

    it("0xF8（クロック）等その他のシステムメッセージは other", () => {
      expect(parseMessage([0xf8]).type).toBe("other");
      expect(parseMessage([0xfe]).type).toBe("other");
      expect(parseMessage([0xf8]).channel).toBeNull();
    });
  });

  describe("never-throw（不正な入力）", () => {
    it("空配列は throw せず全フィールド null の other を返す", () => {
      const parsed = parseMessage([]);
      expect(parsed.type).toBe("other");
      expect(parsed.channel).toBeNull();
      expect(parsed.note).toBeNull();
    });

    it("status バイトの位置にデータバイト（<0x80）が来ても other を返す", () => {
      const parsed = parseMessage([0x40, 60, 100]);
      expect(parsed.type).toBe("other");
      expect(parsed.channel).toBeNull();
    });

    it("データバイトが欠けていても 0 として扱う", () => {
      const parsed = parseMessage([0x90]);
      expect(parsed.type).toBe("noteoff");
      expect(parsed.note).toBe(0);
      expect(parsed.velocity).toBe(0);
    });

    it("Uint8Array でも number[] でも同じ結果になる", () => {
      expect(parseMessage(new Uint8Array([0x90, 60, 127]))).toEqual(parseMessage([0x90, 60, 127]));
    });
  });

  it("MIDI_MESSAGE_TYPES は全メッセージ種別を列挙する", () => {
    expect(MIDI_MESSAGE_TYPES).toContain("noteon");
    expect(MIDI_MESSAGE_TYPES).toContain("pitchbend");
    expect(MIDI_MESSAGE_TYPES).toHaveLength(9);
  });
});
