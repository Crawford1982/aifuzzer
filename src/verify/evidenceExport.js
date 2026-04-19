/**
 * Milestone D — HAR + structured replay bundle (no LLM prose).
 */

/** @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase */

import { fuzzCaseToCurl } from './evidencePack.js';

/**
 * @param {Record<string, string>} h
 */
function redactHeaders(h) {
  const out = { ...h };
  for (const k of Object.keys(out)) {
    if (/auth|cookie|token|secret|authorization/i.test(k)) out[k] = '[redacted]';
  }
  return out;
}

/**
 * Build request headers as sent by HttpFuzzAgent (approximation for replay/HAR).
 *
 * @param {FuzzCase} c
 * @param {{ authHeader?: string | null }} opts
 */
export function buildRequestHeadersForEvidence(c, opts = {}) {
  /** @type {Record<string, string>} */
  const headers = { ...(c.headers || {}) };
  if (opts.authHeader && !c.omitAuth) {
    const a = opts.authHeader.startsWith('Bearer ')
      ? opts.authHeader
      : `Bearer ${opts.authHeader}`;
    if (!headers.Authorization && !headers.authorization) headers.Authorization = a;
  }
  if (c.meta?.jsonBody !== undefined) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = c.meta.contentType || 'application/json';
    }
  }
  return redactHeaders(headers);
}

/**
 * @param {FuzzCase} c
 */
function buildRequestBodyText(c) {
  if (c.meta?.jsonBody === undefined) return '';
  const raw =
    typeof c.meta.jsonBody === 'string'
      ? c.meta.jsonBody
      : JSON.stringify(c.meta.jsonBody);
  return raw;
}

/**
 * @param {unknown} r
 */
function resultRow(r) {
  return /** @type {Record<string, unknown>} */ (r);
}

/**
 * HAR 1.2 log object.
 *
 * @param {unknown[]} execResults
 * @param {Map<string, FuzzCase>} casesById
 * @param {{ generatedAt?: string, authHeader?: string | null }} opts
 */
export function buildHarLog(execResults, casesById, opts = {}) {
  const baseMs = opts.generatedAt ? Date.parse(opts.generatedAt) || Date.now() : Date.now();
  /** @type {unknown[]} */
  const entries = [];

  for (let i = 0; i < execResults.length; i++) {
    const r = resultRow(execResults[i]);
    const caseId = String(r.caseId || '');
    const c = caseId ? casesById.get(caseId) : undefined;
    const method = String(r.method || 'GET').toUpperCase();
    const url = String(r.url || '');
    const elapsed = Number(r.elapsedMs ?? 0) || 0;
    const status = r.status != null ? Number(r.status) : 0;

    /** @type {{ name: string, value: string }[]} */
    let reqHeaders = [];
    let bodyText = '';
    /** @type {{ name: string, value: string }[]} */
    let queryString = [];

    if (url) {
      try {
        const u = new URL(url);
        queryString = [];
        u.searchParams.forEach((value, name) => {
          queryString.push({ name, value });
        });
      } catch {
        queryString = [];
      }
    }

    if (c) {
      const hdrs = buildRequestHeadersForEvidence(c, { authHeader: opts.authHeader ?? null });
      reqHeaders = Object.entries(hdrs).map(([name, value]) => ({ name, value }));
      bodyText = buildRequestBodyText(c);
    } else if (url) {
      try {
        const u = new URL(url);
        reqHeaders = [{ name: 'Host', value: u.host }];
      } catch {
        reqHeaders = [];
      }
    }

    const resHeaders = redactHeaders(
      /** @type {Record<string, string>} */ (
        r.headers && typeof r.headers === 'object' ? r.headers : {}
      ),
    );
    const responseHeaderPairs = Object.entries(resHeaders).map(([name, value]) => ({
      name,
      value: String(value),
    }));

    const resBody = r.error ? '' : String(r.bodyPreview || '');
    const mime =
      responseHeaderPairs.find((h) => h.name.toLowerCase() === 'content-type')?.value ||
      'application/octet-stream';

    entries.push({
      startedDateTime: new Date(baseMs + i).toISOString(),
      time: elapsed,
      request: {
        method,
        url: url || 'about:blank',
        httpVersion: 'HTTP/1.1',
        headers: reqHeaders,
        queryString,
        cookies: [],
        headersSize: -1,
        bodySize: Buffer.byteLength(bodyText, 'utf8'),
        postData:
          bodyText.length > 0
            ? {
                mimeType: 'application/json',
                text: bodyText,
              }
            : undefined,
      },
      response: {
        status,
        statusText: status ? (status >= 400 ? 'Error' : 'OK') : '',
        httpVersion: 'HTTP/1.1',
        headers: responseHeaderPairs,
        content: {
          size: Number(r.bodyBytes ?? 0) || Buffer.byteLength(resBody, 'utf8'),
          mimeType: mime.split(';')[0].trim(),
          text: resBody,
          comment: r.error ? String(r.error) : 'bodyPreview may be truncated in capture',
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: Buffer.byteLength(resBody, 'utf8'),
      },
      cache: {},
      timings: {
        send: 0,
        wait: elapsed,
        receive: 0,
      },
    });
  }

  return {
    log: {
      version: '1.2',
      creator: { name: 'mythos-fuzzer', version: '0.2.0' },
      pages: [],
      entries,
    },
  };
}

/**
 * Structured replay bundle (JSON) — inspectable without HAR tooling.
 *
 * @param {unknown[]} execResults
 * @param {Map<string, FuzzCase>} casesById
 * @param {{ generatedAt?: string, authHeader?: string | null }} opts
 */
export function buildReplayBundle(execResults, casesById, opts = {}) {
  /** @type {Array<Record<string, unknown>>} */
  const entries = [];

  for (let i = 0; i < execResults.length; i++) {
    const r = resultRow(execResults[i]);
    const caseId = String(r.caseId || '');
    const c = caseId ? casesById.get(caseId) : undefined;
    const curl = c ? fuzzCaseToCurl(c, { authHeader: opts.authHeader ?? null }) : null;

    entries.push({
      index: i,
      caseId,
      family: r.family,
      timingMs: r.elapsedMs,
      error: r.error ?? null,
      request: {
        method: r.method,
        url: r.url,
        headers: c ? buildRequestHeadersForEvidence(c, { authHeader: opts.authHeader ?? null }) : {},
        bodyText: c ? buildRequestBodyText(c) : '',
      },
      response: {
        status: r.status,
        headers: r.headers || {},
        bodyPreview: r.bodyPreview ?? '',
        bodyBytes: r.bodyBytes ?? 0,
        note: 'response body is preview-only unless chain capture required full body',
      },
      replayCurl: curl,
    });
  }

  return {
    format: 'mythos-replay-bundle',
    version: 1,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    creator: 'mythos-fuzzer',
    entryCount: entries.length,
    entries,
  };
}
