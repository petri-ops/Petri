import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum, average, maxPair } from '../src/calc.js';

test('sum', () => {
  assert.equal(sum([1, 2, 3]), 6);
});

test('average keeps precision', () => {
  assert.equal(average([1, 2]), 1.5);
});

test('maxPair', () => {
  assert.equal(maxPair(3, 7), 7);
});
