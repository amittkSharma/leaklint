import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { scanSource } from '../src/scan.js';
import { configWith, rulesFor } from './helpers.js';

describe('no-sensitive-key', () => {
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
      'logger.info({ refresh_token });',
      'logger.info({ API_KEY });',
      'logger.info(process.env.DB_PASSWORD);',
      'logger.info({ canonicalEmail: user.email });',
      'logger.info({ tokenValue: token });',
      'logger.info({ accessTokens, secrets });',
      'for (const token of tokens) { console.log(token); }',
      'console.log(API_KEY);',
    ]) {
      assert.deepEqual(rulesFor(code).slice(0, 1), ['no-sensitive-key'], code);
    }
  });

  test('does not flag values that cannot leak', () => {
    for (const code of [
      'logger.info({ tokenCount, cacheKey });',
      'logger.info(req.method, req.headers.host);',
      "logger.info({ password: '[REDACTED]' });",
      'logger.info(hash(password));',
      'logger.info(maskEmail(user.email));',
      'logger.info({ email: mask(user.email), password: hash(pw) });',
      'logger.info(users.filter((u) => u.email === x).length);',
      'logger.info(user.email.length);',
      'logger.info({ err });',
    ]) {
      assert.deepEqual(rulesFor(code), [], code);
    }
  });

  test('personal-data keys are warnings, credentials are errors', () => {
    assert.equal(scanSource('x.ts', 'logger.info({ dateOfBirth });', DEFAULT_CONFIG)[0].severity, 'warn');
    assert.equal(scanSource('x.ts', 'logger.info({ password });', DEFAULT_CONFIG)[0].severity, 'error');
  });
});

describe('no-whole-object', () => {
  test('flags whole objects that hold secrets', () => {
    for (const code of [
      'logger.info(req);',
      'logger.info({ headers: req.headers });',
      'logger.info(JSON.stringify(req.body));',
      'logger.info({ ...process.env });',
      'console.log({ req });',
      'function h(request, response) { logger.info({ request }); }',
      'function h(response: Response) { console.error({ response }); }',
    ]) {
      assert.deepEqual(rulesFor(code), ['no-whole-object'], code);
    }
  });

  test('treats res, response, request and ctx as HTTP objects only with evidence', () => {
    for (const code of [
      'app.get("/", (req, res) => { console.log(res); });',
      'function h(res: ServerResponse) { logger.info(res); }',
      'const { response, body } = await request.get(url);\nconsole.log(response);',
      'axios.get(u).then((response) => { logger.info(response); });',
      'app.use((request, response) => { logger.info(response); });',
      'app.use(async (ctx, next) => { logger.info(ctx); });',
    ]) {
      assert.deepEqual(rulesFor(code), ['no-whole-object'], code);
    }
    for (const code of [
      'p.then((res) => { console.log(res); });',
      "log.debug('Unknown response for databaseList:', response);",
      'items.then((response) => { console.log(response); });',
      "logger.info(`Resolving '${request}' in the loader`);",
      'async function run(ctx) { logger.warn("failed", ctx); }',
    ]) {
      assert.deepEqual(rulesFor(code), [], code);
    }
  });

  test('{ req, res } is a serializer slot for pino-style loggers, but not for console', () => {
    assert.deepEqual(rulesFor('logger.info({ req: request, res: reply, err });'), []);
    assert.deepEqual(rulesFor('logger.info({ req, res });'), []);
    assert.deepEqual(rulesFor('h((request, response) => console.log({ req: request }));'), ['no-whole-object']);
  });
});

