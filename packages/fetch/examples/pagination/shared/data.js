/**
 * Shared mock dataset for the pagination examples.
 *
 * 200 deterministically-generated members — the SAME data is served to every
 * framework demo (React / Vue / state / signals / Vanilla), so the only thing
 * that differs between the examples is the front-end approach, never the data.
 */

const FIRST_NAMES = [
  "Ada", "Linus", "Grace", "Alan", "Margaret", "Dennis", "Barbara", "Tim",
  "Katherine", "Donald", "Edsger", "Hedy", "Claude", "Radia", "Vint", "Anita",
  "John", "Marie", "Ken", "Sophie",
];

const LAST_NAMES = [
  "Lovelace", "Torvalds", "Hopper", "Turing", "Hamilton", "Ritchie", "Liskov",
  "Berners-Lee", "Johnson", "Knuth", "Dijkstra", "Lamarr", "Shannon", "Perlman",
  "Cerf", "Borg", "Carmack", "Curie", "Thompson", "Wilson",
];

const ROLES = ["admin", "editor", "viewer"];

function buildEmail(first, last, id) {
  const local = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
  return `${local}${id}@example.com`;
}

/** 200 members, generated once at module load (stable across requests). */
export const MEMBERS = Array.from({ length: 200 }, (_, i) => {
  const id = i + 1;
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
  const name = `${first} ${last}`;
  const role = ROLES[i % ROLES.length];
  // Deterministic join date spread across 2023-2024.
  const year = 2023 + (i % 2);
  const month = (i % 12) + 1;
  const day = ((i * 3) % 28) + 1;
  const joinedAt = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { id, name, email: buildEmail(first, last, id), role, joinedAt };
});

/**
 * Page a list with 1-based page numbers. `page` is clamped to [1, totalPages]
 * so an out-of-range request still returns a valid (edge) page rather than 404.
 *
 * @returns {{ items: object[], page: number, limit: number, total: number, totalPages: number }}
 */
export function paginate(members, page, limit) {
  const total = members.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * limit;
  return {
    items: members.slice(start, start + limit),
    page: clampedPage,
    limit,
    total,
    totalPages,
  };
}
