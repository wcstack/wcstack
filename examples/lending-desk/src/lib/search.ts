// The search lives in the URL: query ↔ form, the API url, the page links. Pure, unit-tested.

import type { ItemSort } from "../../shared/api.ts";
import { isIsoDate } from "../../shared/dates.ts";

export interface SearchForm {
  q: string;
  category: string;
  center: string;
  from: string;
  to: string;
  sort: ItemSort;
}

export const PER_PAGE = 20;

export const EMPTY_SEARCH: SearchForm = { q: "", category: "", center: "", from: "", to: "", sort: "name" };

export function formFromQuery(query: Readonly<Record<string, string>>): SearchForm {
  return {
    q: query.q ?? "",
    category: query.category ?? "",
    center: query.center ?? "",
    from: isIsoDate(query.from) ? query.from : "",
    to: isIsoDate(query.to) ? query.to : "",
    sort: query.sort === "deposit" ? "deposit" : "name",
  };
}

export function pageFromQuery(query: Readonly<Record<string, string>>): number {
  const n = Number(query.page ?? 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** "?q=…&center=2&page=2" — only what is set, in a stable order; "?" when nothing is. */
export function searchHref(form: SearchForm, page = 1): string {
  const p = new URLSearchParams();
  if (form.q.trim()) p.set("q", form.q.trim());
  if (form.category) p.set("category", form.category);
  if (form.center) p.set("center", form.center);
  if (form.from) p.set("from", form.from);
  if (form.to) p.set("to", form.to);
  if (form.sort !== "name") p.set("sort", form.sort);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "?";
}

/** Has the period both ends, in order? Only then does the server count what is free. */
export function hasPeriod(form: Pick<SearchForm, "from" | "to">): boolean {
  return form.from !== "" && form.to !== "" && form.from <= form.to;
}

export function itemsApiUrl(form: SearchForm, page: number, delay?: string): string {
  const p = new URLSearchParams();
  if (form.q.trim()) p.set("q", form.q.trim());
  if (form.category) p.set("category", form.category);
  if (form.center) p.set("center", form.center);
  if (hasPeriod(form)) { p.set("from", form.from); p.set("to", form.to); }
  p.set("sort", form.sort);
  p.set("page", String(page));
  p.set("per", String(PER_PAGE));
  if (delay && /^\d+$/.test(delay)) p.set("delay", delay);
  return `/api/items?${p.toString()}`;
}

export interface PageLink {
  n: number;
  href: string;
  current: boolean;
  label: string;
}

export function pageLinks(form: SearchForm, total: number, page: number): PageLink[] {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const out: PageLink[] = [];
  for (let n = 1; n <= pages; n++) out.push({ n, href: `/${searchHref(form, n)}`, current: n === page, label: String(n) });
  return out;
}

export function sameSearch(a: SearchForm, b: SearchForm): boolean {
  return a.q.trim() === b.q.trim() && a.category === b.category && a.center === b.center && a.from === b.from && a.to === b.to && a.sort === b.sort;
}