describe('no-secret-literal and no-pii-value', () => {
  test('flags credential-shaped strings and personal values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij';
    assert.deepEqual(rulesFor(`logger.info('token ${jwt}');`), ['no-secret-literal']);
    assert.deepEqual(rulesFor("logger.info('Bearer abcdefghijklmnopqrstuvwxyz0123');"), ['no-secret-literal']);
    assert.deepEqual(rulesFor("console.error('postgresql://app:Zx81qLm@prod.db/app');"), ['no-secret-literal']);
    assert.deepEqual(rulesFor("logger.info('contact a@b.com');"), ['no-pii-value']);
  });

  test('flags SSN and NINO values but not lookalikes', () => {
    for (const text of ['ssn is 123-45-6789', 'nino AB123456C', 'nino AB 12 34 56 C']) {
      assert.deepEqual(rulesFor(`logger.info('${text}');`), ['no-pii-value'], text);
    }
    for (const text of [
      'id 000-12-3456',
      'id 666-12-3456',
      'id 900-12-3456',
      'id 123-00-6789',
      'id 123-45-0000',
      'ref QQ123456C',
      'ref BG123456C',
      'ref AB123456E',
      'order 1234-56-7890',
    ]) {
      assert.deepEqual(rulesFor(`logger.info('${text}');`), [], text);
    }
  });

  test('ignores ordinary words, scoped packages, placeholders and role mailboxes', () => {
    for (const code of [
      "logger.info('password reset requested');",
      "logger.info('@types/node');",
      "console.error('contact help@acme.io or support@acme.io');",
      'console.error(\'use "postgresql://user:pass@localhost:5432/db" or mysql://root:${PASSWORD}@db\');',
    ]) {
      assert.deepEqual(rulesFor(code), [], code);
    }
    for (const email of ['owner@example.com', 'a@b.example.org', 'x@localhost', 'noreply@acme.io', 'u@host.test']) {
      assert.deepEqual(rulesFor(`logger.info('mail ${email} failed');`), [], email);
    }
    assert.deepEqual(rulesFor("logger.info('noreply@acme.io then jane@acme.io');"), ['no-pii-value']);
  });
});

describe('findings', () => {
  test('carry a 1-based position and never echo the value', () => {
    const [email] = scanSource('x.ts', "const a = 1;\nlogger.info('a@b.com');", DEFAULT_CONFIG);
    assert.equal(email.line, 2);
    assert.equal(email.column, 13);
    assert.doesNotMatch(email.message, /a@b\.com/);
    const [ssn] = scanSource('x.ts', "logger.info('ssn 123-45-6789');", DEFAULT_CONFIG);
    assert.doesNotMatch(ssn.message, /123-45-6789/);
  });

  test('take their severity from config, and off drops them', () => {
    assert.equal(scanSource('x.ts', "logger.info('a@b.com');", DEFAULT_CONFIG)[0].severity, 'warn');
    const off = configWith({ rules: { ...DEFAULT_CONFIG.rules, 'no-sensitive-key': 'off' } });
    assert.deepEqual(rulesFor('logger.info({ password });', off), []);
  });
});

describe('config entries written as /regex/flags', () => {
  const config = configWith({
    keys: { ...DEFAULT_CONFIG.keys, add: ['/^cust_\\d+_ref$/i'], allow: ['/^debug/i'] },
    sinks: ['/^audit\\.(record|log)$/'],
    safeCalls: ['/^(?:mask|scrub)/i'],
  });

  test('work for keys.add, keys.allow, sinks and safeCalls', () => {
    assert.deepEqual(rulesFor('logger.info({ CUST_12_REF: a, cust_9_ref: b });', config), [
      'no-sensitive-key',
      'no-sensitive-key',
    ]);
    assert.deepEqual(rulesFor('logger.info({ DebugPassword: p });', config), []);
    assert.deepEqual(rulesFor('audit.log({ password });', config), ['no-sensitive-key']);
    assert.deepEqual(rulesFor('logger.info(MaskEmail(user.email));', config), []);
  });

  test('sessionId is opt-in through keys.add', () => {
    assert.deepEqual(rulesFor('logger.info({ sessionId, chatSessionId });'), []);
    const optIn = configWith({ keys: { ...DEFAULT_CONFIG.keys, add: ['sessionId'] } });
    assert.deepEqual(rulesFor('logger.info({ sessionId });', optIn), ['no-sensitive-key']);
  });
});

describe('mail fields', () => {
  test('flags a recipient, and to/cc/bcc read from a mail-like object', () => {
    for (const code of [
      'logger.info({ recipient: req.to });',
      'logger.info({ recipients });',
      'logger.info({ recipient: emailRequest.to });',
    ]) {
      assert.deepEqual(rulesFor(code), ['no-sensitive-key'], code);
    }
    assert.deepEqual(rulesFor('logger.info(message.cc, mailOptions.bcc);'), ['no-sensitive-key', 'no-sensitive-key']);
  });

  test('does not flag a bare or unrelated `to`', () => {
    for (const code of ['logger.info({ to });', 'logger.info(range.to, route.to);', 'logger.info({ from, to: 5 });']) {
      assert.deepEqual(rulesFor(code), [], code);
    }
  });

  test('payload is opt-in: it is usually generic application data', () => {
    assert.deepEqual(rulesFor('logger.error("send failed", { payload });'), []);
    const optIn = configWith({ keys: { ...DEFAULT_CONFIG.keys, add: ['payload'] } });
    assert.deepEqual(rulesFor('logger.error("send failed", { payload });', optIn), ['no-sensitive-key']);
  });
});
