/**
 * OpenAPI 3.x ingestion — JSON or YAML → normalized operations list.
 * Internal `#/components/...` refs are expanded before normalization; external URLs are not fetched.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { resolveInternalRefs } from './resolveInternalRefs.js';

/**
 * @typedef {{
 *   name: string,
 *   in: 'path' | 'query' | 'header' | 'cookie',
 *   required: boolean,
 *   schema?: Record<string, unknown>,
 *   example?: unknown,
 * }} NormalizedParam
 */

/**
 * @typedef {{
 *   operationId: string,
 *   method: string,
 *   pathTemplate: string,
 *   summary?: string,
 *   tags?: string[],
 *   parameters: NormalizedParam[],
 *   pathParamNames: string[],
 *   secured: boolean,
 *   requestBody?: { required: boolean, contentTypes: string[], schema?: Record<string, unknown> },
 * }} NormalizedOperation
 */

/**
 * @typedef {{
 *   openapi: string,
 *   title?: string,
 *   version?: string,
 *   servers: string[],
 *   operations: NormalizedOperation[],
 * }} NormalizedSpec
 */

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
export function loadRawSpec(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`OpenAPI file not found: ${resolved}`);
  }
  const text = fs.readFileSync(resolved, 'utf8');
  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    /** @type {Record<string, unknown>} */
    const doc = yaml.load(text);
    if (!doc || typeof doc !== 'object') throw new Error('Invalid YAML OpenAPI document');
    return doc;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse OpenAPI JSON: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * @param {Record<string, unknown>} doc
 * @returns {NormalizedSpec}
 */
export function normalizeOpenApi(doc) {
  const openapi = String(doc.openapi || doc.swagger || '');
  if (!openapi.startsWith('3') && doc.swagger !== '2.0') {
    // Still allow 2.0 minimal path later; for now warn only if missing
    if (!openapi && !doc.swagger) {
      throw new Error('Not an OpenAPI document (missing openapi / swagger field)');
    }
  }

  /** @type {{ title?: string, version?: string }} */
  const info = /** @type {any} */ (doc.info) || {};
  const servers = extractServers(doc);

  /** @type {NormalizedOperation[]} */
  const operations = [];

  const paths = /** @type {Record<string, Record<string, unknown>>} */ (doc.paths || {});
  for (const [p, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      operations.push(
        normalizeOperation(method, p, /** @type {Record<string, unknown>} */ (op), pathItem, doc)
      );
    }
  }

  return {
    openapi: openapi || '2.0',
    title: info.title,
    version: info.version,
    servers,
    operations,
  };
}

/**
 * @param {string} filePath
 * @returns {NormalizedSpec}
 */
export function loadOpenApi(filePath) {
  const raw = loadRawSpec(filePath);
  const resolved = resolveInternalRefs(raw);
  return normalizeOpenApi(resolved);
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

/**
 * @param {Record<string, unknown>} doc
 */
function extractServers(doc) {
  /** @type {string[]} */
  const out = [];
  const servers = /** @type {unknown[]} */ (doc.servers);
  if (Array.isArray(servers)) {
    for (const s of servers) {
      if (s && typeof s === 'object' && 'url' in s && typeof /** @type {any} */ (s).url === 'string') {
        out.push(/** @type {string} */ (/** @type {any} */ (s).url));
      }
    }
  }
  if (doc.host && typeof doc.host === 'string') {
    const scheme = typeof doc.schemes?.[0] === 'string' ? doc.schemes[0] : 'https';
    const basePath = typeof doc.basePath === 'string' ? doc.basePath : '';
    out.push(`${scheme}://${doc.host}${basePath}`);
  }
  return out;
}

/**
 * @param {string} method
 * @param {string} pathTemplate
 * @param {Record<string, unknown>} op
 * @param {Record<string, unknown>} pathItem
 * @param {Record<string, unknown>} doc
 */
function normalizeOperation(method, pathTemplate, op, pathItem, doc) {
  const mergedParams = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(op.parameters) ? op.parameters : []),
  ];

  /** @type {NormalizedParam[]} */
  const parameters = [];
  for (const raw of mergedParams) {
    if (!raw || typeof raw !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (raw);
    if ('$ref' in r) continue; // unresolved external ref after internal resolution
    const name = typeof r.name === 'string' ? r.name : '';
    const inn = typeof r.in === 'string' ? r.in : 'query';
    if (!name || !['path', 'query', 'header', 'cookie'].includes(inn)) continue;
    parameters.push({
      name,
      in: /** @type {'path'|'query'|'header'|'cookie'} */ (inn),
      required: Boolean(r.required),
      schema: /** @type {Record<string, unknown> | undefined} */ (
        r.schema && typeof r.schema === 'object' ? r.schema : undefined
      ),
      example: r.example !== undefined ? r.example : undefined,
    });
  }

  const pathParamNames = parameters.filter((p) => p.in === 'path').map((p) => p.name);

  /** Operation-level security overrides root; empty array means public. */
  let secured = false;
  if (Object.prototype.hasOwnProperty.call(op, 'security')) {
    secured = Array.isArray(op.security) && op.security.length > 0;
  } else {
    const gs = doc.security;
    secured = Array.isArray(gs) && gs.length > 0;
  }

  let operationId =
    typeof op.operationId === 'string' && op.operationId.trim()
      ? op.operationId.trim()
      : `${method}_${pathTemplate.replace(/[^a-zA-Z0-9]+/g, '_')}`;

  /** @type {NormalizedOperation['requestBody']} */
  let requestBody;
  const rb = op.requestBody;
  if (rb && typeof rb === 'object') {
    const content = /** @type {Record<string, unknown>} */ (
      /** @type {Record<string, unknown>} */ (rb).content || {}
    );
    const contentTypes = Object.keys(content);
    let schema;
    for (const ct of contentTypes) {
      const entry = /** @type {Record<string, unknown>} */ (content[ct]);
      if (entry?.schema && typeof entry.schema === 'object') {
        schema = /** @type {Record<string, unknown>} */ (entry.schema);
        break;
      }
    }
    requestBody = {
      required: Boolean(/** @type {Record<string, unknown>} */ (rb).required),
      contentTypes,
      schema,
    };
  }

  return {
    operationId,
    method: method.toUpperCase(),
    pathTemplate,
    summary: typeof op.summary === 'string' ? op.summary : undefined,
    tags: Array.isArray(op.tags) ? op.tags.map(String) : undefined,
    parameters,
    pathParamNames,
    secured,
    requestBody,
  };
}

/**
 * Resolve CLI/base URL: explicit target wins over first server entry.
 *
 * @param {NormalizedSpec} spec
 * @param {string | null} targetOverride
 */
export function resolveBaseUrl(spec, targetOverride) {
  const t = targetOverride?.trim();
  if (t) return t.replace(/\/+$/, '');
  const first = spec.servers[0];
  if (first) return first.replace(/\/+$/, '');
  throw new Error('No --target and no servers[] in OpenAPI — provide --target <base URL>');
}
