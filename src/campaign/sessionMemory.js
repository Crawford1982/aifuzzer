/**
 * Bounded "dynamic learner" — session-local route statistics + interest scoring.
 * No LLM; priorities namespace replay and future caps. Optional JSON persistence is tiny + capped.
 */

import { canonicalRouteKey } from '../verify/baseline.js';

/**
 * @param {unknown[]} execResults
 * @returns {Map<string, number>}
 */
export function buildRouteInterestScores(execResults) {
  /** @type {Map<string, number>} */
  const scores = new Map();

  for (const raw of execResults) {
    const r = /** @type {Record<string, unknown>} */ (raw);
    if (String(r.caseId || '').includes(':authAlt')) continue;

    const method = String(r.method || 'GET');
    const url = String(r.url || '');
    const key = canonicalRouteKey(method, url);
    let s = scores.get(key) || 0;
    const st = r.status != null ? Number(r.status) : null;
    if (r.error) s += 60;
    else if (st != null && st >= 500) s += 100;
    else if (st != null && st >= 400) s += 25;
    scores.set(key, s);
  }

  return scores;
}

/**
 * Compact summary for reports / optional persistence merge.
 *
 * @param {unknown[]} execResults
 */
export function buildSessionSummary(execResults) {
  /** @type {Record<string, { samples: number, statusMax: number, errors: number }>} */
  const routes = {};

  for (const raw of execResults) {
    const r = /** @type {Record<string, unknown>} */ (raw);
    if (String(r.caseId || '').includes(':authAlt')) continue;

    const method = String(r.method || 'GET');
    const url = String(r.url || '');
    const key = canonicalRouteKey(method, url);
    const cur = routes[key] || { samples: 0, statusMax: 0, errors: 0 };
    cur.samples += 1;
    const st = r.status != null ? Number(r.status) : null;
    if (st != null) cur.statusMax = Math.max(cur.statusMax, st);
    if (r.error) cur.errors += 1;
    routes[key] = cur;
  }

  return {
    format: 'mythos-session-memory',
    version: 1,
    routeCount: Object.keys(routes).length,
    routes,
  };
}

/**
 * Merge persisted memory with this session (bounded keys).
 *
 * @param {Record<string, unknown> | null} existing
 * @param {ReturnType<typeof buildSessionSummary>} snapshot
 * @param {{ maxRoutes?: number }} opts
 */
export function mergeCampaignMemory(existing, snapshot, opts = {}) {
  const maxRoutes = Math.min(Math.max(50, opts.maxRoutes ?? 500), 2000);
  const prev =
    existing &&
    typeof existing === 'object' &&
    existing.routes &&
    typeof existing.routes === 'object'
      ? /** @type {Record<string, unknown>} */ (existing.routes)
      : {};

  /** @type {Record<string, unknown>} */
  const merged = { ...prev };

  for (const [k, v] of Object.entries(snapshot.routes || {})) {
    if (Object.keys(merged).length >= maxRoutes) break;
    const cur = merged[k];
    if (!cur || typeof cur !== 'object') {
      merged[k] = v;
      continue;
    }
    const c = /** @type {Record<string, unknown>} */ (cur);
    const add = /** @type {Record<string, unknown>} */ (v);
    merged[k] = {
      samples: Number(c.samples || 0) + Number(add.samples || 0),
      statusMax: Math.max(Number(c.statusMax || 0), Number(add.statusMax || 0)),
      errors: Number(c.errors || 0) + Number(add.errors || 0),
      sessions: Number(c.sessions || 0) + 1,
    };
  }

  return {
    format: 'mythos-campaign-memory',
    version: 1,
    updatedAt: new Date().toISOString(),
    routes: merged,
  };
}
