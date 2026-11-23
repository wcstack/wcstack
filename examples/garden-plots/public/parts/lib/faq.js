// みどり市 共通部品 — FAQ tree arithmetic (<faq-node> and the unit tests share it).

/** Normalizes text for searching: lower case, full-width ASCII folded to half-width, spaces trimmed. */
export function normalizeQuery(s) {
  return String(s ?? "")
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .trim()
    .toLowerCase();
}

/** Does a text contain the query? An empty query matches nothing (there is nothing to look for). */
export function textMatches(text, query) {
  const q = normalizeQuery(query);
  if (!q) return false;
  return normalizeQuery(text).includes(q);
}

/** Does a question (its q or its a) match? */
export function questionMatches(question, query) {
  return textMatches(question?.q, query) || textMatches(question?.a, query);
}

/** The number of questions in a node and below it. */
export function countQuestions(node) {
  return (node?.questions?.length ?? 0) + (node?.children ?? []).reduce((n, c) => n + countQuestions(c), 0);
}

/** The number of matching questions in a node and below it (a matching title counts its own questions). */
export function countMatches(node, query) {
  const own = textMatches(node?.title, query)
    ? (node?.questions?.length ?? 0)
    : (node?.questions ?? []).filter((q) => questionMatches(q, query)).length;
  return own + (node?.children ?? []).reduce((n, c) => n + countMatches(c, query), 0);
}

/** Every node of a tree, depth first, with its depth (1 = a top category). */
export function walk(nodes, depth = 1, out = []) {
  for (const n of nodes ?? []) {
    out.push({ node: n, depth });
    walk(n.children, depth + 1, out);
  }
  return out;
}
