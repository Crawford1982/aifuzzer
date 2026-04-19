/**
 * Smoke test: plan schema + compiler + stub (no network).
 */
import { validatePlan } from '../src/planner/planSchema.js';
import { compilePlanToCases } from '../src/planner/planCompiler.js';
import { buildStubPlan } from '../src/planner/stubPlanner.js';
import { strict as assert } from 'node:assert';

const plan = buildStubPlan();
const v = validatePlan(plan);
assert(v.ok, v.errors?.join('; '));
const c = compilePlanToCases(plan, { baseUrl: 'https://jsonplaceholder.typicode.com' });
assert(c.ok, c.errors.join('; '));
assert.equal(c.cases.length, 2);
assert(c.cases[0].url.includes('/posts/1'));
console.log('plan schema + stub compile: ok');
