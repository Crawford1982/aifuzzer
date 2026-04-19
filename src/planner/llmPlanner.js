/**
 * Bounded LLM planner — ONLY module that performs chat HTTP to the model provider.
 * Target API traffic stays in execution/HttpFuzzAgent + SequenceExecutor.
 * User prompt is spec metadata only (no response body / trace dumps).
 */

import { validatePlan } from './planSchema.js';
import { getLlmEnv } from './llmEnv.js';

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 */
export function listAllowedPathTemplates(spec) {
  return spec.operations.map((o) => o.pathTemplate);
}

/**
 * @param {import('../openapi/OpenApiLoader.js').NormalizedSpec} spec
 * @param {string} effectiveBaseUrl
 * @param {import('../state/dependencyGraph.js').ProducerConsumerEdge[]} edges
 */
export function buildPlannerPrompt(spec, effectiveBaseUrl, edges) {
  const pathAllow = listAllowedPathTemplates(spec);
  const uniquePaths = [...new Set(pathAllow)];

  const lines = spec.operations.map(
    (o) => `${o.method} ${o.pathTemplate}  (operationId: ${o.operationId})`
  );
  const edgeLines = edges.map(
    (e) => `${e.kind}: ${e.producerId} → ${e.consumerId} via ${e.viaParam}`
  );

  return [
    `Effective API base: ${effectiveBaseUrl}`,
    'All pathTemplate values in the plan MUST be EXACTLY one of the strings in the allowlist below (character-for-character, including leading /).',
    '',
    'pathTemplate allowlist:',
    ...uniquePaths.map((p) => `- ${p}`),
    '',
    'Operations (use only these; do not add parameters or paths not in the allowlist):',
    ...lines.map((l) => `- ${l}`),
    '',
    'Inferred dependency edges (for ordering only):',
    ...(edgeLines.length ? edgeLines.map((l) => `- ${l}`) : ['- (none)']),
    '',
    'Emit ONE JSON object: ExecutionPlan version "1" with sequence[] of steps.',
    'Each step: id, method, pathTemplate (from allowlist only), optional omitAuth/query/jsonBody.',
    '2–6 steps. Do not include any user data, response bodies, or tokens in the JSON.',
  ].join('\n');
}

const SYSTEM = `You are a security test planner. You ONLY output a single JSON object, no markdown.
Rules:
- version must be "1"
- Every sequence[].pathTemplate must be EXACTLY one of the path strings from the user allowlist (no new paths, no extra path segments).
- Use only methods and paths that exist in the operation list.
- No natural language inside JSON string values except short goal/attackClass labels.`;

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

    const allowed = new Set(listAllowedPathTemplates(ctx.spec));
    const badStep = v.plan.sequence.find((s) => !allowed.has(s.pathTemplate));
    if (badStep) {
      validationErrors.push(`pathTemplate not in allowlist: ${badStep.pathTemplate}`);
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
