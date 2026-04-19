/**
 * Layer 4 — HTTP execution (single transport agent for v0.1)
 */

import fs from 'fs';
import path from 'path';

import { assertUrlInScope, checkRedirectPolicy } from '../safety/scopePolicy.js';

/**
 * @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase
 */

/**
 * @param {FuzzCase[]} cases
 * @param {{
 *   concurrency: number,
 *   timeoutMs: number,
 *   authHeader?: string | null,
 *   captureFullBody?: boolean,
 *   scopePolicy?: import('../safety/scopePolicy.js').ScopePolicy | null,
 *   rateLimiter?: { acquire: () => Promise<void> },
 * }} opts
 */
export async function executeCases(cases, opts) {
  const results = await runPool(cases, opts.concurrency, (c) => runOne(c, opts));
  return results;
}

/**
 * Single request (for stateful chains). Same transport rules as concurrent pool.
 *
 * @param {FuzzCase} c
 * @param {{
 *   timeoutMs: number,
 *   authHeader?: string | null,
 *   captureFullBody?: boolean,
 *   scopePolicy?: import('../safety/scopePolicy.js').ScopePolicy | null,
 *   rateLimiter?: { acquire: () => Promise<void> },
 * }} opts
 */
export async function executeOne(c, opts) {
  return runOne(c, opts);
}

/**
 * @param {FuzzCase} c
 * @param {{
 *   timeoutMs: number,
 *   authHeader?: string | null,
 *   captureFullBody?: boolean,
 *   scopePolicy?: import('../safety/scopePolicy.js').ScopePolicy | null,
 *   rateLimiter?: { acquire: () => Promise<void> },
 * }} opts
 */
async function runOne(c, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const headers = { ...(c.headers || {}) };

  if (opts.authHeader && !c.omitAuth) {
    if (!headers.Authorization && !headers.authorization) {
      headers.Authorization = opts.authHeader.startsWith('Bearer ')
        ? opts.authHeader
        : `Bearer ${opts.authHeader}`;
    }
  }

  let url = c.url;
  if (c.meta && c.meta.query) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(c.meta.query)) u.searchParams.set(k, String(v));
    url = u.toString();
  }

  const scopeCheck = assertUrlInScope(url, opts.scopePolicy);
  if (!scopeCheck.ok) {
    clearTimeout(t);
    return {
      caseId: c.id,
      family: c.family,
      method: c.method || 'GET',
      url,
      status: null,
      elapsedMs: 0,
      headers: {},
      bodyPreview: '',
      bodyBytes: 0,
      error: `out_of_scope:${scopeCheck.reason}`,
    };
  }

  await opts.rateLimiter?.acquire?.();

  /** @type {string | undefined} */
  let body;
  if (c.meta && c.meta.jsonBody !== undefined) {
    body =
      typeof c.meta.jsonBody === 'string'
        ? c.meta.jsonBody
        : JSON.stringify(c.meta.jsonBody);
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = c.meta.contentType || 'application/json';
    }
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: c.method || 'GET',
      headers,
      redirect: 'manual',
      signal: ctrl.signal,
      ...(body !== undefined ? { body } : {}),
    });

    const rd = checkRedirectPolicy(url, res.status, res.headers, opts.scopePolicy);
    if (!rd.ok) {
      const bodyText = await res.text();
      clearTimeout(t);
      return {
        caseId: c.id,
        family: c.family,
        method: c.method || 'GET',
        url,
        status: res.status,
        elapsedMs: Date.now() - started,
        headers: sanitizeHeaders(Object.fromEntries(res.headers)),
        bodyPreview: bodyText.slice(0, 400),
        bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
        error: `redirect_policy:${rd.reason}${rd.location ? ` → ${rd.location}` : ''}`,
      };
    }

    const bodyText = await res.text();
    clearTimeout(t);
    const elapsed = Date.now() - started;

    const cap = Boolean(opts.captureFullBody);
    return {
      caseId: c.id,
      family: c.family,
      method: c.method || 'GET',
      url,
      status: res.status,
      elapsedMs: elapsed,
      headers: sanitizeHeaders(Object.fromEntries(res.headers)),
      bodyPreview: bodyText.slice(0, 1200),
      ...(cap ? { fullBody: bodyText } : {}),
      bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
      error: null,
    };
  } catch (e) {
    clearTimeout(t);
    return {
      caseId: c.id,
      family: c.family,
      method: c.method || 'GET',
      url: c.url,
      status: null,
      elapsedMs: Date.now() - started,
      headers: {},
      bodyPreview: '',
      bodyBytes: 0,
      error: /** @type {Error} */ (e).message,
    };
  }
}

function sanitizeHeaders(h) {
  const out = { ...h };
  for (const k of Object.keys(out)) {
    if (/auth|cookie|token|secret/i.test(k)) out[k] = '[redacted]';
  }
  return out;
}

async function runPool(items, concurrency, worker) {
  /** @type {unknown[]} */
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => runner()));
  return results;
}

export function ensureOutputDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return path.resolve(dir);
}
