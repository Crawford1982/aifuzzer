/**
 * Replayable evidence — curl strings without trusting LLM prose.
 */

/** @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase */

/**
 * @param {FuzzCase} c
 * @param {{ authHeader?: string | null }} opts
 */
export function fuzzCaseToCurl(c, opts = {}) {
  const method = (c.method || 'GET').toUpperCase();
  let url = c.url;
  if (c.meta?.query) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(c.meta.query)) u.searchParams.set(k, String(v));
    url = u.toString();
  }

  const parts = [`curl -sS -X ${shellQuote(method)} ${shellQuote(url)}`];

  const headers = { ...(c.headers || {}) };
  if (opts.authHeader && !c.omitAuth) {
    const a = opts.authHeader.startsWith('Bearer ') ? opts.authHeader : `Bearer ${opts.authHeader}`;
    if (!headers.Authorization && !headers.authorization) headers.Authorization = a;
  }

  for (const [k, v] of Object.entries(headers)) {
    parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  }

  if (c.meta?.jsonBody !== undefined) {
    const body =
      typeof c.meta.jsonBody === 'string'
        ? c.meta.jsonBody
        : JSON.stringify(c.meta.jsonBody);
    parts.push(`-H ${shellQuote('Content-Type: application/json')}`);
    parts.push(`--data ${shellQuote(body)}`);
  }

  return parts.join(' \\\n  ');
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {Array<{ caseId?: string, url?: string, status?: number | null }>} results
 */
export function attachEvidenceCurls(results, fuzzCasesById, opts = {}) {
  /** @type {typeof results} */
  const out = [];
  for (const r of results) {
    const id = /** @type {string} */ (r.caseId);
    const fc = fuzzCasesById.get(id);
    const curl = fc ? fuzzCaseToCurl(fc, opts) : null;
    out.push({ ...r, replayCurl: curl });
  }
  return out;
}
