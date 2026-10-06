import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rulesFor } from './helpers.js';

/** Each case is code that looks like a leak but is not, so it must stay unflagged. */
const cases: Record<string, string[]> = {
  'flags about the data': [
    'logger.info({ hasEmail: Boolean(email), hasCountry: Boolean(country) });',
    'logger.info({ hasToken: !!accessToken });',
    'logger.info({ ok: email === other, isEmpty: !email });',
    'logger.info({ SKIP_EMAIL });',
  ],
  'counts and lengths': [
    'logger.info({ numCredentials: credentials?.length, numEmails: emails.length });',
    'logger.info({ emailCount, numberOfEmails });',
    'logger.info({ credentials: types.credentials?.length ?? 0 });',
    'logger.info({ deleted_count: deletedTokens });',
    'logger.info({ deletedSecrets, trimmedTokens, originalTokens });',
    'logger.info({ observerThresholdTokens });',
  ],
  'LLM token usage and streamed text': [
    'console.log(`Token usage: input=${u.input_tokens}, output=${u.output_tokens}`);',
    'logger.info(`reasoning=${u.reasoningTokens}, cacheRead=${u.cacheReadTokens}, window=${contextWindowTokens}`);',
    'logger.debug("page", { continuationToken, nextPageToken, estimatedConversationTokens });',
    'llm.call({ handleLLMNewToken(token) { console.log(token); } });',
    'run({ onToken: (token) => process.stdout.write(token) });',
    'for await (const token of stream) { console.log(token); }',
  ],
  'names that mean something else': [
    'logger.info({ ctx: `channel ${ctx.channel.token}` });',
    'logger.error(`No queue found for token ${queueToken}`);',
    'logger.info({ stripeCheckoutSessionId: id, paymentSessionId: id });',
    'logger.warn(`missing in zip: ${item.pathInZip}`);',
    'console.log(`failed: ${failedTest.fullName} ${spec.fullName}`);',
    'logger.error(`failed [serviceAccountEmail=${serviceAccountEmail}]`);',
  ],
  'derived, masked or made-up values': [
    'logger.debug("start", { envWithoutSecrets, hashedToken, maskedEmail, fakePassword });',
    'logger.debug("req", { cookies: Object.keys(req.cookies || {}) });',
    'logger.info({ password: parsed.password ? "******" : undefined });',
  ],
  constants: ["const FORBIDDEN_TOKEN = 'pull_request_target';\nconsole.error(`Forbidden ${FORBIDDEN_TOKEN}`);"],
};

for (const [theme, snippets] of Object.entries(cases)) {
  describe(theme, () => {
    for (const code of snippets) {
      test(code, () => assert.deepEqual(rulesFor(code), []));
    }
  });
}

test('the same names are still flagged when they are real', () => {
  assert.deepEqual(rulesFor('logger.debug({ cookies: req.cookies });'), ['no-sensitive-key']);
  assert.deepEqual(rulesFor('logger.debug({ password, refreshToken });'), ['no-sensitive-key', 'no-sensitive-key']);
  assert.deepEqual(rulesFor('logger.info({ accessTokens, readToken, cacheKey });'), [
    'no-sensitive-key',
    'no-sensitive-key',
  ]);
  assert.deepEqual(rulesFor('logger.info(`mail ${accountEmail}`);'), ['no-sensitive-key']);
});
