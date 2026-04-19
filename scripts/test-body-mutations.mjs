#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { buildSchemaBodyMutationVariants } from '../src/hypothesis/SpecHypothesisEngine.js';

const schema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    userId: { type: 'integer' },
  },
  required: ['title'],
};

const v = buildSchemaBodyMutationVariants(schema, 8);
assert.ok(v.some((x) => x.label.startsWith('omit_')));
assert.ok(v.some((x) => x.label.startsWith('wrong_type_')));
assert.ok(v.some((x) => x.label === 'extra_prop'));

console.log('body mutations ok');
