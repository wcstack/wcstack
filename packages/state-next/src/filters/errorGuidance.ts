/**
 * filters/errorGuidance.ts — self-fix guidance embedded in error messages, ported verbatim from
 * `@wcstack/state` (`errorGuidance.ts`).
 *
 * Only the filter registry uses it today, which is why it lives here; nothing in it is specific to
 * filters, so it can move to a shared place once another diagnostic needs it. Everything here runs
 * on the error path only — the normal path pays nothing.
 *
 * The did-you-mean criteria (edit distance 2, ties go to the first candidate, case folded) are the
 * same as lint's suggestion, so the console, lint and the IDE never propose different names.
 */

/** Insert / delete / substitute edit distance. Returns max + 1 early when the lengths differ by more than max. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}

/**
 * The nearest candidate within edit distance 2 as ` Did you mean "<best>"?`, or `""` when there is
 * none. An empty input (a trailing `a|` pipe) gets no suggestion.
 */
export function didYouMean(input: string, candidates: Iterable<string>): string {
  if (input.length === 0) {
    return "";
  }
  const folded = input.toLowerCase();
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(folded, candidate.toLowerCase(), 2);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null ? ` Did you mean "${best}"?` : "";
}

/**
 * The pointer to lint. Attach it **only where lint actually detects the case** — a hint that sends
 * the author to a lint run that comes back clean costs the loop its credibility.
 */
export const LINT_HINT = " Validate statically: npx @wcstack/lint <file>.";
