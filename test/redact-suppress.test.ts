import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { scanSource } from '../src/scan.js';

const rules = (code: string) => scanSource('x.ts', code, DEFAULT_CONFIG).map((f) => f.rule);

test('keys covered by pino redact paths are not flagged', () => {
  assert.deepEqual(
    rules("const logger = pino({ redact: ['user.email', 'req.headers.authorization'] });\nlogger.info({ email, authorization, password });"),
    ['no-sensitive-key'],
  );
  assert.deepEqual(
    rules("const logger = pino({ redact: { paths: ['*.password'], censor: '[x]' } });\nlogger.info({ password });"),
    [],
  );
});

test('suppression with a reason silences the next line', () => {
  assert.deepEqual(rules('// leaklint-disable-next-line no-sensitive-key -- audited: hashed upstream\nlogger.info({ password });'), []);
});

test('suppression without a reason applies but is itself reported', () => {
  assert.deepEqual(rules('// leaklint-disable-next-line\nlogger.info({ password });'), ['suppression-needs-reason']);
  assert.deepEqual(rules('// leaklint-disable-next-line no-sensitive-key --\nlogger.info({ password });'), ['suppression-needs-reason']);
});

test('suppression for a different rule does not hide the finding', () => {
  assert.deepEqual(rules('// leaklint-disable-next-line no-pii-value -- ok\nlogger.info({ password });'), ['no-sensitive-key']);
});

test('suppression covers a multi-line call but only when directly above it', () => {
  assert.deepEqual(rules('// leaklint-disable-next-line -- ok, test data\nlogger.info({\n  a: 1,\n  password,\n});'), []);
  assert.deepEqual(rules('// leaklint-disable-next-line -- ok\n\nlogger.info({ password });'), ['no-sensitive-key']);
});
