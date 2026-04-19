/**
 * Milestone D — baseline fingerprints per canonical route (deterministic).
 */

import crypto from 'crypto';

/**
 * @param {string} text
 */
export function normalizeBodyForFingerprint(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 16000);
}

/**
 * @param {string} text
 */
export function fingerprintBody(text) {
  const n = normalizeBodyForFingerprint(text);
  return crypto.createHash('sha256').update(n).digest('hex').slice(0, 24);
}

/**
 * @param {string} method
 * @param {string} url
 */
export function canonicalRouteKey(method, url) {
  try {
    const u = new URL(url);
    return `${String(method || 'GET').toUpperCase()}:${u.pathname}`;
  } catch {
    return `${method}:${url}`;
  }
}

/**
 * First successful baseline-ish response per route (OPENAPI_BASELINE / BASELINE families).
 *
 * @param {unknown[]} results
 * @returns {Map<string, string>}
 */
export function buildBaselineFingerprints(results) {
  /** @type {Map<string, string>} */
  const map = new Map();

  for (const r of results) {
    const row = /** @type {Record<string, unknown>} */ (r);
    const fam = String(row.family || '');
    if (fam !== 'OPENAPI_BASELINE' && fam !== 'BASELINE') continue;
    if (!row.status || Number(row.status) >= 400) continue;
    const method = String(row.method || 'GET');
    const url = String(row.url || '');
    const key = canonicalRouteKey(method, url);
    if (map.has(key)) continue;
    map.set(key, fingerprintBody(String(row.bodyPreview || '')));
  }

  return map;
}
