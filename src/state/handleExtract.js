/**
 * Extract typed handles from JSON bodies for consumer steps (deterministic).
 */

/**
 * Safely parse JSON text.
 * @param {string} text
 */
export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * First numeric or string id from an object (REST list/detail common shape).
 *
 * @param {Record<string, unknown>} obj
 */
export function firstIdLikeFromObject(obj) {
  /** @type {Array<[string, unknown]>} */
  const priority = [];
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    if (/^(id)$/i.test(k)) priority.unshift([k, obj[k]]);
    else if (
      /id$/i.test(k) ||
      /^[a-z]+Id$/i.test(k) ||
      /^(slug|handle|uuid|ref|reference|code|key|name|token|urn)$/i.test(k)
    ) {
      priority.push([k, obj[k]]);
    }
  }
  for (const [, v] of priority) {
    const coerced = coerceId(v);
    if (coerced !== null) return coerced;
  }
  for (const [, v] of Object.entries(obj)) {
    const coerced = coerceId(v);
    if (coerced !== null) return coerced;
  }
  return null;
}

/**
 * @param {unknown} v
 */
function coerceId(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.length > 0 && v.length < 200) return v;
  return null;
}

/**
 * Extract id from array response (collection) — uses first element.
 *
 * @param {unknown} parsed
 */
export function extractIdFromCollectionFirst(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const row = parsed[0];
  if (!row || typeof row !== 'object') return null;
  return firstIdLikeFromObject(/** @type {Record<string, unknown>} */ (row));
}

/**
 * Extract id from single-object JSON (POST create response).
 *
 * @param {unknown} parsed
 */
export function extractIdFromResource(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return firstIdLikeFromObject(/** @type {Record<string, unknown>} */ (parsed));
}
