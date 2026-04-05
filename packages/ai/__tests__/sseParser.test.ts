import { describe, it, expect } from "vitest";
import { SseParser } from "../src/streaming/SseParser";

describe("SseParser", () => {
  it("単一のdataイベントをパースできる", () => {
    const parser = new SseParser();
    const events = parser.feed('data: {"text":"hello"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"text":"hello"}');
    expect(events[0].event).toBeUndefined();
  });

  it("複数のdataイベントをパースできる", () => {
    const parser = new SseParser();
    const events = parser.feed('data: first\n\ndata: second\n\n');
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("first");
    expect(events[1].data).toBe("second");
  });

  it("eventタイプを追跡できる", () => {
    const parser = new SseParser();
    const events = parser.feed('event: message_start\ndata: {"type":"message_start"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message_start");
    expect(events[0].data).toBe('{"type":"message_start"}');
  });

  it("eventタイプはディスパッチ後にリセットされる", () => {
    const parser = new SseParser();
    const events = parser.feed('event: custom\ndata: first\n\ndata: second\n\n');
    expect(events[0].event).toBe("custom");
    expect(events[1].event).toBeUndefined();
  });

  it("チャンク分割されたデータを正しく処理する", () => {
    const parser = new SseParser();
    const events1 = parser.feed('data: hel');
    expect(events1).toHaveLength(0);
    const events2 = parser.feed('lo\n\n');
    expect(events2).toHaveLength(1);
    expect(events2[0].data).toBe("hello");
  });

  it("コメント行を無視する", () => {
    const parser = new SseParser();
    const events = parser.feed(': keepalive\ndata: hello\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });

  it("\\r\\nの改行を処理できる", () => {
    const parser = new SseParser();
    const events = parser.feed('data: hello\r\n\r\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });

  it("data:の後にスペースがない形式も処理できる", () => {
    const parser = new SseParser();
    const events = parser.feed('data:hello\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });

  it("event:の後にスペースがない形式も処理できる", () => {
    const parser = new SseParser();
    const events = parser.feed('event:custom\ndata: test\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("custom");
  });

  it("複数行のdataを結合する", () => {
    const parser = new SseParser();
    const events = parser.feed('data: line1\ndata: line2\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("line1\nline2");
  });

  it("データなしの空行は無視する", () => {
    const parser = new SseParser();
    const events = parser.feed('\n\ndata: hello\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });

  it("[DONE]メッセージをパースできる", () => {
    const parser = new SseParser();
    const events = parser.feed('data: [DONE]\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("[DONE]");
  });
});
