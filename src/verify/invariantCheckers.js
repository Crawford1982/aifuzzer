/**
 * Stateful-ish invariant checks over the ordered execution log (no LLM).
 */

import { fingerprintBody } from './baseline.js';
import { checkNamespacePrincipalOverlap } from './namespaceReplay.js';

/**
 * @param {unknown} x
 */
function row(x) {
  return /** @type {Record<string, unknown>} */ (x);
}

/**
 * @param {string} urlStr
 */
function pathnameOnly(urlStr) {
  try {
    const u = new URL(urlStr);
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p;
  } catch {
    return '';
  }
}

/**
 * Collection path for POST /collection — last segment static collection name.
 *
 * @param {string} urlStr
 */
export function collectionPathForMutating(urlStr) {
  return pathnameOnly(urlStr);
}

/**
 * POST 4xx then GET list 200 with non-empty JSON array — RESTler leakage analogue (heuristic).
 *
 * @param {unknown[]} execResults
 */
export function checkLeakAfterFailedCreate(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (let i = 0; i < execResults.length; i++) {
    const a = row(execResults[i]);
    const method = String(a.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) continue;
    const st = a.status != null ? Number(a.status) : null;
    if (st == null || st < 400 || st > 499) continue;

    const postPath = collectionPathForMutating(String(a.url || ''));
    if (!postPath) continue;

    const windowEnd = Math.min(execResults.length, i + 48);
    for (let j = i + 1; j < windowEnd; j++) {
      const b = row(execResults[j]);
      if (String(b.method || 'GET').toUpperCase() !== 'GET') continue;
      if (Number(b.status) !== 200) continue;
      const getPath = pathnameOnly(String(b.url || ''));
      if (getPath !== postPath) continue;

      const body = String(b.bodyPreview || '').trim();
      if (!body.startsWith('[')) continue;
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.length > 0) {
          out.push({
            checkerId: 'leak_after_failed_create',
            severity: 'medium',
            title: 'Possible create/list leakage',
            detail: `After ${method} ${st} on ${postPath}, GET ${getPath} returned 200 with non-empty array (${parsed.length} items).`,
            evidenceCaseIds: [a.caseId, b.caseId],
            caseId: a.caseId,
            url: b.url,
          });
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

/**
 * DELETE 2xx then GET same resource 2xx with body.
 *
 * @param {unknown[]} execResults
 */
export function checkDeleteStillReadable(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (let i = 0; i < execResults.length; i++) {
    const a = row(execResults[i]);
    if (String(a.method || '').toUpperCase() !== 'DELETE') continue;
    const st = a.status != null ? Number(a.status) : null;
    if (st == null || st < 200 || st >= 300) continue;
    const delPath = pathnameOnly(String(a.url || ''));
    if (!delPath) continue;

    const windowEnd = Math.min(execResults.length, i + 48);
    for (let j = i + 1; j < windowEnd; j++) {
      const b = row(execResults[j]);
      if (String(b.method || '').toUpperCase() !== 'GET') continue;
      const stb = b.status != null ? Number(b.status) : null;
      if (stb == null || stb < 200 || stb >= 300) continue;
      if (pathnameOnly(String(b.url || '')) !== delPath) continue;
      if (!b.bodyPreview || String(b.bodyPreview).length < 3) continue;

      out.push({
        checkerId: 'delete_still_readable',
        severity: 'medium',
        title: 'Resource still readable after DELETE',
        detail: `DELETE ${st} then GET ${stb} on ${delPath} returned a body — verify deletion semantics.`,
        evidenceCaseIds: [a.caseId, b.caseId],
        caseId: b.caseId,
        url: b.url,
      });
      break;
    }
  }

  return out;
}

/**
 * Query keys Mythos adds for info-disclosure / pattern probes only.
 * Two URLs that differ only by these (plus equivalent remaining params) are the
 * same logical resource for hierarchy / BOLA heuristics — not distinct parents.
 */
const PROBE_ONLY_QUERY_KEYS = new Set(['debug', 'trace', 'verbose', '__debug']);

/**
 * Stable URL string for deduping: pathname + sorted query with probe keys removed.
 *
 * @param {string} urlStr
 */
export function canonicalUrlForHierarchyCompare(urlStr) {
  try {
    const u = new URL(urlStr);
    /** @type {Array<[string, string]>} */
    const kept = [];
    u.searchParams.forEach((value, key) => {
      if (!PROBE_ONLY_QUERY_KEYS.has(key.toLowerCase())) {
        kept.push([key, value]);
      }
    });
    kept.sort((a, b) => a[0].localeCompare(b[0]));
    const out = new URL(u.origin + u.pathname);
    for (const [k, v] of kept) {
      out.searchParams.append(k, v);
    }
    return out.toString();
  } catch {
    return urlStr;
  }
}

/**
 * Normalize path: numeric and UUID segments → placeholders for grouping.
 *
 * @param {string} pathname
 */
export function normalizedPathTemplate(pathname) {
  return pathname
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?=\/|$)/gi, '/{uuid}');
}

/**
 * Skip hierarchy checker on empty shells / identical public list plumbing (reduces FP on read-only APIs).
 *
 * @param {string} text
 */
export function isTrivialPublicPayload(text) {
  const t = text.trim();
  if (t.length < 48) return true;
  if (/^\[\s*\]\s*$/.test(t)) return true;
  if (/^\{\s*\}\s*$/.test(t)) return true;
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j) && j.length === 0) return true;
    if (
      Array.isArray(j) &&
      j.length > 0 &&
      j.length <= 3 &&
      j.every((row) => row && typeof row === 'object' && Object.keys(row).length <= 3)
    ) {
      const keys = new Set();
      for (const row of j) {
        if (row && typeof row === 'object') {
          for (const k of Object.keys(row)) keys.add(k);
        }
      }
      if (keys.size <= 3 && keys.has('id')) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Same normalized GET template, different concrete paths, both 200, identical body fingerprint.
 *
 * @param {unknown[]} execResults
 */
export function checkResourceHierarchyCrossParent(execResults) {
  /** @type {Map<string, { fp: string, url: string, caseId: unknown }[]>} */
  const buckets = new Map();

  for (const r of execResults) {
    const o = row(r);
    if (String(o.method || '').toUpperCase() !== 'GET') continue;
    const st = o.status != null ? Number(o.status) : null;
    if (st !== 200) continue;
    const p = pathnameOnly(String(o.url || ''));
    if (!p) continue;
    const tmpl = normalizedPathTemplate(p);
    const key = `GET:${tmpl}`;
    const prev = String(o.bodyPreview || '');
    if (prev.length < 64) continue;
    if (isTrivialPublicPayload(prev)) continue;
    const fp = fingerprintBody(prev);
    if (!fp) continue;

    const list = buckets.get(key) || [];
    list.push({ fp, url: String(o.url), caseId: o.caseId });
    buckets.set(key, list);
  }

  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const [, rows] of buckets) {
    if (rows.length < 2) continue;
    /** @type {Map<string, typeof rows>} */
    const byFp = new Map();
    for (const row of rows) {
      const g = byFp.get(row.fp) || [];
      g.push(row);
      byFp.set(row.fp, g);
    }
    for (const [, group] of byFp) {
      const distinctCanonical = [
        ...new Set(group.map((x) => canonicalUrlForHierarchyCompare(String(x.url)))),
      ];
      if (distinctCanonical.length < 2) continue;
      out.push({
        checkerId: 'resource_hierarchy_cross_parent',
        severity: 'high',
        title: 'Identical GET bodies for different URLs (possible BOLA)',
        detail: `Same body fingerprint across: ${distinctCanonical.slice(0, 4).join(' | ')}${distinctCanonical.length > 4 ? ' …' : ''}`,
        evidenceCaseIds: group.map((x) => x.caseId),
        caseId: group[0].caseId,
        url: group[0].url,
      });
      break;
    }
  }

  return out;
}

/**
 * @param {unknown[]} execResults
 */
export function runInvariantCheckers(execResults) {
  return [
    ...checkLeakAfterFailedCreate(execResults),
    ...checkDeleteStillReadable(execResults),
    ...checkResourceHierarchyCrossParent(execResults),
    ...checkNamespacePrincipalOverlap(execResults),
  ];
}

