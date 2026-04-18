'use strict';

/**
 * Pattern-driven fuzz agent + LLM hypothesis/triage hooks. This is the
 * "Hypothesis + Execution + Feedback + Verify" slice of the Mythos
 * architecture, implemented so it can be required() from either the scope
 * lab's server.js or the sibling Mythos CLI. It MUST not import anything
 * from server.js (no circular deps); injected callbacks are used for LLM
 * access so this module stays transport-agnostic.
 *
 * Hard rules (unchanged in Pass C/D):
 *   - Every request goes through assertSafeFetchTarget (SSRF guard).
 *   - Hard budgets enforced before work starts; over-budget = reject.
 *   - No request bodies, no mutations — only GET probes for v0.
 *   - OOS denylist is respected; approved targets only.
 *   - LLM-proposed probes get re-validated (SSRF + OOS + host-allowlist).
 *
 * Pass D additions:
 *   - Degenerate-baseline detection: if baseline is 301/302/403/0-byte, skip
 *     variant probes for that target and emit 'skip' event with reason.
 *   - Same-origin redirect following with a hop cap, re-validated through
 *     the SSRF guard on every hop.
 *   - Debug-flag probes throttled to once per HOST (not once per target)
 *     so we don't burn budget on symmetrical endpoints.
 *   - Per-host summary breakdown in the returned summary.
 *   - Novelty-vs-degenerate distinction in triage.
 */

const { assertSafeFetchTarget, looksHardOutOfScope } = require('./scopeHelpers');

const DEFAULT_BUDGET = Object.freeze({
  maxRequests: 30,
  concurrency: 2,
  timeoutMs: 6000,
  perHostMax: 15
});

const HARD_CEILING = Object.freeze({
  maxRequests: 80,
  concurrency: 4,
  timeoutMs: 10000,
  perHostMax: 40
});

// Pass D: what we consider a "degenerate" baseline. Variants against a
// baseline like this can't give us real signal, so we short-circuit.
const DEGENERATE_STATUSES = new Set([301, 302, 303, 307, 308, 401, 403, 451]);

function clampBudget(requested = {}) {
  const merged = { ...DEFAULT_BUDGET, ...requested };
  return {
    maxRequests: Math.min(Math.max(1, Number(merged.maxRequests) || 0), HARD_CEILING.maxRequests),
    concurrency: Math.min(Math.max(1, Number(merged.concurrency) || 0), HARD_CEILING.concurrency),
    timeoutMs: Math.min(Math.max(1000, Number(merged.timeoutMs) || 0), HARD_CEILING.timeoutMs),
    perHostMax: Math.min(Math.max(1, Number(merged.perHostMax) || 0), HARD_CEILING.perHostMax)
  };
}

/**
 * Pattern engine: generate candidate probes from a seed URL.
 * Keeps hypotheses narrow and defensible — each probe has a reason string.
 *
 * Pass D: `rules.skipDebugProbes` lets the caller suppress debug-flag probes
 * (used to throttle them to once per host instead of once per target).
 */
