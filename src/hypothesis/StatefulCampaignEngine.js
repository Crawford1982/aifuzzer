/**
 * Milestone B — Build small multi-step campaigns from dependency edges + OpenAPI ops map.
 */

import { pickExampleValue } from './SpecHypothesisEngine.js';

/** @typedef {import('../openapi/OpenApiLoader.js').NormalizedOperation} NormalizedOperation */

/**
 * @typedef {{
 *   id: string,
 *   edge: import('../state/dependencyGraph.js').ProducerConsumerEdge,
 *   steps: ChainStep[],
 * }} StatefulChain
 */

/**
 * @typedef {{
 *   operationId: string,
 *   method: string,
 *   pathTemplate: string,
 *   phase: 'producer' | 'consumer',
 * }} ChainStep
 */

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 * @param {{ edges: import('../state/dependencyGraph.js').ProducerConsumerEdge[] }} graph
 * @param {{ maxChains: number }} opts
 * @returns {StatefulChain[]}
 */
export function buildStatefulChains(spec, graph, opts) {
  const byId = new Map(spec.operations.map((o) => [o.operationId, o]));
  /** @type {StatefulChain[]} */
  const chains = [];
  /** @type {Set<string>} */
  const seenPair = new Set();

  for (const edge of graph.edges) {
    if (chains.length >= opts.maxChains) break;
    const pairKey = `${edge.producerId}->${edge.consumerId}`;
    if (seenPair.has(pairKey)) continue;
    seenPair.add(pairKey);
    const prod = byId.get(edge.producerId);
    const cons = byId.get(edge.consumerId);
    if (!prod || !cons) continue;

    chains.push({
      id: `chain:${edge.kind}:${prod.operationId}->${cons.operationId}`,
      edge,
      steps: [
        { operationId: prod.operationId, method: prod.method, pathTemplate: prod.pathTemplate, phase: 'producer' },
        { operationId: cons.operationId, method: cons.method, pathTemplate: cons.pathTemplate, phase: 'consumer' },
      ],
    });
  }

  return chains;
}

/**
 * Build URL for an operation using concrete path param values.
 *
 * @param {string} baseUrl
 * @param {NormalizedOperation} op
 * @param {Record<string, string>} pathValues
 */
export function buildOperationUrl(baseUrl, op, pathValues) {
  let path = op.pathTemplate;
  for (const [k, v] of Object.entries(pathValues)) {
    path = path.replace(new RegExp(`\\{${escapeRe(k)}\\}`, 'gi'), encodeURIComponent(String(v)));
  }
  const u = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);

  for (const param of op.parameters) {
    if (param.in !== 'query') continue;
    if (!param.required && !param.schema) continue;
    u.searchParams.set(param.name, String(pickExampleValue(param.schema)));
  }

  return u.toString();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
