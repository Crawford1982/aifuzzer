'use strict';

/**
 * Surface layer: given an approved seed (URL or host), probe a small list of
 * common API prefixes and classify responses to decide which endpoints look
 * API-like enough to hand to the fuzzer as seeds.
 *
 * This addresses the main failure mode observed in the REI test run:
 *   the plan targeted marketing homepages (rei.com, login.rei.com) that
 *   live behind CDNs and return 301/403. Pattern probes against those
 *   baselines are useless. By discovering e.g. `api.rei.com/v1/...` or
 *   `/api/auth/session` first, the fuzzer gets real API surface.
 *
 * Discovery is cautious:
 *   - GET only, timeout-bounded, SSRF-guarded per hop
 *   - Same-host only (doesn't follow cross-origin redirects)
 *   - Bounded concurrency and total request cap
 *   - Small prefix list (~20) — the point is enrichment, not bruteforce
 */

const {
  assertSafeFetchTarget,
  looksHardOutOfScope,
  expandHostPattern
} = require('./scopeHelpers');
const { fetchWithTimeout } = require('./fuzzAgent');

// Common API/admin surface prefixes. Kept deliberately small — we want
// high-precision enrichment, not bruteforce enumeration.
const DEFAULT_PREFIXES = Object.freeze([
  '/',
  '/api',
  '/api/',
  '/api/v1',
  '/api/v2',
  '/api/v3',
  '/v1',
  '/v2',
  '/rest',
  '/rest/',
  '/graphql',
  '/graphiql',
  '/.well-known/openapi',
  '/openapi.json',
  '/swagger.json',
  '/swagger-ui/',
  '/actuator',
  '/actuator/health',
  '/health',
  '/healthz',
  '/status',
  '/debug',
  '/_next/data',
  '/__introspection'
]);

// CDN/edge servers often respond 301 or 403 with a large HTML body to
// generic probes. This is near-useless for API discovery.
const CDN_SERVER_HINTS = [
  'cloudfront',
  'akamai',
  'fastly',
  'cloudflare',
  'netlify',
  'vercel',
  'aws elb',
  'varnish'
];

function looksLikeCdnEdge(headers = {}) {
  const server = String(headers.server || headers.Server || '').toLowerCase();
  const via = String(headers.via || headers.Via || '').toLowerCase();
  const xEdge = String(headers['x-cache'] || headers['x-amz-cf-id'] || '').toLowerCase();
  const blob = `${server} ${via} ${xEdge}`;
  return CDN_SERVER_HINTS.some((h) => blob.includes(h));
}

function isApiLikeResponse(res) {
  if (!res || !res.ok) return { ok: false, reason: res?.error || 'error' };
  const headers = res.headers || {};
  const ct = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();

  // 2xx JSON = strong signal.
  if (res.status >= 200 && res.status < 300 && ct.includes('json')) {
    return { ok: true, reason: 'json_2xx', confidence: 'high' };
  }
  // 401/403 JSON = API that exists but rejects us = also useful surface.
  if ((res.status === 401 || res.status === 403) && ct.includes('json')) {
    return { ok: true, reason: `json_${res.status}`, confidence: 'medium' };
  }
  // 2xx with non-CDN server returning JSON-ish body.
  if (res.status >= 200 && res.status < 300 && !looksLikeCdnEdge(headers)) {
    const body = String(res.bodyPreview || '').trim();
    if (body.startsWith('{') || body.startsWith('[')) {
      return { ok: true, reason: 'jsonish_body', confidence: 'medium' };
    }
  }
  // 404 JSON = API framework saying "not found" rather than CDN 404 page.
  if (res.status === 404 && ct.includes('json')) {
    return { ok: true, reason: 'json_404', confidence: 'low' };
  }
  return { ok: false, reason: `status_${res.status}_ct_${ct || 'none'}` };
}

/**
 * Build the list of candidate URLs to probe from a seed.
 * Accepts a URL or a bare host. Wildcards go through expandHostPattern.
 */
function seedsFromInput(input) {
  const s = String(input || '').trim();
  if (!s) return [];
  // URL form.
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return [`https://${u.hostname.toLowerCase()}`];
    } catch (_e) {
      return [];
    }
  }
  // Wildcard pattern → concrete hosts.
  if (s.includes('*')) {
    return expandHostPattern(s).map((h) => `https://${h}`);
  }
  // Bare host.
  return [`https://${s}`];
}

/**
 * Main entry: discover API-like endpoints across a list of seeds.
 *   seeds: array of URLs, bare hosts, or H1 wildcard patterns
 *
 * Returns:
 *   {
 *     approvedTargets: string[],  // good API-like URLs to fuzz
 *     attempts: Array<{ url, status, ok, reason, confidence }>,
 *     stats: { tried, approved, rejected, errors }
 *   }
 */