function generateProbes(seedUrl, rules = {}) {
  const probes = [];
  let base;
  try {
    base = new URL(seedUrl);
  } catch (_e) {
    return probes;
  }

  // 1. Baseline — establishes the reference response.
  probes.push({
    id: 'baseline',
    method: 'GET',
    url: base.href,
    hypothesis: 'baseline_response',
    reason: 'Establish reference status/size/headers for comparison.',
    authMode: 'as-provided'
  });

  // 2. Auth-replay-without-token — if the seed had an Authorization header,
  //    re-run it without one. Same response = broken auth.
  if (rules.hasAuth) {
    probes.push({
      id: 'missing-auth',
      method: 'GET',
      url: base.href,
      hypothesis: 'missing_auth_accepted',
      reason: 'Authenticated endpoint replayed with no token. If 200 and similar body, auth is advisory.',
      authMode: 'none'
    });
  }

  // 3. IDOR-ish path swaps: numeric ID segments get flipped to neighbors.
  const segments = base.pathname.split('/').filter(Boolean);
  segments.forEach((seg, idx) => {
    if (/^\d+$/.test(seg)) {
      const n = Number(seg);
      for (const shift of [1, -1, 0]) {
        if (shift === 0) continue;
        const next = n + shift;
        if (next < 0) continue;
        const newSegs = [...segments];
        newSegs[idx] = String(next);
        const u = new URL(base.href);
        u.pathname = '/' + newSegs.join('/');
        probes.push({
          id: `idor-path-${idx}-${shift > 0 ? 'up' : 'down'}`,
          method: 'GET',
          url: u.href,
          hypothesis: 'idor_path_swap',
          reason: `Numeric path segment ${seg} shifted to ${next}. If returns different but authorized-looking content, potential IDOR.`,
          authMode: 'as-provided'
        });
      }
    }
  });

  // 4. Debug query toggles — classic "debug=1" / "verbose=true" reveal.
  //    Pass D: skip when caller says so (debug-flag throttling per host).
  if (!rules.skipDebugProbes) {
    const debugKeys = ['debug', 'verbose', 'test', 'admin', 'trace', 'dev'];
    for (const key of debugKeys) {
      if (base.searchParams.has(key)) continue; // already present, skip
      const u = new URL(base.href);
      u.searchParams.set(key, '1');
      probes.push({
        id: `debug-${key}`,
        method: 'GET',
        url: u.href,
        hypothesis: 'debug_flag_disclosure',
        reason: `Added ?${key}=1. If response size or headers differ meaningfully from baseline, may disclose debug info.`,
        authMode: 'as-provided'
      });
    }
  }

  // 5. Trailing-slash + case-variant — often reveals routing inconsistencies.
  if (!base.pathname.endsWith('/')) {
    const u = new URL(base.href);
    u.pathname = base.pathname + '/';
    probes.push({
      id: 'trailing-slash',
      method: 'GET',
      url: u.href,
      hypothesis: 'routing_variant',
      reason: 'Trailing slash variant. Different status vs baseline can indicate inconsistent routing middleware.',
      authMode: 'as-provided'
    });
  }

  // 6. HTTP method variant not yet — POST/PUT can mutate. Deferred until
  //    we have explicit user consent to send non-GET requests.

  return probes;
}

/** Supports Bearer JWT and Dynatrace `Authorization: Api-Token …` paste. */
function normalizeAuthorizationHeader(raw) {
  const t = String(raw || '').trim();
  if (!t) return {};
  if (/^authorization\s*:/i.test(t)) {
    const v = t.replace(/^\s*authorization\s*:\s*/i, '').trim();
    return { Authorization: v };
  }
  if (/^bearer\s+/i.test(t)) return { Authorization: t };
  if (/^api-token\s+/i.test(t)) return { Authorization: `Api-Token ${t.replace(/^api-token\s+/i, '').trim()}` };
  return { Authorization: `Bearer ${t}` };
}

/**
 * Low-level fetch with timeout. Does NOT follow redirects — the caller
 * (fetchWithRedirects) handles that so it can re-validate each hop through
 * the SSRF guard.
 */
async function fetchOnce(url, { timeoutMs, headers = {}, method = 'GET' }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      redirect: 'manual',
      signal: controller.signal
    });
    const buf = await res.arrayBuffer();
    const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 16384));
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      size: buf.byteLength,
      bodyPreview: bodyText,
      headers: Object.fromEntries(res.headers.entries()),
      location: res.headers.get('location') || null,
      durationMs: Date.now() - t0
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e)),
      durationMs: Date.now() - t0
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pass D: fetchWithTimeout + bounded same-origin redirect follow.
 * Each hop is re-validated through assertSafeFetchTarget.
 *
 * `redirectChain` is attached to the returned result so triage can reason
 * about redirects (e.g. distinguish "0-byte redirect" from "0-byte error").
 */
