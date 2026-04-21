/**
 * REST triage hints — deterministic route/body classification (no LLM).
 * Downgrades or re-labels heuristic findings where we can explain likely false positives.
 */

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isLikelyPublicChallengeCatalogUrl(url) {
  try {
    const p = new URL(url).pathname;
    // OWASP Juice Shop — challenge metadata JSON is designed to mention "password", etc.
    if (/\/api\/challenges\b/i.test(p)) return true;
    if (/\/challenges\b/i.test(p) && /api/i.test(p)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Spec-driven case ids embed `spec:<operationId>:…`. OperationId prefixes/tags often mark
 * intentionally public catalog endpoints (labs, storefronts) where keyword hits are noisy.
 *
 * @param {string} caseId
 */
export function isLikelyBenignCatalogOperationFromCaseId(caseId) {
  const m = String(caseId).match(/^spec:([^:]+):/);
  if (!m) return false;
  const oid = m[1];
  if (/(user|admin|session|token|password|secret|account|profile|identity|auth|order)/i.test(oid)) {
    return false;
  }
  return /^(list|get|fetch)(Challenge|Challenges|Product|Products|Coupon|Coupons|Catalog|Vehicle|Vehicles)/i.test(
    oid,
  );
}

/**
 * HTML 500 pages are often gateway/app misroutes (see crAPI bare `/orders` vs `/orders/all`),
 * not proof of exploitable server-side bugs.
 *
 * @param {Record<string, string>} headers
 * @param {string} [bodyPreview]
 * @returns {{ kind: 'html_error_page' } | null}
 */
export function classifyHtmlServerError(headers, bodyPreview) {
  const ct = String(headers?.['content-type'] || headers?.['Content-Type'] || '');
  const prev = String(bodyPreview || '');
  const looksHtml =
    /text\/html/i.test(ct) ||
    /<\s*!doctype\s+html/i.test(prev) ||
    /<\s*html[\s>]/i.test(prev);
  if (!looksHtml) return null;
  if (!prev.includes('500') && !/server error/i.test(prev) && !/<title>[^<]*error/i.test(prev)) {
    return null;
  }
  return { kind: 'html_error_page' };
}
