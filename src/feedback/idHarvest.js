/**
 * Milestone G — live ID harvesting from execution results for IDOR seeding.
 * Reuses handle extraction logic from src/state/handleExtract.js.
 * Only considers successful (2xx) non-error responses so garbage from error
 * bodies doesn't pollute the IDOR seed pool.
 */

import {
  safeJsonParse,
  extractIdFromCollectionFirst,
  extractIdFromResource,
} from '../state/handleExtract.js';

/** UUID pattern for regex-based supplement scan. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Extract ID-like string values from a single JSON body text.
 * Combines structured extraction (using handleExtract helpers) with UUID regex
 * scanning for nested / deeply embedded identifiers.
 *
 * @param {string} bodyText
 * @returns {string[]}
 */
export function extractIdsFromBody(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return [];

  /** @type {Set<string>} */
  const ids = new Set();

  const parsed = safeJsonParse(bodyText.slice(0, 131072)); // cap JSON parse at 128 KB
  if (parsed !== null) {
    if (Array.isArray(parsed)) {
      // Collection response — walk up to 32 items
      for (const item of parsed.slice(0, 32)) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const id = extractIdFromCollectionFirst([item]);
        if (id && String(id).length <= 128) ids.add(String(id));
      }
    } else if (parsed && typeof parsed === 'object') {
      // Single resource
      const id = extractIdFromResource(parsed);
      if (id && String(id).length <= 128) ids.add(String(id));

      // Also inspect one level of nested objects (e.g. { data: { id: 5 } })
      for (const v of Object.values(/** @type {Record<string, unknown>} */ (parsed))) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        const nestedId = extractIdFromResource(v);
        if (nestedId && String(nestedId).length <= 128) ids.add(String(nestedId));
      }
    }
  }

  // UUID regex supplement — catches identifiers missed by key-name heuristics
  const uuids = bodyText.match(UUID_RE) || [];
  for (const uuid of uuids.slice(0, 16)) {
    ids.add(uuid.toLowerCase());
  }

  return [...ids];
}

/**
 * Harvest live IDs from a batch of execution results for use as additional
 * IDOR seeds in subsequent flat case expansion.
 *
 * Only 2xx non-error results are considered. Returns a deduped, capped list
 * safe to merge directly into the wordlist seed pool.
 *
 * @param {unknown[]} execResults
 * @param {{ maxIds?: number }} opts
 * @returns {string[]}
 */
export function harvestIdsFromResults(execResults, opts = {}) {
  const maxIds = Math.min(Math.max(4, opts.maxIds ?? 48), 256);
  /** @type {Set<string>} */
  const seen = new Set();

  for (const raw of execResults) {
    if (seen.size >= maxIds) break;
    const r = /** @type {Record<string, unknown>} */ (raw);
    if (r.error) continue;
    const st = r.status != null ? Number(r.status) : null;
    if (st == null || st < 200 || st >= 300) continue;

    const body = String(r.bodyPreview ?? r.fullBody ?? '').trim();
    if (!body) continue;

    for (const id of extractIdsFromBody(body)) {
      if (seen.size >= maxIds) break;
      seen.add(id);
    }
  }

  return [...seen];
}