async function fetchWithTimeout(url, { timeoutMs, headers = {}, method = 'GET', maxHops = 3 }) {
  const chain = [];
  let currentUrl = url;
  let currentOrigin;
  try {
    currentOrigin = new URL(currentUrl).origin;
  } catch (_e) {
    return { ok: false, error: 'invalid_url', durationMs: 0, redirectChain: chain };
  }

  for (let hop = 0; hop <= maxHops; hop++) {
    let res;
    try {
      assertSafeFetchTarget(currentUrl);
      res = await fetchOnce(currentUrl, { timeoutMs, headers, method });
    } catch (e) {
      return {
        ok: false,
        error: `ssrf_block:${e.message}`,
        durationMs: 0,
        redirectChain: chain
      };
    }
    chain.push({ url: currentUrl, status: res.status || null, size: res.size || 0, location: res.location || null });

    if (!res.ok) {
      res.redirectChain = chain;
      return res;
    }
    // Not a redirect, or no Location header — return as-is.
    if (res.status < 300 || res.status >= 400 || !res.location) {
      res.redirectChain = chain;
      return res;
    }
    if (hop >= maxHops) {
      res.error = 'redirect_cap_reached';
      res.redirectChain = chain;
      res.terminatedAtRedirect = true;
      return res;
    }

    // Resolve the Location against current URL; only follow same-origin.
    let nextUrl;
    try {
      nextUrl = new URL(res.location, currentUrl).href;
    } catch (_e) {
      res.redirectChain = chain;
      res.error = 'bad_location_header';
      return res;
    }
    let nextOrigin;
    try {
      nextOrigin = new URL(nextUrl).origin;
    } catch (_e) {
      res.redirectChain = chain;
      res.error = 'bad_redirect_origin';
      return res;
    }
    if (nextOrigin !== currentOrigin) {
      // Cross-origin — don't follow (scope safety). Return the redirect as
      // the terminal response, with the chain so triage can see it.
      res.redirectChain = chain;
      res.crossOriginRedirect = true;
      return res;
    }
    currentUrl = nextUrl;
  }

  // Unreachable in practice (loop returns), but keep an explicit fallback.
  return { ok: false, error: 'redirect_overflow', durationMs: 0, redirectChain: chain };
}

/**
 * Very simple response-novelty signal. Two responses that share status and
 * have body lengths within 10% are considered "similar". The triage agent
 * uses this to decide which probe results warrant deeper review.
 */
function sameShape(a, b) {
  if (!a || !b) return false;
  if (!a.ok || !b.ok) return a?.ok === b?.ok;
  if (a.status !== b.status) return false;
  const size = Math.max(a.size, b.size, 1);
  return Math.abs(a.size - b.size) / size < 0.1;
}

/**
 * Pass D: recognise when a baseline is too degenerate to make variant
 * comparisons worth running. Caller uses this to skip variant probes and
 * emit a { type: 'skip', reason } event.
 */
function classifyBaseline(result) {
  if (!result || !result.ok) return { kind: 'error', reason: result?.error || 'unknown' };
  if (DEGENERATE_STATUSES.has(result.status)) {
    return { kind: 'degenerate', reason: `status_${result.status}` };
  }
  // 0-byte with 2xx = probably HEAD-ish or CDN error page.
  if (result.status >= 200 && result.status < 300 && (result.size || 0) === 0) {
    return { kind: 'degenerate', reason: 'empty_2xx' };
  }
  return { kind: 'ok' };
}

