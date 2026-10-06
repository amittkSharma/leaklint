import type { RuleId } from './types.js';

type LiteralRule = Extract<RuleId, 'no-secret-literal' | 'no-pii-value'>;

type LiteralPattern = {
  rule: LiteralRule;
  /** Reads as "a JWT", "an email address" in the message. */
  article: 'a' | 'an';
  kind: string;
  pattern: RegExp;
  /** Rejects matches that look right but are not real, such as placeholders. */
  accept?: (match: RegExpMatchArray) => boolean;
};

export type LiteralMatch = Pick<LiteralPattern, 'rule' | 'article' | 'kind'>;

const ROLE_MAILBOX =
  /^(?:no-?reply|do-?not-?reply|postmaster|help|support|contact|info|hello|security|admin|team|sales|abuse|legal|press|feedback)@/i;
const RESERVED_DOMAIN = /@(?:[\w-]+\.)*(?:example(?:\.(?:com|org|net|edu))?|test|invalid|localhost)$/i;
const PLACEHOLDER_PASSWORD = /^(?:pass(?:word|wd)?|pwd|secret|changeme|x{3,}|\*+|<.*>|\[.*\]|\{.*\}|\$.*|your.*)$/i;

/** Order matters: the first pattern that matches names the finding. */
const PATTERNS: LiteralPattern[] = [
  {
    rule: 'no-secret-literal',
    article: 'a',
    kind: 'JWT',
    pattern: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/,
  },
  { rule: 'no-secret-literal', article: 'an', kind: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'no-secret-literal', article: 'a', kind: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: 'no-secret-literal', article: 'a', kind: 'bearer token', pattern: /\bBearer\s+[\w.~+/-]{20,}/i },
  { rule: 'no-secret-literal', article: 'a', kind: 'GitHub token', pattern: /\bgh[pousr]_\w{36,}/ },
  {
    rule: 'no-secret-literal',
    article: 'a',
    kind: 'URL with a password',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/i,
    accept: (match) => !PLACEHOLDER_PASSWORD.test(match[1]),
  },
  {
    rule: 'no-pii-value',
    article: 'an',
    kind: 'email address',
    pattern: /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/,
    accept: ([email]) => !ROLE_MAILBOX.test(email) && !RESERVED_DOMAIN.test(email),
  },
  {
    rule: 'no-pii-value',
    article: 'a',
    kind: 'US Social Security Number',
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/,
  },
  {
    // First letter not D F I Q U V, second also not O, and not one of the reserved prefixes.
    rule: 'no-pii-value',
    article: 'a',
    kind: 'UK National Insurance Number',
    pattern: /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/,
  },
];

/** The first secret or personal-data pattern found in a string that is written to a log. */
export function findLiteral(text: string): LiteralMatch | undefined {
  return PATTERNS.find(({ pattern, accept }) => {
    const matches = text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`));
    return [...matches].some((match) => !accept || accept(match));
  });
}
