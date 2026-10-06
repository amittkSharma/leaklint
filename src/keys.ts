import { DEFAULT_KEYS } from './defaults.js';
import { toRegExp } from './regex-entry.js';
import type { KeyGroup, KeysConfig } from './types.js';
import {
  CONSTANT_NAME,
  COUNT_PREFIXES,
  DERIVED_PREFIXES,
  FLAG_PREFIXES,
  MACHINE_WORDS,
  MAIL_FIELDS,
  MAIL_OWNERS,
  QUALIFIERS_BY_NOUN,
  QUANTITY_QUALIFIERS,
  TEST_OWNERS,
} from './vocabulary.js';

/** `userEmail` -> `['user', 'email']`; handles camelCase, snake_case, kebab-case and ALL_CAPS. */
export const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

/** The same name in every naming style: `API_KEY`, `apiKey` and `x-api-key` all become `apikey`. */
export const normalize = (name: string): string => words(name).join('');

const MAX_NOUN_WORDS = 3;

export type KeyMatcher = (name: string, options?: { bare?: boolean; owner?: string }) => KeyGroup | undefined;

type Entries = { names: Set<string>; patterns: RegExp[] };

function compileEntries(entries: string[]): Entries {
  const compiled: Entries = { names: new Set(), patterns: [] };
  for (const entry of entries) {
    const pattern = toRegExp(entry);
    if (pattern) compiled.patterns.push(pattern);
    else compiled.names.add(normalize(entry));
  }
  return compiled;
}

/**
 * Decides whether a name in a log call is sensitive, and which group it belongs to.
 *
 * A name matches by its last one to three words, so `userEmail` and `billing_address` match `email` and
 * `billingaddress`. Words before the noun can cancel the match (`hasEmail`, `inputTokens`, `hashedToken`).
 * With `bare` the name is a variable or shorthand property, so an ALL_CAPS personal-data name such as
 * `SUPPORT_EMAIL` is a constant, not a person's value. `owner` is the object it was read from (`ctx.channel.token`).
 */
export function makeKeyMatcher(config: KeysConfig): KeyMatcher {
  const table = new Map<string, KeyGroup>();
  for (const group of config.groups) for (const key of DEFAULT_KEYS[group]) table.set(key, group);
  const added = compileEntries(config.add);
  for (const name of added.names) table.set(name, 'custom');
  const allowed = compileEntries(config.allow);

  const matchesPattern = (patterns: RegExp[], name: string, normalized: string) =>
    patterns.some((pattern) => pattern.test(name) || pattern.test(normalized));

  return (name, { bare = false, owner } = {}) => {
    const normalized = normalize(name);
    if (allowed.names.has(normalized) || matchesPattern(allowed.patterns, name, normalized)) return undefined;
    if (matchesPattern(added.patterns, name, normalized)) return 'custom';

    const own = words(name);
    if (
      config.groups.includes('pii') &&
      own.length === 1 &&
      MAIL_FIELDS.has(own[0]) &&
      owner &&
      words(owner).some((word) => MAIL_OWNERS.has(word))
    ) {
      return 'pii';
    }
    if (own.length > 1 && isFlagOrCount(own)) return undefined;
    const ownerWords = owner ? words(owner) : [];
    const before = [...ownerWords, ...own];

    for (let size = Math.min(MAX_NOUN_WORDS, own.length); size >= 1; size--) {
      const joined = own.slice(-size).join('');
      const noun = table.has(joined) ? joined : joined.replace(/s$/, '');
      const group = table.get(noun);
      if (!group) continue;

      const prefix = before.slice(0, before.length - size);
      const isPlural = joined !== noun;
      if (isCancelled({ noun, group, isPlural, prefix, ownerWords })) return undefined;
      return group === 'pii' && bare && CONSTANT_NAME.test(name) ? undefined : group;
    }
    return undefined;
  };
}

function isFlagOrCount(nameWords: string[]): boolean {
  const [first, second] = nameWords;
  return FLAG_PREFIXES.has(first) || COUNT_PREFIXES.has(first) || (first === 'number' && second === 'of');
}

type Candidate = { noun: string; group: KeyGroup; isPlural: boolean; prefix: string[]; ownerWords: string[] };

/** True when the words around a matched noun show it is not the sensitive thing (a count, a hash, a test title...). */
function isCancelled({ noun, group, isPlural, prefix, ownerWords }: Candidate): boolean {
  const previous = prefix.at(-1);
  if (previous === undefined) return false;
  if (DERIVED_PREFIXES.has(previous)) return true;
  if (QUALIFIERS_BY_NOUN.get(noun)?.has(previous)) return true;
  if (group === 'credentials' && isPlural && QUANTITY_QUALIFIERS.has(previous)) return true;
  if (group === 'pii') {
    if (ownerWords.some((word) => TEST_OWNERS.has(word))) return true;
    if (prefix.slice(-2).some((word) => MACHINE_WORDS.has(word))) return true;
  }
  return false;
}
