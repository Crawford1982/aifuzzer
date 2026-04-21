/**
 * Layer 6 — Verification (heuristic only in v0.1)
 */

import {
  classifyHtmlServerError,
  isLikelyBenignCatalogOperationFromCaseId,
  isLikelyPublicChallengeCatalogUrl,
} from './triageHints.js';

const SENSITIVE = /password|secret|api_key|apikey|BEGIN RSA PRIVATE KEY/i;

/** @param {unknown} r */
function getHeadersObj(r) {
  const h = /** @type {Record<string, string> | undefined} */ (/** @type {Record<string, unknown>} */ (r).headers);
  return h && typeof h === 'object' ? h : {};
}

/** @param {unknown[]} results */
export function triageResults(results) {
  /** @type {Array<Record<string, unknown>>} */
  const findings = [];

  for (const r of results) {
    if (r.error) {
      findings.push({
        severity: 'info',
        title: 'Transport/timeout',
        detail: r.error,
        caseId: r.caseId,
        url: r.url,
      });
      continue;
    }

    if (r.status && r.status >= 500) {
      const headers = getHeadersObj(r);
      const htmlKind = classifyHtmlServerError(headers, r.bodyPreview);
      if (htmlKind) {
        findings.push({
          severity: 'medium',
          title: 'Server error (HTML error page)',
          detail:
            `HTTP ${r.status} with HTML body — often a broken route, gateway page, or app stack error. ` +
            `Confirm URL shape, auth, and server logs before treating as a security bug.`,
          caseId: r.caseId,
          url: r.url,
        });
      } else {
        findings.push({
          severity: 'high',
          title: 'Server error status',
          detail: `HTTP ${r.status}`,
          caseId: r.caseId,
          url: r.url,
        });
      }
      continue;
    }

    if (r.family === 'AUTH_BYPASS' && r.status === 200 && r.bodyPreview?.length > 30) {
      findings.push({
        severity: 'medium',
        title: 'Possible auth anomaly',
        detail: '200 response on auth-focused case — verify manually',
        caseId: r.caseId,
        url: r.url,
      });
    }

    if (r.bodyPreview && SENSITIVE.test(r.bodyPreview)) {
      const urlStr = String(r.url || '');
      const caseIdStr = String(r.caseId || '');
      if (isLikelyPublicChallengeCatalogUrl(urlStr) || isLikelyBenignCatalogOperationFromCaseId(caseIdStr)) {
        findings.push({
          severity: 'low',
          title: 'Sensitive keyword in body (likely catalog noise)',
          detail:
            'Keyword match on a public challenge/API catalog-style path — common in vulnerable labs; verify before escalating.',
          caseId: r.caseId,
          url: r.url,
        });
      } else {
        findings.push({
          severity: 'high',
          title: 'Sensitive keyword in body',
          detail: 'Keyword heuristic — likely noise on public APIs',
          caseId: r.caseId,
          url: r.url,
        });
      }
    }
  }

  return findings;
}
