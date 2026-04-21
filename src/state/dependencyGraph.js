/**
 * REST-style producer → consumer edges from normalized OpenAPI operations (heuristic).
 * Covers flat CRUD, nested sub-resources (/a/{id}/b), and POST→child reads.
 */

/**
 * @typedef {{
 *   producerId: string,
 *   consumerId: string,
 *   viaParam: string,
 *   kind:
 *     | 'list_to_item'
 *     | 'post_to_item'
 *     | 'post_to_list_get'
 *     | 'list_to_scoped_subresource'
 *     | 'post_to_scoped_subresource'
 *     | 'item_to_scoped_subresource',
 * }} ProducerConsumerEdge
 */

/** Shared ID-ish parameter detector (opaque handles, UUID-ish names). */
export function isIdLikeParamName(name) {
  if (!name || typeof name !== 'string') return false;
  if (/^id$/i.test(name)) return true;
  if (/(_id|Id|UUID|Uuid|Guid|guid|Key|key|Ref|ref|Hash|hash)$/i.test(name)) return true;
  if (/^[a-z]+Id$/i.test(name)) return true;
  if (/^(uid|pk|slug|handle|token|name)$/i.test(name)) return true;
  return false;
}

/**
 * @param {string} pathTemplate
 * @returns {string[]}
 */
export function templateSegmentsRaw(pathTemplate) {
  return pathTemplate.split('/').filter(Boolean);
}

/**
 * Structural segments for legacy matching — dynamic segments normalized.
 *
 * @param {string} pathTemplate
 */
function pathSegmentsNormalized(pathTemplate) {
  return templateSegmentsRaw(pathTemplate).map((s) =>
    s.startsWith('{') && s.endsWith('}') ? `{param}` : s
  );
}

/**
 * Path ends with `.../{param}/staticTail` (sub-resource under a bound id).
 *
 * @param {string} pathTemplate
 * @returns {{ viaParam: string, staticTail: string, prefixSegments: string[] } | null}
 */
export function parseScopedSubresourcePath(pathTemplate) {
  const raw = templateSegmentsRaw(pathTemplate);
  if (raw.length < 2) return null;
  const last = raw[raw.length - 1];
  if (last.startsWith('{') && last.endsWith('}')) return null;
  const beforeLast = raw[raw.length - 2];
  if (!(beforeLast.startsWith('{') && beforeLast.endsWith('}'))) return null;
  const viaParam = beforeLast.slice(1, -1);
  if (!isIdLikeParamName(viaParam)) return null;
  const prefixSegments = raw.slice(0, -2);
  return { viaParam, staticTail: last, prefixSegments };
}

/**
 * @param {string} pathTemplate
 * @param {string} viaParam
 */
function parentItemPathTemplate(pathTemplate, viaParam) {
  const scoped = parseScopedSubresourcePath(pathTemplate);
  if (!scoped) return null;
  const base = scoped.prefixSegments.length ? `/${scoped.prefixSegments.join('/')}` : '';
  return `${base}/{${viaParam}}`;
}

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} operations
 * @returns {{ edges: ProducerConsumerEdge[], nodes: Set<string> }}
 */
export function inferProducerConsumerEdges(operations) {
  /** @type {ProducerConsumerEdge[]} */
  const edges = [];

  /** @type {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} */
  const listGets = [];
  /** @type {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} */
  const itemGets = [];
  /** @type {import('../openapi/OpenApiLoader.js').NormalizedOperation[]} */
  const collectionPosts = [];

  for (const op of operations) {
    const m = op.method;
    const segs = pathSegmentsNormalized(op.pathTemplate);
    const hasPathParams = op.pathParamNames.length > 0;

    if (m === 'GET' && !hasPathParams && segs.length > 0) listGets.push(op);
    if (m === 'GET' && hasPathParams && op.pathParamNames.some(isIdLikeParamName)) itemGets.push(op);
    if ((m === 'POST' || m === 'PUT') && !hasPathParams && segs.length > 0) collectionPosts.push(op);
  }

  for (const item of itemGets) {
    const itemSegs = pathSegmentsNormalized(item.pathTemplate);
    const via = item.pathParamNames.find(isIdLikeParamName) || item.pathParamNames[0];
    if (!via) continue;

    const prefix = collectionPrefixFlat(itemSegs);
    if (!prefix) continue;

    for (const list of listGets) {
      const ls = pathSegmentsNormalized(list.pathTemplate);
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
      const ps = pathSegmentsNormalized(post.pathTemplate);
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

  /** POST create on collection → GET list at same path or …/all (crAPI-style). */
  for (const post of collectionPosts) {
    const postKey = normalizePathKey(post.pathTemplate);
    for (const list of listGets) {
      const listKey = normalizePathKey(list.pathTemplate);
      if (listKey === postKey || listKey === `${postKey}/all`) {
        edges.push({
          producerId: post.operationId,
          consumerId: list.operationId,
          viaParam: '_sequence',
          kind: 'post_to_list_get',
        });
      }
    }
  }

  /** Nested /posts/{id}/comments — bind from list or POST or parent GET. */
  for (const cons of operations) {
    if (cons.method !== 'GET') continue;
    const scoped = parseScopedSubresourcePath(cons.pathTemplate);
    if (!scoped) continue;
    const { viaParam, prefixSegments } = scoped;

    const listPath =
      prefixSegments.length === 0 ? '/' : `/${prefixSegments.join('/')}`;

    for (const list of listGets) {
      if (normalizePathKey(list.pathTemplate) !== normalizePathKey(listPath)) continue;
      edges.push({
        producerId: list.operationId,
        consumerId: cons.operationId,
        viaParam,
        kind: 'list_to_scoped_subresource',
      });
    }

    for (const post of collectionPosts) {
      const ps = templateSegmentsRaw(post.pathTemplate);
      const postPath =
        ps.length === 0 ? '/' : `/${ps.join('/')}`;
      if (normalizePathKey(postPath) !== normalizePathKey(listPath)) continue;
      edges.push({
        producerId: post.operationId,
        consumerId: cons.operationId,
        viaParam,
        kind: 'post_to_scoped_subresource',
      });
    }

    const parentTpl = parentItemPathTemplate(cons.pathTemplate, viaParam);
    if (parentTpl) {
      for (const prod of itemGets) {
        if (normalizePathKey(prod.pathTemplate) !== normalizePathKey(parentTpl)) continue;
        if (prod.pathParamNames.length !== 1 || prod.pathParamNames[0] !== viaParam) continue;
        edges.push({
          producerId: prod.operationId,
          consumerId: cons.operationId,
          viaParam,
          kind: 'item_to_scoped_subresource',
        });
      }
    }
  }

  const nodes = new Set(operations.map((o) => o.operationId));
  const deduped = dedupeEdges(edges);
  return { edges: deduped, nodes };
}

/**
 * @param {string} path
 */
function normalizePathKey(path) {
  return path.split('/').filter(Boolean).join('/');
}

/**
 * Flat item path `.../{param}` only.
 *
 * @param {string[]} itemSegs normalized segments with `{param}` tokens
 */
function collectionPrefixFlat(itemSegs) {
  if (itemSegs.length < 2) return null;
  if (itemSegs[itemSegs.length - 1] !== '{param}') return null;
  return itemSegs.slice(0, -1);
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
