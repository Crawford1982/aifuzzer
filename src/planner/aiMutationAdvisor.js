/**
 * Optional LLM: suggest extra query/header probes from the spec only (no response bodies).
 * Hints are validated against real OpenAPI parameters before any target HTTP.
 */

import { getLlmEnv } from './llmEnv.js';
import { makeFuzzCaseWithParamProbe } from '../hypothesis/SpecHypothesisEngine.js';

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 */
function buildAdvisorUserPrompt(spec) {
  const lines = spec.operations.map(
    (o) =>
      `${o.operationId}  ${o.method}  ${o.pathTemplate}  queryParams=[${o.parameters
        .filter((p) => p.in === 'query')
        .map((p) => p.name)
        .join(',')}]  headerParams=[${o.parameters
        .filter((p) => p.in === 'header')
        .map((p) => p.name)
        .join(',')}]`
  );
  return [
    'Suggest HIGH-SIGNAL fuzz probes as JSON only.',
    'Rules:',
    '- Output JSON object { "version":"1", "hints":[...] }.',
    '- Each hint: { "operationId": string, "in": "query"|"header", "name": string, "value": string }.',
    '- Every operationId and (in,name) pair MUST exist in the list below — do not invent parameters.',
    '- 2–8 hints. Short string values only. No response data, no tokens, no URL of a real system.',
    '',
    'Operations:',
    ...lines.map((l) => `- ${l}`),
  ].join('\n');
}

const SYSTEM = `You are a security test designer. You output a single JSON object, no markdown.
You only suggest query or header parameters that are already defined for the operation.`;

/**
 * @param {string} text
 */
function extractJsonObject(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const inner = fence ? fence[1].trim() : trimmed;
  const start = inner.indexOf('{');
  const end = inner.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  return inner.slice(start, end + 1);
}

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 * @param {unknown} doc
 */
function validateHints(spec, doc) {
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['not an object'] };
  const o = /** @type {Record<string, unknown>} */ (doc);
  if (o.version !== '1') return { ok: false, errors: ['version must be 1'] };
  if (!Array.isArray(o.hints)) return { ok: false, errors: ['missing hints[]'] };
  const byId = new Map(spec.operations.map((x) => [x.operationId, x]));
  /** @type {string[]} */
  const errors = [];
  /** @type {Array<{ operationId: string, in: 'query' | 'header', name: string, value: string }>} */
  const hints = [];
  for (const h of o.hints) {
    if (!h || typeof h !== 'object') {
      errors.push('invalid hint');
      continue;
    }
    const row = /** @type {Record<string, unknown>} */ (h);
    const opId = String(row.operationId || '');
    const inn = String(row.in || '');
    const name = String(row.name || '');
    const value = String(row.value != null ? row.value : '');
    if (value.length > 200) {
      errors.push('value too long');
      continue;
    }
    const op = byId.get(opId);
    if (!op) {
      errors.push(`unknown operationId ${opId}`);
      continue;
    }
    if (inn !== 'query' && inn !== 'header') {
      errors.push('in must be query|header');
      continue;
    }
    const has = op.parameters.some(
      (p) => p.in === inn && p.name === name
    );
    if (!has) {
      errors.push(`param not in spec: ${opId} ${inn} ${name}`);
      continue;
    }
    hints.push({ operationId: opId, in: inn, name, value });
  }
  if (hints.length === 0) return { ok: false, errors: errors.length ? errors : ['no valid hints'] };
  return { ok: true, hints, errors };
}

/**
 * @param {{
 *   spec: import('../openapi/OpenApiLoader.js').NormalizedSpec,
 *   effectiveBaseUrl: string,
 *   maxRetries?: number,
 *   fetchImpl?: typeof fetch,
 * }} ctx
 */
export async function requestMutationHintsFromLlm(ctx) {
  const env = getLlmEnv();
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  if (!env.apiKey) {
    return { ok: false, reason: 'no_api_key', detail: 'Set MYTHOS_LLM_API_KEY' };
  }

  const user = buildAdvisorUserPrompt(ctx.spec);
  const maxRetries = Math.max(1, Math.min(3, ctx.maxRetries ?? 2));
  /** @type {string[]} */
  const validationErrors = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const userContent =
      attempt === 0
        ? user
        : `${user}\n\nFix these issues and reply with JSON only:\n${validationErrors.join('\n')}`;

    let data;
    try {
      const res = await fetchImpl(env.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.apiKey}`,
        },
        body: JSON.stringify({
          model: env.model,
          temperature: 0.15,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userContent },
          ],
        }),
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: 'provider_http',
          detail: `${res.status} ${await res.text().catch(() => '')}`,
        };
      }
      data = await res.json();
    } catch (e) {
      return {
        ok: false,
        reason: 'provider_fetch_error',
        detail: /** @type {Error} */ (e).message,
      };
    }

    const content =
      /** @type {{ choices?: Array<{ message?: { content?: string } }> }} */ (data).choices?.[0]?.message
        ?.content;
    if (!content || typeof content !== 'string') {
      validationErrors.push('missing message content');
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(extractJsonObject(content));
    } catch (e) {
      validationErrors.push(`json: ${/** @type {Error} */ (e).message}`);
      continue;
    }

    const v = validateHints(ctx.spec, parsed);
    if (!v.ok || !v.hints) {
      validationErrors.push(...(v.errors || []));
      continue;
    }

    return { ok: true, hints: v.hints, attempts: attempt + 1 };
  }

  return {
    ok: false,
    reason: 'validation_failed',
    detail: validationErrors.slice(-8).join('; ') || 'unknown',
    attempts: maxRetries,
  };
}

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 * @param {string} baseUrl
 * @param {Array<{ operationId: string, in: 'query' | 'header', name: string, value: string }>} hints
 * @param {{ maxCases?: number }} opts
 */
export function hintsToFuzzCases(spec, baseUrl, hints, opts = {}) {
  const max = Math.max(1, Math.min(24, opts.maxCases ?? 12));
  const byId = new Map(spec.operations.map((o) => [o.operationId, o]));
  /** @type {import('../hypothesis/HypothesisEngine.js').FuzzCase[]} */
  const cases = [];

  for (let i = 0; i < hints.length && cases.length < max; i++) {
    const h = hints[i];
    const op = byId.get(h.operationId);
    if (!op) continue;
    const q = {};
    const hdr = {};
    if (h.in === 'query') q[h.name] = h.value;
    else hdr[h.name] = h.value;

    cases.push(
      makeFuzzCaseWithParamProbe(
        op,
        baseUrl,
        `spec:ai_hint:${op.operationId}:${i}`,
        'OPENAPI_AI_HINT',
        q,
        hdr
      )
    );
  }

  return cases;
}
