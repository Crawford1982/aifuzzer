/**
 * REST-style producer → consumer edges from normalized OpenAPI operations (heuristic).
 * Mirrors RESTler-style dependency thinking without embedding RESTler.
 */

/**
 * @typedef {{ producerId: string, consumerId: string, viaParam: string, kind: 'list_to_item' | 'post_to_item' }} ProducerConsumerEdge
 */

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} operations
 * @returns {{ edges: ProducerConsumerEdge[], nodes: Set<string> }}
 */
export function inferProducerConsumerEdges(operations) {
  /** @type {ProducerConsumerEdge[]} */
  const edges = [];
  const nodes = new Set(operations.map((o) => o.operationId));

  /** @type {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} */
  const listGets = [];
  /** @type {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} */
  const itemGets = [];
  /** @type {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} */
  const collectionPosts = [];

  for (const op of operations) {
    const m = op.method;
    const segs = pathSegments(op.pathTemplate);
    const hasPathParams = op.pathParamNames.length > 0;

    if (m === 'GET' && !hasPathParams && segs.length > 0) listGets.push(op);
    if (m === 'GET' && hasPathParams && op.pathParamNames.some(isIdLikeName)) itemGets.push(op);
    if ((m === 'POST' || m === 'PUT') && !hasPathParams && segs.length > 0) collectionPosts.push(op);
  }

  for (const item of itemGets) {
    const itemSegs = pathSegments(item.pathTemplate);
    const via = item.pathParamNames.find(isIdLikeName) || item.pathParamNames[0];
    if (!via) continue;

    const prefix = collectionPrefix(itemSegs);
    if (!prefix) continue;

    for (const list of listGets) {
      const ls = pathSegments(list.pathTemplate);
      if (segmentsMatchCollection(ls, prefix)) {
        edges.push({
          producerId: list.operationId,
          consumerId: item.operationId,
          viaParam: via,
          kind: 'list_to_item',
        });
      }
    }

    for (const post of collectionPosts) {
      const ps = pathSegments(post.pathTemplate);
      if (segmentsMatchCollection(ps, prefix)) {
        edges.push({
          producerId: post.operationId,
          consumerId: item.operationId,
          viaParam: via,
          kind: 'post_to_item',
        });
      }
    }
  }

  const deduped = dedupeEdges(edges);
  return { edges: deduped, nodes };
}

/**
 * @param {ProducerConsumerEdge[]} edges
 */
function dedupeEdges(edges) {
  const seen = new Set();
  /** @type {ProducerConsumerEdge[]} */
  const out = [];
  for (const e of edges) {
    const k = `${e.producerId}|${e.consumerId}|${e.viaParam}|${e.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * @param {string} pathTemplate
 */
function pathSegments(pathTemplate) {
  return pathTemplate
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith('{') && s.endsWith('}') ? `{param}` : s));
}

/**
 * @param {string[]} itemSegs full path including {param} tokens
 */
function collectionPrefix(itemSegs) {
  if (itemSegs.length < 2) return null;
  if (itemSegs[itemSegs.length - 1] !== '{param}') return null;
  return itemSegs.slice(0, -1);
}

/**
 * List path `/posts` matches prefix `['posts']`
 *
 * @param {string[]} listSegs
 * @param {string[]} prefix
 */
function segmentsMatchCollection(listSegs, prefix) {
  if (listSegs.length !== prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (listSegs[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * @param {string} name
 */
function isIdLikeName(name) {
  return /^id$/i.test(name) || /id$/i.test(name) || /^[a-z]+Id$/i.test(name);
}
