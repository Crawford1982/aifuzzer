#!/usr/bin/env node
/**
 * Milestone H — mass assignment, function-level authz, shadow endpoint checkers (offline).
 */
import { strict as assert } from 'node:assert';
import {
  checkMassAssignmentReflection,
  checkFunctionLevelAuthWeakness,
  checkShadowEndpointExposure,
} from '../src/verify/invariantCheckers.js';
import { runCheckerPipeline } from '../src/verify/checkerEngine.js';
import { MYTHOS_CHECKERS } from '../src/verify/checkerRegistry.js';

// ---- mass_assignment
const massOk = [
  {
    caseId: 'spec:op1:bodyfuzz:extra_prop',
    method: 'POST',
    url: 'https://t.test/api/items',
    status: 201,
    bodyPreview: '{"id":9}',
    family: 'OPENAPI_BODY_FUZZ',
  },
  {
    caseId: 'spec:op2:baseline',
    method: 'GET',
    url: 'https://t.test/api/items/9',
    status: 200,
    bodyPreview: '{"id":9,"title":"x","__mythosUnexpected":true}',
    family: 'OPENAPI_BASELINE',
  },
];
const massHits = checkMassAssignmentReflection(massOk);
assert.ok(massHits.some((x) => x.checkerId === 'mass_assignment'));

const massNeg = [
  {
    caseId: 'spec:op1:bodyfuzz:extra_prop',
    method: 'POST',
    url: 'https://t.test/api/items',
    status: 201,
    bodyPreview: '{"id":9}',
    family: 'OPENAPI_BODY_FUZZ',
  },
  {
    caseId: 'spec:op2:baseline',
    method: 'GET',
    url: 'https://t.test/api/items/9',
    status: 200,
    bodyPreview: '{"id":9,"title":"ok"}',
    family: 'OPENAPI_BASELINE',
  },
];
assert.equal(checkMassAssignmentReflection(massNeg).length, 0);

// ---- function_level_authz (omit_auth)
const authzOmit = [
  {
    caseId: 'spec:adminThing:omit_auth',
    method: 'GET',
    url: 'https://t.test/api/admin/users',
    status: 200,
    bodyPreview: '{"users":["' + 'x'.repeat(40) + '"]}',
    family: 'AUTH_BYPASS',
  },
];
const authzHits = checkFunctionLevelAuthWeakness(authzOmit);
assert.ok(
  authzHits.some(
    (x) => x.checkerId === 'function_level_authz' && String(x.title).includes('without Authorization')
  )
);

const authzAlt = [
  {
    caseId: 'spec:listX:baseline:authAlt',
    method: 'GET',
    url: 'https://t.test/internal/v1/settings',
    status: 200,
    bodyPreview: '{"role":"admin","secret":"' + 'y'.repeat(50) + '"}',
    family: 'NAMESPACE_AUTH_REPLAY',
  },
];
assert.ok(checkFunctionLevelAuthWeakness(authzAlt).some((x) => x.checkerId === 'function_level_authz'));

// ---- shadow_endpoint
const shadowInv = [
  {
    caseId: 's1',
    method: 'GET',
    url: 'https://t.test/actuator/health',
    status: 200,
    bodyPreview: '{"status":"UP","details":{"disk":"ok"}}',
    family: 'CHAIN',
  },
];
assert.ok(checkShadowEndpointExposure(shadowInv).some((x) => x.checkerId === 'shadow_endpoint'));

const shadowVer = [
  {
    caseId: 's2',
    method: 'GET',
    url: 'https://t.test/api/beta/users',
    status: 200,
    bodyPreview: '[' + '{"id":1}'.repeat(5) + ']',
    family: 'CHAIN',
  },
];
assert.ok(checkShadowEndpointExposure(shadowVer).some((x) => x.checkerId === 'shadow_endpoint'));

const shadowNeg = [
  {
    caseId: 's3',
    method: 'GET',
    url: 'https://t.test/api/posts',
    status: 200,
    bodyPreview: '[]',
    family: 'CHAIN',
  },
];
assert.equal(checkShadowEndpointExposure(shadowNeg).length, 0);

// ---- pipeline + registry
const pipelineRows = [...massOk, ...authzOmit.slice(0, 1), ...shadowInv.slice(0, 1)];
const fired = runCheckerPipeline(pipelineRows, { evidenceHarPath: '/tmp/x.har' });
assert.ok(fired.filter((x) => x.kind === 'checker').length >= 3);
assert.ok(MYTHOS_CHECKERS.some((c) => c.checkerId === 'mass_assignment'));
assert.ok(MYTHOS_CHECKERS.some((c) => c.checkerId === 'function_level_authz'));
assert.ok(MYTHOS_CHECKERS.some((c) => c.checkerId === 'shadow_endpoint'));
assert.ok(MYTHOS_CHECKERS.length >= 9);

console.log('milestone H checkers ok');
