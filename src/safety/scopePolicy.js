/**
 * v0.2 — Allowlist hosts / path prefixes; redirect safety.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * @typedef {{
 *   allowHosts: Set<string>,
 *   pathPrefixes: string[],
 *   blockCrossHostRedirects: boolean,
 * }} ScopePolicy
 */

/**
 * @param {string} filePath
 * @param {string} targetUrl fall back hostname when allowHosts omitted
 * @returns {ScopePolicy}
 */
export function loadScopePolicy(filePath, targetUrl) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Scope file not found: ${resolved}`);
  }

  const text = fs.readFileSync(resolved, 'utf8');
  /** @type {Record<string, unknown>} */
  let doc;
  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    doc = /** @type {Record<string, unknown>} */ (yaml.load(text));
  } else {
    doc = JSON.parse(text);
  }

  let host = '';
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    /* ignore */
  }

  /** @type {string[]} */
  let allowList = [];
  const ah = doc.allowHosts;
  if (Array.isArray(ah)) allowList = ah.map(String);
  else if (typeof ah === 'string') allowList = [ah];

  if (allowList.length === 0 && host) allowList = [host];

  const allowHosts = new Set(allowList.map((h) => h.toLowerCase()));

  /** @type {string[]} */
  let prefixes = ['/'];
  const pp = doc.pathPrefixes;
  if (Array.isArray(pp) && pp.length) {
    prefixes = pp.map((p) => (String(p).startsWith('/') ? String(p) : `/${String(p)}`));
  }

  return {
    allowHosts,
    pathPrefixes: prefixes,
    blockCrossHostRedirects: doc.blockCrossHostRedirects !== false,
  };
}

/**
 * @param {string} urlStr
 * @param {ScopePolicy | null | undefined} policy
 */
export function assertUrlInScope(urlStr, policy) {
  if (!policy || policy.allowHosts.size === 0) return { ok: true };

  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return { ok: false, reason: 'bad_url' };
  }

  const host = u.hostname.toLowerCase();
  if (!policy.allowHosts.has(host)) {
    return { ok: false, reason: 'host_not_allowed', host };
  }

  const pathname = u.pathname || '/';
  const prefixes = policy.pathPrefixes.length ? policy.pathPrefixes : ['/'];
  const okPath = prefixes.some((p) => {
    if (p === '/') return true;
    return pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p);
  });
  if (!okPath) return { ok: false, reason: 'path_prefix', pathname };

  return { ok: true };
}

/**
 * If redirect Location resolves off-allowHosts, report violation.
 *
 * @param {string} requestUrl
 * @param {number} status
 * @param {Headers} headers
 * @param {ScopePolicy | null | undefined} policy
 */
export function checkRedirectPolicy(requestUrl, status, headers, policy) {
  if (!policy?.blockCrossHostRedirects) return { ok: true };
  if (status < 300 || status >= 400) return { ok: true };

  const loc = headers.get('location');
  if (!loc) return { ok: true };

  let next;
  try {
    next = new URL(loc, requestUrl);
  } catch {
    return { ok: false, reason: 'bad_redirect_location', location: loc };
  }

  let reqHost;
  try {
    reqHost = new URL(requestUrl).hostname.toLowerCase();
  } catch {
    return { ok: true };
  }

  if (next.hostname.toLowerCase() !== reqHost && policy.allowHosts.size > 0) {
    if (!policy.allowHosts.has(next.hostname.toLowerCase())) {
      return {
        ok: false,
        reason: 'cross_host_redirect',
        location: next.href,
      };
    }
  }

  return { ok: true };
}
