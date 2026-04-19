/**
 * Layer 1 — Surface (REST slice)
 * Enumerate lightweight probes and capture observable facts only.
 */

import { assertUrlInScope } from '../safety/scopePolicy.js';

function joinUrl(origin, pathname) {
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${origin}${p}`;
}

/** @typedef {{ url: string, status: number | null, ok: boolean, contentType: string | null, bytes: number, error?: string }} Probe */

/**
 * @param {string} targetUrl full URL or template with `{id}`
 * @param {{
 *   headers?: Record<string,string>,
 *   timeoutMs: number,
 *   scopePolicy?: import('../safety/scopePolicy.js').ScopePolicy | null,
 *   rateLimiter?: { acquire: () => Promise<void> },
 * }} opts
 * @returns {Promise<{ origin: string, probes: Probe[], template: boolean }>}
 */
export async function probeRestSurface(targetUrl, opts) {
  let template = false;
  let canonical = targetUrl;
  if (targetUrl.includes('{id}')) {
    template = true;
    canonical = targetUrl.replace('{id}', '1').replace('{ID}', '1');
  }

  let origin;
  let pathname = '/';
  try {
    const u = new URL(canonical);
    origin = u.origin;
    pathname = u.pathname || '/';
  } catch (e) {
    throw new Error(`Invalid URL: ${targetUrl}`);
  }

  const derivedPaths = new Set([
    pathname,
    '/',
    '/health',
    '/healthz',
    '/ready',
    '/api',
    '/api/v1',
    '/docs',
    '/openapi.json',
  ]);

  const urls = [...derivedPaths].map((p) => joinUrl(origin, p));

  /** @type {Probe[]} */
  const probes = [];

  for (const url of urls) {
    if (opts.scopePolicy) {
      const sc = assertUrlInScope(url, opts.scopePolicy);
      if (!sc.ok) continue;
    }
    await opts.rateLimiter?.acquire?.();
    probes.push(await fetchProbe(url, opts));
  }

  return { origin, probes, template };
}

async function fetchProbe(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const init = {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { ...(opts.headers || {}) },
    };
    const res = await fetch(url, init);
    const buf = await res.arrayBuffer();
    clearTimeout(t);
    return {
      url,
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type'),
      bytes: buf.byteLength,
    };
  } catch (e) {
    clearTimeout(t);
    return {
      url,
      status: null,
      ok: false,
      contentType: null,
      bytes: 0,
      error: /** @type {Error} */ (e).message,
    };
  }
}
