/**
 * Spec-derived fuzz cases — OpenAPI → deterministic FuzzCase list (budget-aware).
 */

/** @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase */

/**
 * @param {unknown} schema
 * @returns {unknown}
 */
export function pickExampleValue(schema) {
  if (!schema || typeof schema !== 'object') return 'test';
  const s = /** @type {Record<string, unknown>} */ (schema);
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const t = s.type;
  const fmt = s.format;
  if (t === 'integer' || t === 'number') return 1;
  if (fmt === 'uuid') return '00000000-0000-0000-0000-000000000001';
  if (t === 'boolean') return true;
  if (t === 'array') return [];
  if (t === 'object') return minimalJsonObject(s);
  if (t === 'string') return 'test';
  return 'test';
}

/**
 * Exported for POST/PUT bodies in chain executor (minimal required fields only).
 *
 * @param {Record<string, unknown> | undefined} schema
 */
export function buildMinimalJsonBody(schema) {
  if (!schema || typeof schema !== 'object') return {};
  return minimalJsonObject(/** @type {Record<string, unknown>} */ (schema));
}

/**
 * @param {Record<string, unknown>} schema
 */
function minimalJsonObject(schema) {
  const props = /** @type {Record<string, unknown>} */ (schema.properties || {});
  const req = Array.isArray(schema.required) ? schema.required : [];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of req) {
    if (typeof key !== 'string') continue;
    const ps = props[key];
    out[key] = pickExampleValue(ps);
  }
  return Object.keys(out).length ? out : {};
}

const ID_LIKE = /(^|_)(id|Id|ID|uuid|UUID|pk|Pk|key|Key)($|_)/;

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedOperation} op
 * @param {string} paramName
 */
function isIdLikeParam(paramName) {
  return ID_LIKE.test(paramName) || /^[a-zA-Z]*[iI]d$/.test(paramName);
}

const ID_ALT = [1, 2, 99, 1000, '00000000-0000-0000-0000-000000000002'];

/**
 * Build URL with resolved path/query and optional body meta.
 *
 * @param {{
 *   baseUrl: string,
 *   operation: import('../openapi/OpenApiLoader.js').NormalizedOperation,
 *   pathValues: Record<string, string>,
 *   queryExtras?: Record<string, string>,
 * }} p
 */
function buildRequest(p) {
  let path = p.operation.pathTemplate;
  for (const [k, v] of Object.entries(p.pathValues)) {
    path = path.replace(new RegExp(`\\{${escapeRe(k)}\\}`, 'gi'), encodeURIComponent(String(v)));
  }

  const u = new URL(path, `${p.baseUrl}/`);
  for (const param of p.operation.parameters) {
    if (param.in !== 'query') continue;
    const key = param.name;
    if (p.queryExtras && Object.prototype.hasOwnProperty.call(p.queryExtras, key)) {
      u.searchParams.set(key, String(p.queryExtras[key]));
      continue;
    }
    if (!param.required && !param.schema) continue;
    u.searchParams.set(key, String(pickExampleValue(param.schema)));
  }

  if (p.queryExtras) {
    for (const [k, v] of Object.entries(p.queryExtras)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
  }

  /** @type {FuzzCase['meta']} */
  const meta = {};
  const headerExtras = {};
  for (const param of p.operation.parameters) {
    if (param.in === 'header') {
      headerExtras[param.name] = String(pickExampleValue(param.schema));
    }
  }

  if (['POST', 'PUT', 'PATCH'].includes(p.operation.method) && p.operation.requestBody?.schema) {
    meta.jsonBody = buildMinimalJsonBody(p.operation.requestBody.schema);
    meta.contentType = 'application/json';
  }

  return {
    url: u.toString(),
    headers: headerExtras,
    meta: Object.keys(meta).length ? meta : undefined,
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Initial path parameter values from schema/examples.
 *
 * @param {import('../openapi/OpenApiLoader.js').NormalizedOperation} op
 */
function defaultPathValues(op) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const param of op.parameters) {
    if (param.in !== 'path') continue;
    const v = pickExampleValue(param.schema);
    out[param.name] = String(v);
  }
  return out;
}

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 * @param {string} baseUrl
 * @param {{ maxRequests: number, hasAuth: boolean }} opts
 * @returns {FuzzCase[]}
 */
export function expandFromOpenApi(spec, baseUrl, opts) {
  /** @type {FuzzCase[]} */
  const cases = [];
  const cap = () => cases.length >= opts.maxRequests;

  for (const op of spec.operations) {
    if (cap()) break;

    const pathVals = defaultPathValues(op);
    const baseReq = buildRequest({ baseUrl, operation: op, pathValues: pathVals });

    cases.push({
      id: `spec:${op.operationId}:baseline`,
      method: op.method,
      url: baseReq.url,
      headers: baseReq.headers || {},
      family: 'OPENAPI_BASELINE',
      meta: baseReq.meta,
    });

    // ID-like path mutations (BOLA / IDOR hints)
    for (const pname of op.pathParamNames) {
      if (!isIdLikeParam(pname) || cap()) continue;
      for (const alt of ID_ALT) {
        if (cap()) break;
        const pv = { ...pathVals, [pname]: String(alt) };
        const r = buildRequest({ baseUrl, operation: op, pathValues: pv });
        cases.push({
          id: `spec:${op.operationId}:idor:${pname}:${alt}`,
          method: op.method,
          url: r.url,
          headers: r.headers || {},
          family: 'OPENAPI_IDOR',
          meta: { ...(r.meta || {}), pathParam: pname, alt },
        });
      }
    }

    // Debug-style query toggles when GET has few query params
    if (op.method === 'GET' && !cap()) {
      const r = buildRequest({
        baseUrl,
        operation: op,
        pathValues: pathVals,
        queryExtras: { debug: 'true' },
      });
      cases.push({
        id: `spec:${op.operationId}:debug_q`,
        method: op.method,
        url: r.url,
        headers: r.headers || {},
        family: 'INFO_DISCLOSURE',
        meta: r.meta,
      });
    }

    if (op.secured && opts.hasAuth && !cap()) {
      const r = buildRequest({ baseUrl, operation: op, pathValues: pathVals });
      cases.push({
        id: `spec:${op.operationId}:omit_auth`,
        method: op.method,
        url: r.url,
        headers: r.headers || {},
        omitAuth: true,
        family: 'AUTH_BYPASS',
        meta: r.meta,
      });
    }
  }

  return cases.slice(0, opts.maxRequests);
}
