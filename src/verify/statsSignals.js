/**
 * Route-level statistical signals — complements heuristic confidence (no LLM).
 */

import { canonicalRouteKey } from './baseline.js';

/**
 * @param {number} n
 * @param {number} k
 */
function logBinomialCoefficient(n, k) {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  let s = 0;
  for (let i = 0; i < k; i++) {
    s += Math.log(n - i) - Math.log(i + 1);
  }
  return s;
}

/**
 * P(X >= k) for X ~ Binomial(n, p), one-sided upper tail (elevated rare events).
 *
 * @param {number} k
 * @param {number} n
 * @param {number} p
 */
export function binomialTailAtLeast(k, n, p) {
  if (n <= 0 || p <= 0 || p >= 1) return k === 0 ? 1 : 0;
  if (k <= 0) return 1;
  let sum = 0;
  for (let i = k; i <= n; i++) {
    const logP =
      logBinomialCoefficient(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p);
    sum += Math.exp(logP);
  }
  return Math.min(1, sum);
}

/**
 * @param {unknown[]} execResults
 * @returns {Map<string, { n: number, n5xx: number, n4xx: number }>}
 */
export function aggregateRouteStatus(execResults) {
  /** @type {Map<string, { n: number, n5xx: number, n4xx: number }>} */
  const map = new Map();

  for (const r of execResults) {
    const row = /** @type {Record<string, unknown>} */ (r);
    if (row.error) continue;
    const method = String(row.method || 'GET');
    const url = String(row.url || '');
    const key = canonicalRouteKey(method, url);
    const st = row.status != null ? Number(row.status) : null;
    const cur = map.get(key) || { n: 0, n5xx: 0, n4xx: 0 };
    cur.n += 1;
    if (st != null && st >= 500) cur.n5xx += 1;
    if (st != null && st >= 400 && st < 500) cur.n4xx += 1;
    map.set(key, cur);
  }

  return map;
}

/**
 * Baseline-route 5xx rate from OPENAPI_BASELINE successes only (expected stability window).
 *
 * @param {unknown[]} execResults
 * @returns {Map<string, { trials: number, fiveXX: number }>}
 */
export function baselineFiveXXRates(execResults) {
  /** @type {Map<string, { trials: number, fiveXX: number }>} */
  const map = new Map();

  for (const r of execResults) {
    const row = /** @type {Record<string, unknown>} */ (r);
    if (String(row.family || '') !== 'OPENAPI_BASELINE') continue;
    if (row.error) continue;
    const method = String(row.method || 'GET');
    const url = String(row.url || '');
    const key = canonicalRouteKey(method, url);
    const st = row.status != null ? Number(row.status) : null;
    const cur = map.get(key) || { trials: 0, fiveXX: 0 };
    cur.trials += 1;
    if (st != null && st >= 500) cur.fiveXX += 1;
    map.set(key, cur);
  }

  return map;
}

/**
 * Enrich findings with route aggregates + binomial surprise for 5xx-heavy routes.
 *
 * @param {Array<Record<string, unknown>>} findings
 * @param {unknown[]} execResults
 */
export function enrichFindingsWithStatistics(findings, execResults) {
  const routes = aggregateRouteStatus(execResults);
  const baseline = baselineFiveXXRates(execResults);

  return findings.map((f) => {
    const cid = /** @type {string} */ (f.caseId);
    const raw = execResults.find((x) => /** @type {any} */ (x).caseId === cid);
    if (!raw || /** @type {any} */ (raw).error) {
      return { ...f, statistics: { note: 'no_route_or_error' } };
    }

    const method = String(/** @type {any} */ (raw).method || 'GET');
    const url = String(/** @type {any} */ (raw).url || '');
    const routeKey = canonicalRouteKey(method, url);
    const agg = routes.get(routeKey) || { n: 0, n5xx: 0, n4xx: 0 };
    const base = baseline.get(routeKey);

    let p0 = 0.02;
    let baselineNote = 'default_prior';
    if (base && base.trials >= 3) {
      p0 = Math.max(0.001, Math.min(0.5, base.fiveXX / base.trials));
      baselineNote = 'from_openapi_baseline_family';
    } else if (base && base.trials > 0) {
      p0 = Math.max(0.001, base.fiveXX / base.trials);
      baselineNote = 'baseline_sparse';
    }

    const status = /** @type {any} */ (raw).status != null ? Number(/** @type {any} */ (raw).status) : null;
    let binomialExcessP = null;
    if (status != null && status >= 500 && agg.n >= 1) {
      binomialExcessP = binomialTailAtLeast(agg.n5xx, agg.n, p0);
    }

    /** @type {Record<string, unknown>} */
    const statistics = {
      routeKey,
      routeSamples: agg.n,
      routeFiveXXCount: agg.n5xx,
      routeFiveXXRate: agg.n ? agg.n5xx / agg.n : null,
      baselineFiveXXPrior: p0,
      baselineNote,
      binomialExcessP,
    };

    let confidence = typeof f.confidence === 'number' ? f.confidence : 0.5;
    /** @type {string[]} */
    const signals = Array.isArray(f.signals) ? [.../** @type {string[]} */ (f.signals)] : [];

    if (binomialExcessP != null && binomialExcessP < 0.05 && status != null && status >= 500) {
      signals.push('binomial_excess_5xx_rare');
      confidence = Math.min(1, Math.round((confidence + 0.12) * 100) / 100);
    }

    return { ...f, confidence, signals, statistics };
  });
}
