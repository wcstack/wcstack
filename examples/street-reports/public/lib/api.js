// Thin, framework-free client for the JSON API.

export class ApiError extends Error {
  constructor(status, data) {
    super(`API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export const api = {
  staff: (opts) => request('/api/staff', opts),
  summary: (opts) => request('/api/reports/summary', opts),
  listReports: (params, opts) => request(`/api/reports${buildQuery(params)}`, opts),
  board: (opts) => request('/api/reports/board', opts),
  exportReports: (from, to, opts) => request(`/api/reports/export${buildQuery({ from, to })}`, opts),
  report: (id, opts) => request(`/api/reports/${id}`, opts),
  createReport: (payload) => request('/api/reports', { method: 'POST', body: payload }),
  patchReport: (id, version, patch) => request(`/api/reports/${id}`, { method: 'PATCH', body: { version, ...patch } }),
  bulkUpdate: (ids, patch) => request('/api/reports/bulk', { method: 'POST', body: { ids, patch } }),
  comments: (id, opts) => request(`/api/reports/${id}/comments`, opts),
  addComment: (id, authorId, body) => request(`/api/reports/${id}/comments`, { method: 'POST', body: { authorId, body } }),
};
