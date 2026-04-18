'use strict';

/**
 * Dynatrace (HackerOne) program guardrails for HTTP fuzz targets.
 * Aligns with published scope: Dynatrace / labs hosts only — not GitHub for automated probes.
 */

const ALLOW_SUFFIXES = ['.dynatrace.com', '.dynatrace.cloud', '.dynatracelabs.com'];

function hostAllowedForDynatraceProgram(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (h === 'github.com' || h.endsWith('.github.com')) return false;
  return ALLOW_SUFFIXES.some((s) => h === s.slice(1) || h.endsWith(s));
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function checkDynatraceProgramTarget(urlString) {
  const raw = String(urlString || '').trim();
  if (!raw) return { ok: false, reason: 'empty_url' };
  let u;
  try {
    u = new URL(raw);
  } catch (_e) {
    return { ok: false, reason: 'invalid_url' };
  }
  const host = u.hostname.toLowerCase();
  if (host === 'github.com' || host.endsWith('.github.com')) {
    return {
      ok: false,
      reason:
        'GitHub is blocked for automated HTTP probes; use manual review for allowed Dynatrace repos per policy.'
    };
  }
  if (!hostAllowedForDynatraceProgram(host)) {
    return {
      ok: false,
      reason: `Host must be under Dynatrace program scope (${ALLOW_SUFFIXES.join(', ')}): ${host}`
    };
  }
  return { ok: true };
}

function assertDynatraceProgramTarget(urlString) {
  const r = checkDynatraceProgramTarget(urlString);
  if (!r.ok) throw new Error(r.reason);
}

module.exports = {
  ALLOW_SUFFIXES,
  hostAllowedForDynatraceProgram,
  checkDynatraceProgramTarget,
  assertDynatraceProgramTarget
};
