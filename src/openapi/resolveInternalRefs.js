/**
 * Expand internal JSON Pointer refs (`#/components/...`) inside a parsed OpenAPI document.
 * External / file refs are left unchanged (not fetched).
 */

/**
 * @param {string} ref
 * @param {Record<string, unknown>} root
 * @returns {unknown}
 */
function followInternalRef(ref, root) {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let cur = /** @type {unknown} */ (root);
  for (const rawSeg of parts) {
    const seg = decodeURIComponent(String(rawSeg).replace(/~1/g, '/').replace(/~0/g, '~'));
    if (cur == null || typeof cur !== 'object') return null;
    cur = /** @type {Record<string, unknown>} */ (cur)[seg];
  }
  return cur;
}

/**
 * @param {unknown} node
 * @param {Record<string, unknown>} root
 * @param {Set<string>} resolving
 */
function resolveNode(node, root, resolving) {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = resolveNode(node[i], root, resolving);
    }
    return node;
  }
  if (typeof node !== 'object') return node;

  const o = /** @type {Record<string, unknown>} */ (node);
  if (typeof o.$ref === 'string' && o.$ref.startsWith('#/')) {
    const ref = o.$ref;
    if (resolving.has(ref)) return o;
    const target = followInternalRef(ref, root);
    if (!target || typeof target !== 'object') return o;

    resolving.add(ref);
    const cloned = /** @type {Record<string, unknown>} */ (
      JSON.parse(JSON.stringify(target))
    );
    const merged = {
      ...cloned,
      ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== '$ref')),
    };
    resolving.delete(ref);
    return resolveNode(merged, root, resolving);
  }

  for (const k of Object.keys(o)) {
    o[k] = resolveNode(o[k], root, resolving);
  }
  return node;
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
export function resolveInternalRefs(doc) {
  const root = /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(doc)));
  resolveNode(root, root, new Set());
  return root;
}