function triageProbe({ probe, result, baseline }) {
  const findings = [];
  if (!result.ok) {
    return { novelty: 'error', findings, summary: `request error: ${result.error}` };
  }

  // Pass D: if baseline was degenerate, don't manufacture findings off it.
  const baselineClass = classifyBaseline(baseline);
  const baselineDegenerate = baselineClass.kind !== 'ok';

  // Hypothesis-specific triage.
  if (probe.hypothesis === 'missing_auth_accepted') {
    if (result.status >= 200 && result.status < 300 && sameShape(result, baseline)) {
      findings.push({
        severity: 'high',
        title: 'Endpoint may accept missing authentication',
        detail: `Unauthenticated request returned ${result.status} with response shape similar to the authenticated baseline.`
      });
    }
  }

  if (probe.hypothesis === 'idor_path_swap') {
    if (result.status >= 200 && result.status < 300 && !sameShape(result, baseline) && result.size > 200 && !baselineDegenerate) {
      findings.push({
        severity: 'medium',
        title: 'Possible IDOR: neighboring ID returns different authorized-looking data',
        detail: `Path swap returned ${result.status} with a response shape differing from baseline.`
      });
    }
  }

  if (probe.hypothesis === 'debug_flag_disclosure') {
    const bodyLen = result.bodyPreview?.length || 0;
    const baseLen = baseline?.bodyPreview?.length || 0;
    if (!baselineDegenerate && result.status < 500 && bodyLen > baseLen * 1.25 && bodyLen - baseLen > 200) {
      findings.push({
        severity: 'low',
        title: 'Debug-style query parameter changed response shape',
        detail: `Added debug param enlarged response body from ~${baseLen} to ~${bodyLen} chars.`
      });
    }
  }

  if (probe.hypothesis === 'routing_variant') {
    if (!baselineDegenerate && result.status !== baseline?.status) {
      findings.push({
        severity: 'info',
        title: 'Inconsistent routing between path variants',
        detail: `Baseline returned ${baseline?.status}, variant returned ${result.status}.`
      });
    }
  }

  let novelty = sameShape(result, baseline) ? 'similar' : 'novel';
  if (baselineDegenerate) novelty = 'baseline_degenerate';
  return {
    novelty,
    findings,
    summary: `${probe.hypothesis} → ${result.status} (${result.size}B, ${result.durationMs}ms)`
  };
}

/**
 * Validate an LLM-proposed probe: must be a URL that (a) passes SSRF guard,
 * (b) is not on the hard OOS list, and (c) hostname matches one of the
 * originally approved hosts (LLM cannot introduce new hosts).
 */
function validateProposedProbe(probe, approvedHosts, scopeTargetCheck) {
  const url = String(probe?.url || '').trim();
  if (!url) return { ok: false, reason: 'missing_url' };
  let parsed;
  try {
    parsed = assertSafeFetchTarget(url);
  } catch (e) {
    return { ok: false, reason: `ssrf:${e.message}` };
  }
  if (looksHardOutOfScope(url)) return { ok: false, reason: 'hard_oos' };
  if (typeof scopeTargetCheck === 'function') {
    const sc = scopeTargetCheck(url);
    if (!sc || sc.ok === false) {
      return { ok: false, reason: sc?.reason || 'scope_policy' };
    }
  }
  if (!approvedHosts.has(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: 'host_not_in_approved_set' };
  }
  const method = String(probe?.method || 'GET').toUpperCase();
  if (method !== 'GET') return { ok: false, reason: 'only_get_allowed_v0' };
  return {
    ok: true,
    probe: {
      id: String(probe.id || 'llm-probe-' + Math.random().toString(36).slice(2, 8)),
      method,
      url,
      hypothesis: String(probe.hypothesis || 'llm_proposed').slice(0, 64),
      reason: String(probe.reason || 'LLM proposed; no reason given.').slice(0, 500),
      authMode: probe.authMode === 'none' ? 'none' : 'as-provided',
      source: 'llm'
    }
  };
}

/**
 * Default LLM-expand prompt builder. The host app can override via
 * llm.buildExpandPrompt(...); this is the sensible default.
 */
