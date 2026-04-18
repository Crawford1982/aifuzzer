/**
 * Layer 4 — HTTP execution (single transport agent for v0.1)
 */

import fs from 'fs';
import path from 'path';

/**
 * @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase
 */

/**
 * @param {FuzzCase[]} cases
 * @param {{ concurrency: number, timeoutMs: number, authHeader?: string | null }} opts
 */
export async function executeCases(cases, opts) {
  const results = await runPool(cases, opts.concurrency, (c) => runOne(c, opts));
  return results;
}

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

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: c.method || 'GET',
      headers,
      redirect: 'manual',
      signal: ctrl.signal,
    });
    const bodyText = await res.text();
    clearTimeout(t);
    const elapsed = Date.now() - started;

    return {
      caseId: c.id,
      family: c.family,
      url,
      status: res.status,
      elapsedMs: elapsed,
      headers: sanitizeHeaders(Object.fromEntries(res.headers)),
      bodyPreview: bodyText.slice(0, 1200),
      bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
      error: null,
    };
  } catch (e) {
    clearTimeout(t);
    return {
      caseId: c.id,
      family: c.family,
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
