// みどり市 共通部品 — the rules <tenant-editor> checks before anything is sent (the server checks again).

export const FIELDS = ["name", "phone", "postal", "address"];

/**
 * The client-side messages for a person (tenant or applicant).
 * @param {{ name?: string, phone?: string, postal?: string }} t
 * @returns {{ name?: string, phone?: string, postal?: string }}
 */
export function validateTenant(t) {
  const errors = {};
  const name = String(t?.name ?? "").trim();
  if (!name) errors.name = "氏名は必須です";
  else if (name.length > 40) errors.name = "氏名は 40 文字までです";
  const phone = String(t?.phone ?? "");
  if (phone && !/^[0-9-]+$/.test(phone)) errors.phone = "電話番号は数字とハイフンで入力してください";
  const postal = String(t?.postal ?? "");
  if (postal && !/^\d{3}-?\d{4}$/.test(postal)) errors.postal = "郵便番号は 7 桁で入力してください";
  return errors;
}

/** Does the person differ from its last saved copy? With no saved copy, any field filled in counts. */
export function isDirty(t, saved) {
  if (!t) return false;
  if (!saved) return FIELDS.some((f) => String(t[f] ?? "") !== "");
  return FIELDS.some((f) => String(t[f] ?? "") !== String(saved[f] ?? ""));
}

/** The plain person the API takes. */
export function personOf(t) {
  return { name: String(t?.name ?? "").trim(), phone: String(t?.phone ?? ""), postal: String(t?.postal ?? ""), address: String(t?.address ?? "") };
}

/**
 * A person ready to be handed to <tenant-editor>: the fields, the last saved copy and no server messages.
 * @param {object | null} p
 */
export function editable(p) {
  if (!p) return null;
  const person = personOf(p);
  return { ...p, ...person, saved: { ...person }, errors: {} };
}

/** Server field errors ("tenant.name" / "name") as the editor's { name, phone, postal }. */
export function fieldErrors(errors, prefix = "") {
  const out = {};
  for (const f of ["name", "phone", "postal", "address"]) {
    const m = errors?.[`${prefix}${f}`];
    if (m) out[f] = m;
  }
  return out;
}