function buildExpandPrompt({ baselineTarget, baselineResult, approvedHosts, priorProbes, maxNewProbes }) {
  const headerSample = baselineResult?.headers
    ? Object.entries(baselineResult.headers).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '';
  const bodySample = (baselineResult?.bodyPreview || '').slice(0, 1800);
  const priorIds = (priorProbes || []).map((p) => p.id).slice(0, 20).join(', ');
  return `You are the Scout agent for an AI-guided REST API fuzzer. You MUST return JSON only.

A baseline request has been sent. Using ONLY what is visible in the response below, propose up to ${maxNewProbes} additional probe URLs that are LIKELY to surface authorization, IDOR, or information-disclosure bugs.

HARD CONSTRAINTS:
- method must be "GET" (no mutations in v0)
- hostname MUST be one of: ${[...approvedHosts].join(', ')}
- do NOT propose paths that are clearly static assets (/favicon.ico, .css, .js, images)
- prefer API endpoints, state-changing query params, and neighboring resource IDs
- each probe needs a short "reason" explaining WHY it might reveal a bug
- do NOT repeat these existing probe IDs: ${priorIds || '(none)'}

Baseline target: ${baselineTarget}
Baseline status: ${baselineResult?.status || 'unknown'} (${baselineResult?.size || 0} bytes)
Baseline headers (truncated):
${headerSample}

Baseline body (truncated):
${bodySample}

Return ONLY valid JSON:
{
  "probes": [
    {
      "id": "short-slug",
      "method": "GET",
      "url": "https://...",
      "hypothesis": "one-word-or-snake-case",
      "reason": "why this might reveal a bug"
    }
  ]
}`;
}

function parseExpandResponse(raw) {
  const s = String(raw || '');
  const match = s.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = match ? JSON.parse(match[0]) : JSON.parse(s);
  } catch (_e) {
    return [];
  }
  return Array.isArray(parsed?.probes) ? parsed.probes : [];
}

/**
 * Default Skeptic prompt: feed findings + the probe context, ask for a
 * per-finding verdict. We use a compact shape that's easy to parse.
 */
function buildReviewPrompt({ findings }) {
  const payload = findings.map((f, i) => ({
    idx: i,
    severity: f.severity,
    title: f.title,
    url: f.url,
    hypothesis: f.hypothesis,
    detail: f.detail
  }));
  return `You are the Skeptic agent reviewing fuzzer findings. Classify EACH finding to reduce false positives.

For each finding, output:
- "verdict": one of "likely_real" | "likely_false_positive" | "needs_manual_review"
- "reason": brief justification (under 240 chars)
- "downgrade_to" (optional): one of "info" | "low" | "medium" | "high" if severity should change

Common false positives to downgrade:
- 404/403 differing from baseline by trivial margin
- debug params added to endpoints that echo query string verbatim (reflects, doesn't disclose)
- routing variants that just add redirects
- neighbor-ID probes where body is a generic "not found" page with same template

Findings (JSON):
${JSON.stringify(payload).slice(0, 12000)}

Return ONLY valid JSON:
{
  "reviews": [
    { "idx": 0, "verdict": "likely_real", "reason": "...", "downgrade_to": null }
  ]
}`;
}

