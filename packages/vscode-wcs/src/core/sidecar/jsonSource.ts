/**
 * core/sidecar/jsonSource.ts
 *
 * 位置追跡付き JSON パーサ。`JSON.parse` は offset を失うため、manifest 診断が
 * 生ソース上の正確な range を持てるよう、各値と各キーの span を JSON pointer
 * (RFC6901 風 "/a/b/0"、root = "") で索く map を返す。IDE / CLI が同じ生テキストと
 * 同じ locator を使うため、range は必然的に一致する(§8 完了条件)。
 *
 * pure(DOM / vscode 非依存)。
 */

export interface JsonSpan {
  readonly start: number;
  readonly end: number;
  /** object member の場合、キー文字列の span(引用符を含む)。 */
  readonly keyStart?: number;
  readonly keyEnd?: number;
}

export interface ParsedJson {
  readonly value: unknown;
  readonly spans: ReadonlyMap<string, JsonSpan>;
  readonly error: { readonly offset: number; readonly message: string } | null;
}

class JsonReader {
  private pos = 0;
  readonly spans = new Map<string, JsonSpan>();
  constructor(private readonly text: string) {}

  parse(): { value: unknown } {
    this.skipWs();
    const value = this.parseValue("", undefined);
    this.skipWs();
    if (this.pos < this.text.length) {
      throw this.fail(`Unexpected trailing content`);
    }
    return { value };
  }

  private fail(message: string): Error {
    const err = new Error(message) as Error & { offset: number };
    err.offset = Math.min(this.pos, this.text.length);
    return err;
  }

  private skipWs(): void {
    while (this.pos < this.text.length) {
      const c = this.text.charCodeAt(this.pos);
      // space, tab, LF, CR
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else break;
    }
  }

  private parseValue(pointer: string, keySpan: { keyStart: number; keyEnd: number } | undefined): unknown {
    this.skipWs();
    const start = this.pos;
    const c = this.text[this.pos];
    let value: unknown;
    if (c === "{") value = this.parseObject(pointer);
    else if (c === "[") value = this.parseArray(pointer);
    else if (c === '"') value = this.parseString();
    else if (c === "t" || c === "f") value = this.parseKeyword();
    else if (c === "n") value = this.parseNull();
    else if (c === "-" || (c >= "0" && c <= "9")) value = this.parseNumber();
    else throw this.fail(`Unexpected character`);
    const end = this.pos;
    this.spans.set(pointer, keySpan === undefined ? { start, end } : { start, end, ...keySpan });
    return value;
  }

  private parseObject(pointer: string): Record<string, unknown> {
    this.pos++; // {
    const obj: Record<string, unknown> = {};
    this.skipWs();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return obj;
    }
    for (;;) {
      this.skipWs();
      if (this.text[this.pos] !== '"') throw this.fail(`Expected object key`);
      const keyStart = this.pos;
      const key = this.parseString();
      const keyEnd = this.pos;
      this.skipWs();
      if (this.text[this.pos] !== ":") throw this.fail(`Expected ':'`);
      this.pos++;
      const childPointer = `${pointer}/${escapePointer(key)}`;
      obj[key] = this.parseValue(childPointer, { keyStart, keyEnd });
      this.skipWs();
      const sep = this.text[this.pos];
      if (sep === ",") {
        this.pos++;
        continue;
      }
      if (sep === "}") {
        this.pos++;
        return obj;
      }
      throw this.fail(`Expected ',' or '}'`);
    }
  }

  private parseArray(pointer: string): unknown[] {
    this.pos++; // [
    const arr: unknown[] = [];
    this.skipWs();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return arr;
    }
    let index = 0;
    for (;;) {
      const childPointer = `${pointer}/${index}`;
      arr.push(this.parseValue(childPointer, undefined));
      index++;
      this.skipWs();
      const sep = this.text[this.pos];
      if (sep === ",") {
        this.pos++;
        continue;
      }
      if (sep === "]") {
        this.pos++;
        return arr;
      }
      throw this.fail(`Expected ',' or ']'`);
    }
  }

  private parseString(): string {
    this.pos++; // opening quote
    let result = "";
    for (;;) {
      if (this.pos >= this.text.length) throw this.fail(`Unterminated string`);
      const ch = this.text[this.pos++];
      if (ch === '"') return result;
      if (ch === "\\") {
        const esc = this.text[this.pos++];
        if (esc === '"') result += '"';
        else if (esc === "\\") result += "\\";
        else if (esc === "/") result += "/";
        else if (esc === "b") result += "\b";
        else if (esc === "f") result += "\f";
        else if (esc === "n") result += "\n";
        else if (esc === "r") result += "\r";
        else if (esc === "t") result += "\t";
        else if (esc === "u") {
          const hex = this.text.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.fail(`Invalid unicode escape`);
          result += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
        } else throw this.fail(`Invalid escape`);
      } else {
        result += ch;
      }
    }
  }

  private parseKeyword(): boolean {
    if (this.text.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    throw this.fail(`Invalid literal`);
  }

  private parseNull(): null {
    if (this.text.startsWith("null", this.pos)) {
      this.pos += 4;
      return null;
    }
    throw this.fail(`Invalid literal`);
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
    if (match === null) throw this.fail(`Invalid number`);
    this.pos += match[0].length;
    return Number(match[0]);
  }
}

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** RFC6901 pointer セグメントを組み立てる(呼び出し側が範囲索きに使う)。 */
export function pointer(...segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${escapePointer(String(s))}`).join("");
}

export function parseJsonWithSpans(text: string): ParsedJson {
  const reader = new JsonReader(text);
  try {
    const { value } = reader.parse();
    return { value, spans: reader.spans, error: null };
  } catch (e) {
    const offset = (e as { offset?: number }).offset ?? 0;
    return { value: undefined, spans: reader.spans, error: { offset, message: (e as Error).message } };
  }
}
