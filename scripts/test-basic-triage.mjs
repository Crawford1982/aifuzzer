#!/usr/bin/env node
import { strict as assert } from 'node:assert';

const { triageResults } = await import('../src/verify/BasicTriage.js');
const {
  isLikelyPublicChallengeCatalogUrl,
  isLikelyBenignCatalogOperationFromCaseId,
  classifyHtmlServerError,
} = await import('../src/verify/triageHints.js');

assert.equal(isLikelyPublicChallengeCatalogUrl('http://127.0.0.1:3000/api/Challenges'), true);
assert.equal(isLikelyPublicChallengeCatalogUrl('https://x.com/api/posts'), false);

assert.equal(isLikelyBenignCatalogOperationFromCaseId('spec:listProducts:baseline'), true);
assert.equal(isLikelyBenignCatalogOperationFromCaseId('spec:listOrders:baseline'), false);

const htmlClass = classifyHtmlServerError(
  { 'content-type': 'text/html; charset=utf-8' },
  '<!doctype html><title>Server Error (500)</title>'
);
assert.equal(htmlClass?.kind, 'html_error_page');

const json500 = triageResults([
  {
    caseId: 'j',
    family: 'X',
    method: 'GET',
    url: 'https://api.example.com/x',
    status: 500,
    headers: { 'content-type': 'application/json' },
    bodyPreview: '{"error":true}',
    error: null,
  },
]);
assert.equal(json500[0].severity, 'high');
assert.ok(String(json500[0].title).includes('Server error'));

const html500 = triageResults([
  {
    caseId: 'h',
    family: 'X',
    method: 'GET',
    url: 'http://127.0.0.1:8888/workshop/api/shop/orders',
    status: 500,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    bodyPreview: '<!doctype html><html><title>Server Error (500)</title></html>',
    error: null,
  },
]);
assert.equal(html500[0].severity, 'medium');
assert.ok(String(html500[0].title).includes('HTML'));

const kw = triageResults([
  {
    caseId: 'c',
    family: 'OPENAPI_BASELINE',
    method: 'GET',
    url: 'http://127.0.0.1:3000/api/Challenges',
    status: 200,
    headers: { 'content-type': 'application/json' },
    bodyPreview: '{"text":"discuss password storage"}',
    error: null,
  },
]);
assert.equal(kw[0].severity, 'low');
assert.ok(String(kw[0].title).includes('catalog'));

const kwOid = triageResults([
  {
    caseId: 'spec:listProducts:baseline',
    family: 'OPENAPI_BASELINE',
    method: 'GET',
    url: 'https://shop.example.com/api/products',
    status: 200,
    headers: { 'content-type': 'application/json' },
    bodyPreview: '{"hint":"password rotation"}',
    error: null,
  },
]);
assert.equal(kwOid[0].severity, 'low');

console.log('basic triage ok');
