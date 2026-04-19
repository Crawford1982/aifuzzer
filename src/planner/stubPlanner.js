/**
 * Deterministic stub planner — validates compiler + executor wiring without an LLM.
 */

/** @typedef {import('./planSchema.js').ExecutionPlan} ExecutionPlan */

/**
 * Two-step public-API chain (jsonplaceholder-friendly). Override base path in future.
 *
 * @returns {ExecutionPlan}
 */
export function buildStubPlan() {
  return {
    version: '1',
    goal: 'smoke_chain',
    attackClass: 'BASELINE_CHAIN',
    risk: 'low',
    maxSteps: 4,
    preconditions: ['target_allows_placeholder_or_swap_paths'],
    sequence: [
      { id: 'read_post', method: 'GET', pathTemplate: '/posts/1' },
      { id: 'read_comments', method: 'GET', pathTemplate: '/posts/1/comments' },
    ],
  };
}
