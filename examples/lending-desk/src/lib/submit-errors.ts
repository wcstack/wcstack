// A `422` names lines by their index at the time of sending ("lines.2.quantity"). The page keeps
// them by the line's key, so a message stays at its line after the user deletes a line above it.

export interface SubmitProblems {
  /** line key → message */
  byLine: Record<string, string>;
  purpose: string;
  pickupAt: string;
  /** a message for the whole form (no lines, an unknown field) */
  form: string;
}

export const NO_PROBLEMS: SubmitProblems = { byLine: {}, purpose: "", pickupAt: "", form: "" };

const FIELD_JA: Record<string, string> = { quantity: "数量", from: "開始日", to: "終了日", itemId: "備品" };

export function mapSubmitErrors(errors: Readonly<Record<string, string>>, sentKeys: readonly string[]): SubmitProblems {
  const out: SubmitProblems = { byLine: {}, purpose: "", pickupAt: "", form: "" };
  const extra: string[] = [];
  for (const [k, msg] of Object.entries(errors)) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(k);
    if (m) {
      const key = sentKeys[Number(m[1])];
      const field = FIELD_JA[m[2]!] ?? m[2]!;
      if (key) out.byLine[key] = out.byLine[key] ? `${out.byLine[key]} / ${field}: ${msg}` : `${field}: ${msg}`;
      else extra.push(msg);
    } else if (k === "purpose") out.purpose = msg;
    else if (k === "pickupAt") out.pickupAt = msg;
    else extra.push(msg);
  }
  out.form = extra.join(" ");
  return out;
}
