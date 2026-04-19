/**
 * Compile validated plans → FuzzCase[]. No LLM imports.
 */

/** @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase */
/** @typedef {import('./planSchema.js').ExecutionPlan} ExecutionPlan */

import { validatePlan } from './planSchema.js';

/**
 * @param {unknown} plan
 * @param {{ baseUrl: string, allowOrigins?: Set<string> }} ctx
 * @returns {{ ok: boolean, errors: string[], cases: FuzzCase[] }}
 */
export function compilePlanToCases(plan, ctx) {
  const v = validatePlan(plan);
  if (!v.ok || !v.plan) return { ok: false, errors: v.errors, cases: [] };

  /** @type {string[]} */
  const errors = [];
  let origin;
  try {
    origin = new URL(ctx.baseUrl).origin;
  } catch {
    return { ok: false, errors: ['invalid baseUrl'], cases: [] };
  }

  /** @type {FuzzCase[]} */
  const cases = [];

  for (const step of v.plan.sequence) {
    let url;
    try {
      url = new URL(step.pathTemplate, `${ctx.baseUrl.replace(/\/+$/, '')}/`).toString();
    } catch {
      errors.push(`bad URL for step ${step.id}`);
      continue;
    }

    try {
      const stepOrigin = new URL(url).origin;
      if (stepOrigin !== origin) {
        errors.push(`step ${step.id} origin ${stepOrigin} !== allowed ${origin}`);
        continue;
      }
      if (ctx.allowOrigins && !ctx.allowOrigins.has(stepOrigin)) {
        errors.push(`step ${step.id} origin not in allowOrigins`);
        continue;
      }
    } catch {
      errors.push(`step ${step.id} URL parse failed`);
      continue;
    }

    /** @type {FuzzCase} */
    const c = {
      id: `plan:${v.plan.goal}:${step.id}`,
      method: step.method.toUpperCase(),
      url,
      headers: {},
      omitAuth: Boolean(step.omitAuth),
      family: `PLAN_${v.plan.attackClass}`,
      meta: {},
    };

    if (step.query && typeof step.query === 'object') {
      c.meta.query = { ...step.query };
    }
    if (step.jsonBody !== undefined) {
      c.meta.jsonBody = step.jsonBody;
      c.meta.contentType = 'application/json';
    }

    if (!c.meta.query && !c.meta.jsonBody && Object.keys(c.meta).length === 0) {
      delete c.meta;
    }

    cases.push(c);
  }

  if (errors.length) return { ok: false, errors, cases: [] };
  return { ok: true, errors: [], cases };
}