function parseReviewResponse(raw) {
  const s = String(raw || '');
  const match = s.match(/\{[\s\S]*\}/);
  try {
    const parsed = match ? JSON.parse(match[0]) : JSON.parse(s);
    return Array.isArray(parsed?.reviews) ? parsed.reviews : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Run the fuzz plan. Emits events via onEvent for streaming:
 *   { type: 'start', ... }
 *   { type: 'probe', probe, result, triage }
 *   { type: 'expand', added, rejected }
 *   { type: 'skip', target, reason }        (Pass D)
 *   { type: 'review', findings }             // after Skeptic re-review
 *   { type: 'done', summary }
 *
 * Optional llm injection (all async, caller-provided):
 *   llm.expand({ prompt, context }) -> raw text from LLM
 *   llm.review({ prompt, context }) -> raw text from LLM
 * If omitted, the agent runs pattern-only (v0 behavior).
 */
async function runFuzzPlan({
  targets,
  rules = {},
  budget,
  authToken,
  llm,
  onEvent,
  scopeTargetCheck
}) {
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  const b = clampBudget(budget);

  const approvedTargets = [];
  for (const t of targets || []) {
    const cleaned = String(t || '').trim();
    if (!cleaned) continue;
    try {
      assertSafeFetchTarget(cleaned);
    } catch (e) {
      emit({ type: 'reject', target: cleaned, reason: e.message });
      continue;
    }
    if (looksHardOutOfScope(cleaned)) {
      emit({ type: 'reject', target: cleaned, reason: 'hard_oos_denylist' });
      continue;
    }
    if (typeof scopeTargetCheck === 'function') {
      const sc = scopeTargetCheck(cleaned);
      if (!sc || sc.ok === false) {
        emit({
          type: 'reject',
          target: cleaned,
          reason: sc?.reason || 'scope_policy'
        });
        continue;
      }
    }
    approvedTargets.push(cleaned);
  }

  if (approvedTargets.length === 0) {
    emit({ type: 'done', summary: { requests: 0, findings: [], note: 'No approved targets after safety checks.' } });
    return { requests: 0, findings: [], note: 'No approved targets after safety checks.' };
  }

  // Pass D: throttle debug-flag probes per HOST (not per target). Only the
  // first target we see for a given host gets debug probes; subsequent
  // targets on the same host skip them. Saves ~6 probes per duplicate host.
  const hostsWithDebugProbes = new Set();

  // Build probes across all targets, respecting maxRequests and perHostMax.
  const probesByHost = new Map();
  const allProbes = [];
  for (const t of approvedTargets) {
    const host = new URL(t).hostname.toLowerCase();
    const skipDebug = hostsWithDebugProbes.has(host);
    const seedProbes = generateProbes(t, {
      hasAuth: Boolean(authToken),
      skipDebugProbes: skipDebug,
      ...rules
    });
    if (!skipDebug) hostsWithDebugProbes.add(host);
    const bucket = probesByHost.get(host) || [];
    for (const p of seedProbes) {
      if (bucket.length >= b.perHostMax) break;
      bucket.push(p);
      allProbes.push({ ...p, host, target: t });
      if (allProbes.length >= b.maxRequests) break;
    }
    probesByHost.set(host, bucket);
    if (allProbes.length >= b.maxRequests) break;
  }

  emit({
    type: 'start',
    budget: b,
    approvedTargets,
    probeCount: allProbes.length
  });

  const authHeader = authToken ? normalizeAuthorizationHeader(authToken) : {};

  // Group by target URL (not just host) so each seed target has its own
  // baseline — important because the same host may have several approved
  // URLs with different paths.
  const baselinesByTarget = new Map();
  for (const p of allProbes) {
    if (p.id === 'baseline' && !baselinesByTarget.has(p.target)) {
      baselinesByTarget.set(p.target, p);
    }
  }

  const findings = [];
  const results = [];
  const baselineResultsByTarget = new Map();
  const skippedTargets = new Map(); // targetUrl -> reason
  const approvedHosts = new Set([...probesByHost.keys()]);

  // Inner: run a queue of probes with bounded concurrency.
  const runQueue = (queue) =>
    new Promise((resolve) => {
      let inFlight = 0;
      let cursor = 0;
      if (queue.length === 0) return resolve();
      const launch = () => {
        while (inFlight < b.concurrency && cursor < queue.length) {
          const probe = queue[cursor++];
          inFlight++;
          const headers =
            probe.authMode === 'none'
              ? { 'User-Agent': 'mythos-fuzzer/0.1 (+authorized-testing)' }
              : { 'User-Agent': 'mythos-fuzzer/0.1 (+authorized-testing)', ...authHeader };

          fetchWithTimeout(probe.url, { timeoutMs: b.timeoutMs, headers, method: probe.method })
            .then((result) => {
              if (probe.id === 'baseline') {
                baselineResultsByTarget.set(probe.target, result);
              }
              const baseline = baselineResultsByTarget.get(probe.target) || null;
              const triage = triageProbe({ probe, result, baseline });
              for (const f of triage.findings) {
                findings.push({
                  probeId: probe.id,
                  url: probe.url,
                  host: probe.host,
                  hypothesis: probe.hypothesis,
                  ...f
                });
              }
              results.push({ probe, result, triage });
              emit({ type: 'probe', probe, result, triage });
            })
            .catch((err) => {
              emit({
                type: 'probe',
                probe,
                result: { ok: false, error: err.message || String(err) },
                triage: { novelty: 'error', findings: [] }
              });
            })
            .finally(() => {
              inFlight--;
              if (cursor >= queue.length && inFlight === 0) {
                resolve();
              } else {
                launch();
              }
            });
        }
      };
      launch();
    });

  // Phase 1: baselines first — we need their results before LLM expand or triage.
  const baselineQueue = allProbes.filter((p) => p.id === 'baseline');
  const variantQueueAll = allProbes.filter((p) => p.id !== 'baseline');
  await runQueue(baselineQueue);

  // Pass D: drop variants for targets whose baseline was degenerate.
  const variantQueue = [];
  for (const p of variantQueueAll) {
    const baseline = baselineResultsByTarget.get(p.target);
    const cls = classifyBaseline(baseline);
    if (cls.kind !== 'ok') {
      if (!skippedTargets.has(p.target)) {
        skippedTargets.set(p.target, cls.reason);
        emit({ type: 'skip', target: p.target, host: p.host, reason: cls.reason });
      }
      continue;
    }
    variantQueue.push(p);
  }

  // Phase 2: AI hypothesis expansion. Only runs if caller wired llm.expand.
  // Pass D: skip expand for targets whose baseline was degenerate (no signal).
  const llmProposed = [];
  if (llm && typeof llm.expand === 'function') {
    const expansionBudget = Math.max(
      0,
      b.maxRequests - baselineQueue.length - variantQueue.length
    );
    const maxNewProbes = Math.min(8, expansionBudget);
    if (maxNewProbes > 0) {
      for (const [target, baselineResult] of baselineResultsByTarget.entries()) {
        if (!baselineResult?.ok) continue;
        const cls = classifyBaseline(baselineResult);
        if (cls.kind !== 'ok') continue;
        const baselineProbe = baselineQueue.find((p) => p.target === target);
        if (!baselineProbe) continue;
        const host = baselineProbe.host;
        const priorProbes = allProbes.filter((p) => p.host === host);
        const prompt = buildExpandPrompt({
          baselineTarget: baselineProbe.url,
          baselineResult,
          approvedHosts: new Set([host]),
          priorProbes,
          maxNewProbes
        });
        let raw;
        try {
          raw = await llm.expand({ prompt, host, target, baselineResult });
        } catch (e) {
          emit({ type: 'expand', target, host, added: [], rejected: [], error: e.message || String(e) });
          continue;
        }
        const proposals = parseExpandResponse(raw);
        const added = [];
        const rejected = [];
        for (const p of proposals) {
          if (added.length + llmProposed.length >= maxNewProbes) break;
          const v = validateProposedProbe(p, approvedHosts, scopeTargetCheck);
          if (!v.ok) {
            rejected.push({ probe: p, reason: v.reason });
            continue;
          }
          // Dedup against already-planned probes.
          if (allProbes.some((existing) => existing.url === v.probe.url)) {
            rejected.push({ probe: p, reason: 'dedup' });
            continue;
          }
          const withHost = {
            ...v.probe,
            host: new URL(v.probe.url).hostname.toLowerCase(),
            target: v.probe.url
          };
          llmProposed.push(withHost);
          added.push(withHost);
        }
        emit({ type: 'expand', target, host, added, rejected });
      }
    }
  }

  // Phase 3: variants + LLM-proposed probes, together.
  await runQueue([...variantQueue, ...llmProposed]);

  // Phase 4: Skeptic re-review of findings. Runs if caller wired llm.review
  // and there are findings to review.
  let reviewedFindings = null;
  if (llm && typeof llm.review === 'function' && findings.length > 0) {
    const prompt = buildReviewPrompt({ findings });
    try {
      const raw = await llm.review({ prompt, findings });
      const reviews = parseReviewResponse(raw);
      reviewedFindings = findings.map((f, idx) => {
        const r = reviews.find((x) => Number(x?.idx) === idx) || {};
        const downgrade = ['info', 'low', 'medium', 'high'].includes(r.downgrade_to)
          ? r.downgrade_to
          : null;
        return {
          ...f,
          severity: downgrade || f.severity,
          originalSeverity: f.severity,
          verdict: r.verdict || 'needs_manual_review',
          verdictReason: String(r.reason || '').slice(0, 400)
        };
      });
      emit({ type: 'review', findings: reviewedFindings });
    } catch (e) {
      emit({ type: 'review', findings: null, error: e.message || String(e) });
    }
  }

  // Pass D: per-host breakdown.
  const perHost = {};
  for (const host of approvedHosts) {
    perHost[host] = {
      requests: 0,
      findings: 0,
      skipped: 0,
      llmProposed: 0,
      novel: 0,
      similar: 0,
      degenerate: 0,
      errors: 0
    };
  }
  for (const r of results) {
    const host = r.probe.host;
    if (!perHost[host]) continue;
    perHost[host].requests += 1;
    if (!r.result.ok) perHost[host].errors += 1;
    else if (r.triage.novelty === 'novel') perHost[host].novel += 1;
    else if (r.triage.novelty === 'similar') perHost[host].similar += 1;
    else if (r.triage.novelty === 'baseline_degenerate') perHost[host].degenerate += 1;
    if (r.probe.source === 'llm') perHost[host].llmProposed += 1;
  }
  for (const f of (reviewedFindings || findings)) {
    if (perHost[f.host]) perHost[f.host].findings += 1;
  }
  for (const [target, reason] of skippedTargets.entries()) {
    try {
      const h = new URL(target).hostname.toLowerCase();
      if (perHost[h]) perHost[h].skipped += 1;
    } catch (_e) { /* ignore */ }
    void reason;
  }

  const summary = {
    requests: results.length,
    approvedTargets,
    budget: b,
    findings: reviewedFindings || findings,
    findingsRaw: findings,
    llmProposedCount: llmProposed.length,
    skipped: [...skippedTargets.entries()].map(([target, reason]) => ({ target, reason })),
    perHost,
    novelty: {
      novel: results.filter((r) => r.triage.novelty === 'novel').length,
      similar: results.filter((r) => r.triage.novelty === 'similar').length,
      degenerate: results.filter((r) => r.triage.novelty === 'baseline_degenerate').length,
      errors: results.filter((r) => !r.result.ok).length
    }
  };
  emit({ type: 'done', summary });
  return summary;
}

module.exports = {
  DEFAULT_BUDGET,
  HARD_CEILING,
  DEGENERATE_STATUSES,
  clampBudget,
  generateProbes,
  runFuzzPlan,
  // Exported for Mythos reuse + unit tests:
  validateProposedProbe,
  buildExpandPrompt,
  parseExpandResponse,
  buildReviewPrompt,
  parseReviewResponse,
  triageProbe,
  sameShape,
  classifyBaseline,
  fetchWithTimeout
};
