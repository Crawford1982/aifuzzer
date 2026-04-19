/**
 * Namespace-style replay: same request with alternate principal (RESTler NameSpace analogue, bounded).
 */

import { executeCases } from '../execution/HttpFuzzAgent.js';
import { buildRouteInterestScores } from '../campaign/sessionMemory.js';
import { fingerprintBody, canonicalRouteKey } from './baseline.js';

/**
 * @param {string} token
 */
function bearer(token) {
  const t = token.trim();
  return t.startsWith('Bearer ') ? t : `Bearer ${t}`;
}

/**
 * @param {{
 *   execResults: unknown[],
 *   casesById: Map<string, import('../hypothesis/HypothesisEngine.js').FuzzCase>,
 *   transport: Record<string, unknown>,
 *   bodyRead: Record<string, unknown>,
 *   concurrency: number,
 *   budget: number,
 *   primaryAuth: string,
 *   altAuth: string,
 * }} ctx
 */
export async function runNamespaceAuthReplay(ctx) {
  const scores = buildRouteInterestScores(ctx.execResults);

  /** @type {Array<{ r: Record<string, unknown>, fc: import('../hypothesis/HypothesisEngine.js').FuzzCase }>} */
  const candidates = [];

  for (const raw of ctx.execResults) {
    const r = /** @type {Record<string, unknown>} */ (raw);
    const cid = String(r.caseId || '');
    if (cid.includes(':authAlt')) continue;
    if (!cid || cid.includes('omit_auth')) continue;
    if (String(r.method || 'GET').toUpperCase() !== 'GET') continue;
    if (Number(r.status) !== 200) continue;

    const fc = ctx.casesById.get(cid);
    if (!fc || fc.omitAuth) continue;

    candidates.push({ r, fc });
  }

  candidates.sort((a, b) => {
    try {
      const ma = String(a.r.method || a.fc.method || 'GET');
      const mb = String(b.r.method || b.fc.method || 'GET');
      const ka = canonicalRouteKey(ma, String(a.r.url || ''));
      const kb = canonicalRouteKey(mb, String(b.r.url || ''));
      return (scores.get(ka) || 0) - (scores.get(kb) || 0);
    } catch {
      return 0;
    }
  });
  candidates.reverse();

  const seenUrl = new Set();
  /** @type {import('../hypothesis/HypothesisEngine.js').FuzzCase[]} */
  const batch = [];

  for (const { r, fc } of candidates) {
    if (batch.length >= ctx.budget) break;
    const u = String(r.url || '');
    if (!u || seenUrl.has(u)) continue;
    seenUrl.add(u);

    batch.push({
      ...fc,
      id: `${fc.id}:authAlt`,
      omitAuth: false,
      family: 'NAMESPACE_AUTH_REPLAY',
    });
  }

  if (!batch.length) return [];

  const altTransport = {
    ...ctx.transport,
    authHeader: bearer(ctx.altAuth),
  };

  return executeCases(batch, {
    ...altTransport,
    ...ctx.bodyRead,
    concurrency: Math.min(ctx.concurrency, 4),
  });
}

/**
 * Primary vs alt-auth replay: both 200 with substantial identical body → possible cross-principal access.
 *
 * @param {unknown[]} execResults
 */
export function checkNamespacePrincipalOverlap(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  const byCase = new Map(execResults.map((x) => [String(/** @type {any} */ (x).caseId), x]));

  for (const raw of execResults) {
    const r = /** @type {Record<string, unknown>} */ (raw);
    const cid = String(r.caseId || '');
    if (!cid.endsWith(':authAlt')) continue;

    const baseId = cid.replace(/:authAlt$/, '');
    const primary = byCase.get(baseId);
    if (!primary) continue;

    const p = /** @type {Record<string, unknown>} */ (primary);
    if (String(p.url || '') !== String(r.url || '')) continue;
    if (String(p.method || 'GET').toUpperCase() !== 'GET') continue;
    if (Number(p.status) !== 200 || Number(r.status) !== 200) continue;

    const bp = String(p.bodyPreview || '');
    const ba = String(r.bodyPreview || '');
    if (bp.length < 64 || ba.length < 64) continue;

    if (fingerprintBody(bp) === fingerprintBody(ba)) {
      out.push({
        checkerId: 'namespace_cross_principal_overlap',
        severity: 'high',
        title: 'Same GET body under primary vs alternate auth',
        detail:
          'Same URL returned identical body fingerprints for primary Authorization and --auth-alt (possible cross-tenant / namespace issue). Verify intended.',
        evidenceCaseIds: [baseId, cid],
        caseId: cid,
        url: r.url,
      });
    }
  }

  return out;
}
