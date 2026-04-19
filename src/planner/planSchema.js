/**
 * Typed execution plan contract — planner (LLM or stub) emits only this shape.
 * Executor / planCompiler rejects everything else before HTTP.
 */

/** @typedef {'1'} PlanVersion */

/**
 * @typedef {{
 *   version: PlanVersion,
 *   goal: string,
 *   attackClass: string,
 *   risk?: 'low' | 'medium' | 'high',
 *   maxSteps?: number,
 *   preconditions?: string[],
 *   sequence: PlanStep[],
 * }} ExecutionPlan
 */

/**
 * @typedef {{
 *   id: string,
 *   method: string,
 *   pathTemplate: string,
 *   omitAuth?: boolean,
 *   query?: Record<string, string>,
 *   jsonBody?: unknown,
 *   expect?: { notStatus?: number[], statusIn?: number[] },
 * }} PlanStep
 */

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * @param {unknown} raw
 * @returns {{ ok: boolean, errors: string[], plan?: ExecutionPlan }}
 */
export function validatePlan(raw) {
  /** @type {string[]} */
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    errors.push('plan must be an object');
    return { ok: false, errors };
  }

  const p = /** @type {Record<string, unknown>} */ (raw);

  if (p.version !== '1') errors.push(`version must be "1", got ${String(p.version)}`);
  if (typeof p.goal !== 'string' || !p.goal.trim()) errors.push('goal must be a non-empty string');
  if (typeof p.attackClass !== 'string' || !p.attackClass.trim())
    errors.push('attackClass must be a non-empty string');

  if (!Array.isArray(p.sequence) || p.sequence.length === 0) {
    errors.push('sequence must be a non-empty array');
  } else {
    const maxSteps =
      typeof p.maxSteps === 'number' && p.maxSteps > 0 ? p.maxSteps : p.sequence.length;
    if (p.sequence.length > maxSteps) errors.push('sequence longer than maxSteps');

    for (let i = 0; i < p.sequence.length; i++) {
      const step = p.sequence[i];
      const prefix = `sequence[${i}]`;
      if (!step || typeof step !== 'object') {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      const s = /** @type {Record<string, unknown>} */ (step);
      if (typeof s.id !== 'string' || !s.id.trim()) errors.push(`${prefix}.id required`);
      const method = typeof s.method === 'string' ? s.method.toUpperCase() : '';
      if (!ALLOWED_METHODS.has(method)) errors.push(`${prefix}.method invalid: ${s.method}`);
      if (typeof s.pathTemplate !== 'string' || !s.pathTemplate.startsWith('/')) {
        errors.push(`${prefix}.pathTemplate must start with /`);
      }
      if (s.query !== undefined) {
        if (!s.query || typeof s.query !== 'object' || Array.isArray(s.query)) {
          errors.push(`${prefix}.query must be a string record`);
        }
      }
      if (s.expect !== undefined && (!s.expect || typeof s.expect !== 'object')) {
        errors.push(`${prefix}.expect must be an object`);
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    plan: /** @type {ExecutionPlan} */ (raw),
  };
}
