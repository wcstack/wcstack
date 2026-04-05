export interface SseEvent {
  event?: string;
  data: string;
}

export class SseParser {
  private _buffer: string = "";
  private _currentEvent: string | undefined = undefined;
  private _currentData: string[] = [];

  feed(chunk: string): SseEvent[] {
    this._buffer += chunk;
    const results: SseEvent[] = [];

    const lines = this._buffer.split("\n");
    this._buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");

      if (line.startsWith(":")) {
        // SSE comment, ignore
        continue;
      }

      if (line.startsWith("event:")) {
        this._currentEvent = (line.startsWith("event: ") ? line.slice(7) : line.slice(6)).trim();
      } else if (line.startsWith("data:")) {
        const value = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
        this._currentData.push(value);
      } else if (line === "" && this._currentData.length > 0) {
        results.push({
          event: this._currentEvent,
          data: this._currentData.join("\n"),
        });
        this._currentEvent = undefined;
        this._currentData = [];
      }
    }

    return results;
  }
}
