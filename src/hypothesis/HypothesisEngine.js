/**
 * Layer 3 — Hypothesis generation (pattern-driven for v0.1)
 */

/**
 * @typedef {{
 *   id: string,
 *   method: string,
 *   url: string,
 *   headers: Record<string,string>,
 *   omitAuth?: boolean,
 *   family: string,
 *   meta?: { query?: Record<string, string>, jsonBody?: unknown, contentType?: string },
 * }} FuzzCase
 */

const ID_VALUES = [1, 2, 3, 10, 42, 99, 1000, 'admin', 'root', '00000000-0000-0000-0000-000000000001'];

/**
 * @param {string} targetUrl
 * @param {{ maxRequests: number }} opts
 * @returns {FuzzCase[]}
 */
export function expandPatterns(targetUrl, opts) {
  /** @type {FuzzCase[]} */
  const cases = [];
  const cap = () => cases.length >= opts.maxRequests;

  const hasTemplate = /\{id\}/i.test(targetUrl);
  const canonical = hasTemplate ? targetUrl.replace(/\{id\}/gi, '1').replace(/\{ID\}/g, '1') : targetUrl;

  if (hasTemplate) {
    for (const id of ID_VALUES) {
      if (cap()) return cases;
      const enc = encodeURIComponent(String(id));
      const url = targetUrl.replace(/\{id\}/gi, enc).replace(/\{ID\}/g, enc);
      cases.push({
        id: `idor_path:${id}`,
        method: 'GET',
        url,
        headers: {},
        family: 'IDOR_PATH',
        meta: { id },
      });
    }
    if (!cap()) {
      try {
        const u = new URL(canonical);
        cases.push({
          id: 'idor_query_override',
          method: 'GET',
          url: u.origin + u.pathname,
          headers: {},
          family: 'IDOR_QUERY',
          meta: { query: { user_id: '2', id: '3' } },
        });
      } catch {
        /* ignore */
      }
    }
  } else {
    try {
      const u = new URL(targetUrl);
      const segments = u.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      const numeric = last && /^\d+$/.test(last);
      if (numeric && segments.length >= 1) {
        const prefix = '/' + segments.slice(0, -1).join('/');
        for (const id of ID_VALUES) {
          if (cap()) return cases;
          const url = `${u.origin}${prefix}/${encodeURIComponent(String(id))}`;
          cases.push({
            id: `idor_suffix:${id}`,
            method: 'GET',
            url,
            headers: {},
            family: 'IDOR_PATH',
            meta: { id },
          });
        }
      } else {
        cases.push({
          id: 'baseline',
          method: 'GET',
          url: targetUrl,
          headers: {},
          family: 'BASELINE',
        });
      }
    } catch {
      cases.push({
        id: 'baseline',
        method: 'GET',
        url: targetUrl,
        headers: {},
        family: 'BASELINE',
      });
    }
  }

  const infoQueries = [{ debug: 'true' }, { trace: '1' }, { verbose: 'true' }, { __debug: '1' }];
  for (const q of infoQueries) {
    if (cap()) return cases;
    cases.push({
      id: `info:${Object.keys(q)[0]}`,
      method: 'GET',
      url: withQuery(canonical, q),
      headers: {},
      family: 'INFO_DISCLOSURE',
      meta: { query: q },
    });
  }

  return cases.slice(0, opts.maxRequests);
}

/**
 * @param {string} targetUrl
 * @param {{ maxRequests: number, hasAuth: boolean }} opts
 */
export function expandAuthPatterns(targetUrl, opts) {
  if (!opts.hasAuth) return [];

  const canonical = /\{id\}/i.test(targetUrl)
    ? targetUrl.replace(/\{id\}/gi, '1').replace(/\{ID\}/g, '1')
    : targetUrl;

  /** @type {FuzzCase[]} */
  const cases = [
    {
      id: 'auth:missing',
      method: 'GET',
      url: canonical,
      headers: {},
      omitAuth: true,
      family: 'AUTH_BYPASS',
    },
    {
      id: 'auth:invalid_bearer',
      method: 'GET',
      url: canonical,
      headers: { Authorization: 'Bearer recon-invalid-token' },
      family: 'AUTH_BYPASS',
    },
  ];

  return cases.slice(0, opts.maxRequests);
}

function withQuery(url, obj) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(obj)) u.searchParams.set(k, v);
  return u.toString();
}
