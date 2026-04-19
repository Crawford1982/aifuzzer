/**
 * Bounded LLM planner — ONLY module that performs chat HTTP to the model provider.
 * Target API traffic stays in execution/HttpFuzzAgent + SequenceExecutor.
 */

import { validatePlan } from './planSchema.js';
import { getLlmEnv } from './llmEnv.js';

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 * @param {string} effectiveBaseUrl
 * @param {import('../state/dependencyGraph.js').ProducerConsumerEdge[]} edges
 */
export function buildPlannerPrompt(spec, effectiveBaseUrl, edges) {
  const lines = spec.operations.map(
    (o) => `${o.method} ${o.pathTemplate}  (${o.operationId})`
  );
  const edgeLines = edges.map(
    (e) => `${e.kind}: ${e.producerId} → ${e.consumerId} via ${e.viaParam}`
  );

  return [
    `Effective API base (all pathTemplate URLs must resolve under this origin): ${effectiveBaseUrl}`,
    '',
    'Operations:',
    ...lines.map((l) => `- ${l}`),
    '',
    'Inferred dependency edges:',
    ...(edgeLines.length ? edgeLines.map((l) => `- ${l}`) : ['- (none)']),
    '',
    'Emit ONE JSON object: ExecutionPlan version "1" with sequence[] of steps.',
    'Each step: id, method, pathTemplate starting with /, optional omitAuth/query/jsonBody.',
    'Prefer 2–6 steps that exercise a realistic chain using operations above.',
    'Do not invent paths that are not listed.',
  ].join('\n');
}

const SYSTEM = `You are a security-aware API test planner. Output ONLY valid JSON — no markdown, no prose — matching this shape:
{"version":"1","goal":"string","attackClass":"string","risk":"low"|"medium"|"high"|omit,"sequence":[{"id":"string","method":"GET|POST|PUT|PATCH|DELETE","pathTemplate":"/path","omitAuth":false,"query":{},"jsonBody":null}]}`;

/**
 * @param {string} text
 */
export function extractJsonObject(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const inner = fence ? fence[1].trim() : trimmed;
  const start = inner.indexOf('{');
  const end = inner.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  return inner.slice(start, end + 1);
}

/**
 * @param {{
 *   spec: import('../openapi/OpenApiLoader.js').NormalizedSpec,
 *   effectiveBaseUrl: string,
 *   edges: import('../state/dependencyGraph.js').ProducerConsumerEdge[],
 *   maxRetries?: number,
 *   fetchImpl?: typeof fetch,
 * }} ctx
 */
export async function requestExecutionPlanFromLlm(ctx) {
  const env = getLlmEnv();
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;

  if (!env.apiKey) {
    return { ok: false, reason: 'no_api_key', detail: 'Set MYTHOS_LLM_API_KEY (or OPENROUTER_API_KEY)' };
  }

  const user = buildPlannerPrompt(ctx.spec, ctx.effectiveBaseUrl, ctx.edges);
  const maxRetries = Math.max(1, Math.min(5, ctx.maxRetries ?? 3));

  /** @type {string[]} */
  const validationErrors = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const userContent =
      attempt === 0
        ? user
        : `${user}\n\nPrevious attempt failed validation:\n${validationErrors.join('\n')}\nReply with ONLY the corrected JSON object.`;

    /** @type {unknown} */
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
          temperature: 0.1,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userContent },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          reason: 'provider_http',
          detail: `${res.status} ${errText.slice(0, 500)}`,
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
      /** @type {{ choices?: Array<{ message?: { content?: string } }> }} */ (data).choices?.[0]
        ?.message?.content;
    if (!content || typeof content !== 'string') {
      validationErrors.push('missing choices[0].message.content');
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(extractJsonObject(content));
    } catch (e) {
      validationErrors.push(`json_parse: ${/** @type {Error} */ (e).message}`);
      continue;
    }

    const v = validatePlan(parsed);
    if (!v.ok || !v.plan) {
      validationErrors.push(...v.errors);
      continue;
    }

    return { ok: true, plan: v.plan, attempts: attempt + 1 };
  }

  return {
    ok: false,
    reason: 'validation_failed',
    detail: validationErrors.slice(-10).join('; ') || 'unknown',
    attempts: maxRetries,
  };
}
