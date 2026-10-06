import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { scanSource } from '../src/scan.js';

const rules = (code: string, cfg = DEFAULT_CONFIG) => scanSource('x.ts', code, cfg).map((f) => f.rule);

test('flags sensitive keys that reach the log', () => {
  for (const code of [
    'logger.info({ password });',
    'console.log(user.email);',
    'console.log(`token=${token}`);',
    "logger.info({ 'x-api-key': k });",
    "logger.info(headers['authorization']);",
    'logger.info(users.map((u) => u.email));',
    'process.stderr.write(`bad ${password}`);',
    'logger.info({ a: { password: pw } });',
  ]) assert.deepEqual(rules(code), ['no-sensitive-key'], code);
});

test('flags whole objects that hold secrets', () => {
  for (const code of [
    'logger.info(req);',
    'logger.info({ headers: req.headers });',
    'logger.info(JSON.stringify(req.body));',
    'logger.info({ ...process.env });',
    'logger.info({ req });',
  ]) assert.deepEqual(rules(code), ['no-whole-object'], code);
});

test('values that do not leak are not flagged', () => {
  for (const code of [
    'logger.info({ tokenCount, cacheKey });',
    'logger.info(req.method, req.headers.host);',
    "logger.info({ password: '[REDACTED]' });",
    'logger.info(hash(password));',
    'logger.info(maskEmail(user.email));',
    "logger.info('password reset requested');",
    'logger.info(users.filter((u) => u.email === x).length);',
    'logger.info(user.email.length);',
    'logger.info({ err });',
    "logger.info('@types/node');",
  ]) assert.deepEqual(rules(code), [], code);
});

test('credential-shaped and email literals', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij';
  assert.deepEqual(rules(`logger.info('token ${jwt}');`), ['no-secret-literal']);
  assert.deepEqual(rules("logger.info('Bearer abcdefghijklmnopqrstuvwxyz0123');"), ['no-secret-literal']);
  assert.deepEqual(rules("logger.info('contact a@b.com');"), ['no-pii-value']);
});

test('SSN and NINO values are flagged, lookalikes are not', () => {
  for (const s of ['ssn is 123-45-6789', 'nino AB123456C', 'nino AB 12 34 56 C']) {
    assert.deepEqual(rules(`logger.info('${s}');`), ['no-pii-value'], s);
  }
  for (const s of ['id 000-12-3456', 'id 666-12-3456', 'id 900-12-3456', 'id 123-00-6789', 'id 123-45-0000', 'ref QQ123456C', 'ref BG123456C', 'ref AB123456E', 'order 1234-56-7890']) {
    assert.deepEqual(rules(`logger.info('${s}');`), [], s);
  }
});

test('severity comes from config, and off drops the finding', () => {
  assert.equal(scanSource('x.ts', "logger.info('a@b.com');", DEFAULT_CONFIG)[0].severity, 'warn');
  assert.deepEqual(rules('logger.info({ password });', { ...DEFAULT_CONFIG, rules: { ...DEFAULT_CONFIG.rules, 'no-sensitive-key': 'off' } }), []);
});

test('pii key names ship as warn, credentials stay error', () => {
  assert.equal(scanSource('x.ts', 'logger.info({ dateOfBirth });', DEFAULT_CONFIG)[0].severity, 'warn');
  assert.equal(scanSource('x.ts', 'logger.info({ password });', DEFAULT_CONFIG)[0].severity, 'error');
});

test('reports 1-based line and column, and never echoes the value', () => {
  const [f] = scanSource('x.ts', "const a = 1;\nlogger.info('a@b.com');", DEFAULT_CONFIG);
  assert.equal(f.line, 2);
  assert.equal(f.column, 13);
  assert.doesNotMatch(f.message, /a@b\.com/);
  const [s] = scanSource('x.ts', "logger.info('ssn 123-45-6789');", DEFAULT_CONFIG);
  assert.doesNotMatch(s.message, /123-45-6789/);
});
