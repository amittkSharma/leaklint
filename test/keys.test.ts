import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { makeKeyMatcher } from '../src/keys.js';

const m = makeKeyMatcher(DEFAULT_CONFIG.keys);

test('flags sensitive head nouns in any naming style', () => {
  for (const k of ['password', 'accessToken', 'apiKey', 'x-api-key', 'X-Api-Key', 'userEmail', 'emails', 'first_name', 'authorization', 'sessionId', 'secretKey', 'cookies']) {
    assert.ok(m(k), k);
  }
});

test('flags personal identifiers by key name', () => {
  for (const k of ['dob', 'dateOfBirth', 'passportNumber', 'nhsNumber', 'healthInsuranceId', 'clientIp', 'ip_address', 'X-Forwarded-For', 'homeAddress', 'billing_address', 'postcode', 'mobile', 'nino', 'socialSecurityNumber']) {
    assert.equal(m(k), 'pii', k);
  }
});

test('does not flag lookalikes', () => {
  for (const k of ['tokenCount', 'cacheKey', 'emailVerified', 'isPasswordValid', 'username', 'passwordHash', 'tokenizer', 'author', 'keyboard', 'addressCount', 'ipv4Regex', 'address', 'zipped', 'telemetry']) {
    assert.equal(m(k), undefined, k);
  }
});

test('reports the group', () => {
  assert.equal(m('password'), 'credentials');
  assert.equal(m('email'), 'pii');
  assert.equal(m('iban'), 'financial');
});

test('groups, add and allow are honoured', () => {
  const custom = makeKeyMatcher({ groups: ['credentials'], add: ['zeissId'], allow: ['token'] });
  assert.equal(custom('zeissId'), 'custom');
  assert.equal(custom('token'), undefined);
  assert.equal(custom('email'), undefined);
});