async function discoverSurface({
  seeds,
  prefixes,
  concurrency = 3,
  timeoutMs = 5000,
  maxRequests = 40,
  perHostMax = 12,
  onEvent,
  scopeTargetCheck
} = {}) {
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  const prefixList = Array.isArray(prefixes) && prefixes.length ? prefixes : [...DEFAULT_PREFIXES];

  // Normalise seeds to concrete https URLs.
  const seedUrls = [];
  for (const s of seeds || []) {
    for (const u of seedsFromInput(s)) {
      seedUrls.push(u);
    }
  }

  // Build candidate URL list per host, dedup, and enforce per-host cap.
  const perHostCount = new Map();
  const candidates = [];
  for (const seed of [...new Set(seedUrls)]) {
    let base;
    try {
      base = new URL(seed);
    } catch (_e) {
      continue;
    }
    const host = base.hostname.toLowerCase();
    for (const prefix of prefixList) {
      const used = perHostCount.get(host) || 0;
      if (used >= perHostMax) break;
      if (candidates.length >= maxRequests) break;
      const href = new URL(prefix, `${base.origin}/`).href;
      candidates.push({ host, url: href });
      perHostCount.set(host, used + 1);
    }
  }

  const attempts = [];
  const approvedTargets = new Set();
  let inFlight = 0;
  let cursor = 0;

  await new Promise((resolve) => {
    if (candidates.length === 0) return resolve();
    const launch = () => {
      while (inFlight < concurrency && cursor < candidates.length) {
        const c = candidates[cursor++];
        inFlight++;

        // Re-validate every candidate (defence in depth).
        try {
          assertSafeFetchTarget(c.url);
        } catch (e) {
          attempts.push({ url: c.url, ok: false, status: null, reason: `ssrf:${e.message}` });
          emit({ type: 'surface-attempt', url: c.url, ok: false, reason: `ssrf:${e.message}` });
          inFlight--;
          if (cursor >= candidates.length && inFlight === 0) return resolve();
          continue;
        }
        if (looksHardOutOfScope(c.url)) {
          attempts.push({ url: c.url, ok: false, status: null, reason: 'hard_oos' });
          emit({ type: 'surface-attempt', url: c.url, ok: false, reason: 'hard_oos' });
          inFlight--;
          if (cursor >= candidates.length && inFlight === 0) return resolve();
          continue;
        }
        if (typeof scopeTargetCheck === 'function') {
          const sc = scopeTargetCheck(c.url);
          if (!sc || sc.ok === false) {
            attempts.push({ url: c.url, ok: false, status: null, reason: sc?.reason || 'scope_policy' });
            emit({ type: 'surface-attempt', url: c.url, ok: false, reason: sc?.reason || 'scope_policy' });
            inFlight--;
            if (cursor >= candidates.length && inFlight === 0) return resolve();
            continue;
          }
        }

        fetchWithTimeout(c.url, {
          timeoutMs,
          headers: {
            'User-Agent': 'mythos-surface/0.1 (+authorized-testing)',
            Accept: 'application/json, */*;q=0.1'
          },
          method: 'GET',
          maxHops: 2
        })
          .then((res) => {
            const verdict = isApiLikeResponse(res);
            const record = {
              url: c.url,
              host: c.host,
              status: res?.status ?? null,
              size: res?.size ?? 0,
              ok: verdict.ok,
              reason: verdict.reason,
              confidence: verdict.confidence,
              redirectChain: res?.redirectChain || null,
              crossOriginRedirect: res?.crossOriginRedirect || false
            };
            attempts.push(record);
            if (verdict.ok) approvedTargets.add(c.url);
            emit({ type: 'surface-attempt', ...record });
          })
          .catch((err) => {
            attempts.push({ url: c.url, host: c.host, ok: false, reason: `fetch_error:${err?.message || err}` });
          })
          .finally(() => {
            inFlight--;
            if (cursor >= candidates.length && inFlight === 0) resolve();
            else launch();
          });
      }
    };
    launch();
  });

  const stats = {
    tried: attempts.length,
    approved: approvedTargets.size,
    rejected: attempts.filter((a) => !a.ok).length,
    errors: attempts.filter((a) => String(a.reason || '').startsWith('fetch_error')).length
  };
  return {
    approvedTargets: [...approvedTargets],
    attempts,
    stats
  };
}

module.exports = {
  DEFAULT_PREFIXES,
  discoverSurface,
  seedsFromInput,
  isApiLikeResponse,
  looksLikeCdnEdge
};
