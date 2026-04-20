/**
 * Milestone G — case prioritization using campaign memory rankings + route novelty.
 *
 * Two orthogonal signals are combined into a stable sort:
 *
 *  1. Campaign memory rank — routes that historically produced findings/errors
 *     appear first (lower index in rankedRouteKeys = higher priority).
 *
 *  2. Route novelty — routes not yet touched in this run (not in seenRouteKeys)
 *     are preferred over routes already covered by chains or LLM cases.
 *
 * Neither signal changes which cases are generated — only their execution order
 * within the capped flat budget. No network I/O; purely deterministic.
 */

import { canonicalRouteKey } from '../verify/baseline.js';

/**
 * @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase
 */

/**
 * Stable-sort a FuzzCase array so that:
 *  - Cases for campaign-memory-ranked routes come first (position in rankedRouteKeys).
 *  - Among ties, cases for routes not seen this run come before already-seen routes.
 *  - Original order is preserved when both signals are equal (stable sort).
 *
 * @param {FuzzCase[]} cases
 * @param {{
 *   rankedRouteKeys?: string[],
 *   seenRouteKeys?: Set<string>,
 * }} opts
 * @returns {FuzzCase[]}
 */
export function prioritizeCases(cases, opts = {}) {
  if (!cases.length) return cases;

  /** Map from canonical route key → rank index (lower = better). */
  const rankMap = new Map(
    (opts.rankedRouteKeys || []).map((k, i) => [k, i])
  );
  const seen = opts.seenRouteKeys || new Set();
  const hasRanking = rankMap.size > 0;
  const hasSeen = seen.size > 0;

  // Fast path: nothing to re-order
  if (!hasRanking && !hasSeen) return cases;

  return [...cases].sort((a, b) => {
    const ka = canonicalRouteKey(a.method, a.url);
    const kb = canonicalRouteKey(b.method, b.url);

    // Primary: campaign-memory rank (lower index wins; unranked = Infinity)
    if (hasRanking) {
      const ra = rankMap.has(ka) ? /** @type {number} */ (rankMap.get(ka)) : Infinity;
      const rb = rankMap.has(kb) ? /** @type {number} */ (rankMap.get(kb)) : Infinity;
      if (ra !== rb) return ra - rb;
    }

    // Secondary: unseen routes before already-seen (0 < 1 so unseen sorts first)
    if (hasSeen) {
      const sa = seen.has(ka) ? 1 : 0;
      const sb = seen.has(kb) ? 1 : 0;
      if (sa !== sb) return sa - sb;
    }

    return 0; // preserve insertion order
  });
}
