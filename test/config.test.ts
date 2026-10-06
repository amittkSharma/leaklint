import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeConfig } from '../src/config.js';
import { DEFAULT_CONFIG } from '../src/defaults.js';

test('empty config gives defaults', () => assert.deepEqual(mergeConfig(undefined), DEFAULT_CONFIG));

test('user values override, unspecified values keep defaults', () => {
  const c = mergeConfig({ rules: { 'no-pii-value': 'off' }, keys: { add: ['zeissId'] }, sinks: ['audit.record'] });
  assert.equal(c.rules['no-pii-value'], 'off');
  assert.equal(c.rules['no-sensitive-key'], 'error');
  assert.deepEqual(c.keys.add, ['zeissId']);
  assert.deepEqual(c.keys.groups, DEFAULT_CONFIG.keys.groups);
  assert.deepEqual(c.sinks, ['audit.record']);
});

test('invalid config fails with a one-line message', () => {
  assert.throws(() => mergeConfig({ foo: 1 }), /Unknown config key "foo"/);
  assert.throws(() => mergeConfig({ rules: { nope: 'error' } }), /Unknown rule "nope"/);
  assert.throws(() => mergeConfig({ rules: { 'no-pii-value': 'fatal' } }), /severity must be error, warn or off/);
  assert.throws(() => mergeConfig({ keys: { groups: ['x'] } }), /Unknown key group "x"/);
});
