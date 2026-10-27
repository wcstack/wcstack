// A helper module the state imports by a relative specifier (the family-ledger shape).
export const total = (entries) => entries.reduce((sum, e) => sum + e.amount, 0);
