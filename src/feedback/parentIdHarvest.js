/**
 * Correlate collection-list GET responses with nested route parent IDs (bounded).
 * Used to seed OPENAPI_PARENT_SWAP with real sibling parent IDs seen earlier in the run.
 */

import { safeJsonParse, firstIdLikeFromObject } from '../state/handleExtract.js';

/**
 * @param {string} urlStr
 */
function pathnameOnly(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}

/**
 * Path contains a numeric or UUID-like segment (treat as item route, not a pure list path).
 *
 * @param {string} pathname
 */
export function pathHasDynamicSegment(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const s of segs) {
    if (/^\d+$/.test(s)) return true;
    if (
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize list path for bucketing (align `…/orders` with `…/orders/all`).
 *
 * @param {string} pathname
 */
export function collectionListPathKey(pathname) {
  let p = pathname.replace(/\/+$/, '') || '/';
  if (/\/all$/i.test(p)) {
    p = p.replace(/\/all$/i, '').replace(/\/+$/, '') || '/';
  }
  return p.toLowerCase();
}

/**
 * @param {string} bodyText
 * @param {number} maxRows
 * @returns {string[]}
 */
export function extractIdsFromCollectionRows(bodyText, maxRows = 24) {
  const parsed = safeJsonParse(bodyText.slice(0, 131072));
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const row of parsed.slice(0, maxRows)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const id = firstIdLikeFromObject(/** @type {Record<string, unknown>} */ (row));
    if (!id) continue;
    const s = String(id);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxRows) break;
  }
  return out;
}

/**
 * Harvest IDs from JSON array bodies on collection-list GETs (pathname has no id/uuid segments).
 *
 * @param {unknown[]} execResults
 * @param {{ maxPerKey?: number, maxIdsTotal?: number }} opts
 * @returns {Record<string, string[]>}
 */
export function harvestParentIdsByCollection(execResults, opts = {}) {
  const maxPerKey = Math.min(Math.max(4, opts.maxPerKey ?? 16), 48);
  const maxIdsTotal = Math.min(Math.max(8, opts.maxIdsTotal ?? 96), 256);

  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  let added = 0;

  for (const raw of execResults) {
    if (added >= maxIdsTotal) break;
    const r = /** @type {Record<string, unknown>} */ (raw);
    if (String(r.method || '').toUpperCase() !== 'GET') continue;
    if (r.error) continue;
    const st = r.status != null ? Number(r.status) : null;
    if (st == null || st < 200 || st >= 300) continue;

    const path = pathnameOnly(String(r.url || ''));
    if (!path || pathHasDynamicSegment(path)) continue;

    const body = String(r.bodyPreview ?? r.fullBody ?? '').trim();
    if (!body.startsWith('[')) continue;

    const ids = extractIdsFromCollectionRows(body, maxPerKey);
    if (!ids.length) continue;

    const key = collectionListPathKey(path);
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }

    for (const id of ids) {
      if (added >= maxIdsTotal) break;
      if (set.size >= maxPerKey) break;
      if (set.has(id)) continue;
      set.add(id);
      added++;
    }
  }

  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [k, set] of map) {
    out[k] = [...set];
  }
  return out;
}
