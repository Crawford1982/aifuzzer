/**
 * Milestone D — confidence from deterministic signals only (no LLM).
 */

import { canonicalRouteKey, fingerprintBody } from './baseline.js';

/**
 * @param {{
 *   severity?: string,
 *   title?: string,
 *   caseId?: string,
 * }} finding
 * @param {unknown} rawResult
 * @param {Map<string, string>} baselines
 */
export function scoreFinding(finding, rawResult, baselines) {
  /** @type {string[]} */
  const signals = [];

  const r = /** @type {Record<string, unknown>} */ (rawResult || {});
  const method = String(r.method || 'GET');
  const url = String(r.url || '');
  const status = r.status != null ? Number(r.status) : null;

  let score = 0.35;

  if (finding.severity === 'high') {
    score += 0.15;
    signals.push('heuristic_high_severity');
  } else if (finding.severity === 'medium') {
    score += 0.1;
    signals.push('heuristic_medium_severity');
  }

  if (status != null && status >= 500) {
    score += 0.22;
    signals.push('http_5xx');
  }

  const key = canonicalRouteKey(method, url);
  const base = baselines.get(key);
  const cur = fingerprintBody(String(r.bodyPreview || ''));
  if (base && cur && base !== cur) {
    score += 0.18;
    signals.push('body_diff_vs_baseline');
  }

  if (r.error && String(r.error).includes('redirect')) {
    score += 0.12;
    signals.push('policy_redirect_signal');
  }

  return { score: Math.min(1, Math.round(score * 100) / 100), signals };
}

/**
 * @param {Array<Record<string, unknown>>} findings
 * @param {unknown[]} execResults
 * @param {Map<string, string>} baselines
 */
export function enrichFindingsWithConfidence(findings, execResults, baselines) {
  const byCase = new Map(execResults.map((x) => [/** @type {any} */ (x).caseId, x]));

  return findings.map((f) => {
    const cid = /** @type {string} */ (f.caseId);
    const raw = byCase.get(cid);
    const { score, signals } = scoreFinding(f, raw, baselines);
    return { ...f, confidence: score, signals };
  });
}
