/**
 * Words that change what a sensitive-looking name refers to. Names are split into lowercase words first
 * (`hasEmail` -> `has`, `email`), so every entry here is a single lowercase word.
 */

/** `hasEmail`, `isPasswordSet`, `skipEmail`: a flag about the data, not the data. */
export const FLAG_PREFIXES = new Set([
  'has',
  'have',
  'had',
  'is',
  'are',
  'was',
  'were',
  'can',
  'could',
  'should',
  'will',
  'would',
  'needs',
  'requires',
  'allow',
  'allows',
  'enable',
  'enables',
  'disable',
  'disables',
  'skip',
  'skips',
  'use',
  'uses',
  'without',
  'missing',
  'no',
]);

/** `numEmails`, `countTokens`: how many, not the data itself. `number of` is handled by the matcher. */
export const COUNT_PREFIXES = new Set(['num', 'count']);

/** `hashedToken`, `envWithoutSecrets`, `fakeEmail`: a derived, masked or made-up value, not the real one. */
export const DERIVED_PREFIXES = new Set([
  'hashed',
  'hash',
  'masked',
  'redacted',
  'encrypted',
  'sanitized',
  'sanitised',
  'without',
  'no',
  'non',
  'fake',
  'dummy',
  'example',
  'sample',
  'mock',
  'placeholder',
  'public',
]);

/** A word before one specific sensitive noun that makes it something else: `inputToken`, `pathInZip`. */
export const QUALIFIERS_BY_NOUN = new Map<string, ReadonlySet<string>>([
  [
    'token',
    new Set([
      'input',
      'output',
      'prompt',
      'completion',
      'total',
      'max',
      'min',
      'deleted',
      'removed',
      'expired',
      'remaining',
      'used',
      'usage',
      'threshold',
      'continuation',
      'page',
      'next',
      'cursor',
      'pagination',
      'sync',
      'resume',
      'channel',
      'queue',
      'injection',
      'provider',
      'module',
      'dependency',
      'di',
    ]),
  ],
  ['zip', new Set(['in', 'to', 'from', 'file', 'path', 'archive', 'for', 'of'])],
]);

/** A plural credential noun after these is a quantity (`cacheReadTokens`, `deletedSecrets`); `readToken` could still be one. */
export const QUANTITY_QUALIFIERS = new Set([
  'conversation',
  'message',
  'chat',
  'cache',
  'cached',
  'creation',
  'reasoning',
  'read',
  'write',
  'size',
  'window',
  'context',
  'limit',
  'budget',
  'adjusted',
  'thinking',
  'count',
  'threshold',
  'original',
  'trimmed',
  'truncated',
  'estimated',
  'consumed',
  'deleted',
  'removed',
  'pruned',
  'expired',
  'imported',
  'migrated',
  'rotated',
  'created',
  'updated',
]);

/** `serviceAccountEmail`, `botEmail`: the address of a machine identity, not a person. */
export const MACHINE_WORDS = new Set(['service', 'system', 'bot', 'robot', 'support', 'noreply']);

/** `test.email`, `spec.fullName`: fixtures and test titles, not people. */
export const TEST_OWNERS = new Set(['test', 'tests', 'spec', 'specs', 'suite']);

/** Message fields that name a person only when read from a mail-like object: `emailRequest.to`, `message.cc`. */
export const MAIL_OWNERS = new Set(['email', 'mail', 'message', 'mailing', 'recipient']);
export const MAIL_FIELDS = new Set(['to', 'cc', 'bcc']);

/** `SKIP_EMAIL`, `SUPPORT_EMAIL`: an ALL_CAPS_WITH_UNDERSCORES name. */
export const CONSTANT_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
