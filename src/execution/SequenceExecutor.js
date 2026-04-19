/**
 * Sequential HTTP steps with live binding — deterministic; no LLM.
 */

/** @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase */

import { executeOne } from './HttpFuzzAgent.js';
import { buildMinimalJsonBody, pickExampleValue } from '../hypothesis/SpecHypothesisEngine.js';
import { safeJsonParse, extractIdFromCollectionFirst, extractIdFromResource } from '../state/handleExtract.js';
import { buildOperationUrl } from '../hypothesis/StatefulCampaignEngine.js';

/**
 * @typedef {{
 *   chainId: string,
 *   kind: 'list_to_item' | 'post_to_item',
 *   viaParam: string,
 *   producerOp: import('../openapi/OpenApiLoader.js').NormalizedOperation,
 *   consumerOp: import('../openapi/OpenApiLoader.js').NormalizedOperation,
 *   steps: Array<{
 *     caseId: string,
 *     method: string,
 *     buildUrl: (ctx: Record<string, string>) => string,
 *     omitAuth?: boolean,
 *     extract?: 'array_first_id' | 'object_id',
 *     family: string,
 *   }>,
 * }} CompiledStatefulChain
 */

/**
 * @param {import('../hypothesis/StatefulCampaignEngine.js').StatefulChain} chain
 * @param {Map<string, import('../openapi/OpenApiLoader.js').NormalizedOperation>} byId
 * @param {string} baseUrl
 * @returns {CompiledStatefulChain}
 */
export function compileStatefulChain(chain, byId, baseUrl) {
  const edge = chain.edge;
  const prod = byId.get(chain.steps[0].operationId);
  const cons = byId.get(chain.steps[1].operationId);
  if (!prod || !cons) throw new Error('compileStatefulChain: missing operation');

  /** @type {CompiledStatefulChain['steps']} */
  const steps = [];

  steps.push({
    caseId: `${chain.id}:producer`,
    method: prod.method,
    buildUrl: () => buildOperationUrl(baseUrl, prod, defaultPathValues(prod)),
    omitAuth: false,
    extract: edge.kind === 'list_to_item' ? 'array_first_id' : 'object_id',
    family: 'CHAIN_PRODUCER',
  });

  steps.push({
    caseId: `${chain.id}:consumer`,
    method: cons.method,
    buildUrl: (ctx) => {
      const pid = ctx[edge.viaParam];
      if (!pid) throw new Error(`Missing bind ${edge.viaParam} for consumer`);
      const pv = { ...defaultPathValues(cons), [edge.viaParam]: pid };
      return buildOperationUrl(baseUrl, cons, pv);
    },
    omitAuth: false,
    family: 'CHAIN_CONSUMER',
  });

  return {
    chainId: chain.id,
    kind: edge.kind,
    viaParam: edge.viaParam,
    producerOp: prod,
    consumerOp: cons,
    steps,
  };
}

/**
 * @param {CompiledStatefulChain} compiled
 * @param {{ timeoutMs: number, authHeader?: string | null }} opts
 */
export async function executeStatefulChain(compiled, opts) {
  /** @type {Record<string, string>} */
  const ctx = {};
  /** @type {Awaited<ReturnType<typeof executeOne>>[]} */
  const results = [];
  /** @type {FuzzCase[]} */
  const fuzzCases = [];

  const prodStep = compiled.steps[0];
  const consStep = compiled.steps[1];

  const case1 = operationToFuzzCase(compiled.producerOp, prodStep.caseId, prodStep.buildUrl(ctx), prodStep);
  fuzzCases.push(case1);
  const r1 = await executeOne(case1, {
    ...opts,
    captureFullBody: Boolean(prodStep.extract),
  });
  results.push(r1);

  const text = r1.fullBody || r1.bodyPreview || '';
  const parsed = safeJsonParse(text);
  if (prodStep.extract === 'array_first_id') {
    const id = extractIdFromCollectionFirst(parsed);
    if (id) ctx[compiled.viaParam] = id;
  } else if (prodStep.extract === 'object_id') {
    const id = extractIdFromResource(parsed);
    if (id) ctx[compiled.viaParam] = id;
  }

  if (!ctx[compiled.viaParam]) {
    results.push({
      caseId: consStep.caseId,
      family: 'CHAIN_SKIPPED',
      method: consStep.method,
      url: '',
      status: null,
      elapsedMs: 0,
      headers: {},
      bodyPreview: '',
      bodyBytes: 0,
      error: `bind_failed: could not extract ${compiled.viaParam} from producer response`,
    });
    return { ctx, results, fuzzCases, chainId: compiled.chainId };
  }

  let url2;
  try {
    url2 = consStep.buildUrl(ctx);
  } catch (e) {
    results.push({
      caseId: consStep.caseId,
      family: 'CHAIN_SKIPPED',
      method: consStep.method,
      url: '',
      status: null,
      elapsedMs: 0,
      headers: {},
      bodyPreview: '',
      bodyBytes: 0,
      error: /** @type {Error} */ (e).message,
    });
    return { ctx, results, fuzzCases, chainId: compiled.chainId };
  }

  const case2 = operationToFuzzCase(compiled.consumerOp, consStep.caseId, url2, consStep);
  fuzzCases.push(case2);
  const r2 = await executeOne(case2, opts);
  results.push(r2);

  return { ctx, results, fuzzCases, chainId: compiled.chainId };
}

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedOperation} op
 */
function defaultPathValues(op) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of op.parameters) {
    if (p.in !== 'path') continue;
    out[p.name] = String(pickExampleValue(p.schema));
  }
  return out;
}

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedOperation} op
 * @param {string} id
 * @param {string} url
 * @param {{ omitAuth?: boolean, family: string }} step
 */
function operationToFuzzCase(op, id, url, step) {
  /** @type {FuzzCase} */
  const c = {
    id,
    method: op.method,
    url,
    headers: {},
    omitAuth: Boolean(step.omitAuth),
    family: step.family,
  };

  /** @type {Record<string, string>} */
  const qh = {};
  for (const p of op.parameters) {
    if (p.in === 'header') qh[p.name] = String(pickExampleValue(p.schema));
  }
  if (Object.keys(qh).length) c.headers = qh;

  if (['POST', 'PUT', 'PATCH'].includes(op.method) && op.requestBody?.schema) {
    c.meta = {
      jsonBody: buildMinimalJsonBody(op.requestBody.schema),
      contentType: 'application/json',
    };
  }

  return c;
}

