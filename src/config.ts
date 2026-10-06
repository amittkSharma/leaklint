import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, DEFAULT_KEYS } from './defaults.js';
import { toRegExp } from './regex-entry.js';
import type { Config } from './types.js';

const CONFIG_KEYS = ['keys', 'sinks', 'safeCalls', 'ignore', 'rules', 'baseline'];
const SEVERITIES = ['error', 'warn', 'off'];
const DEFAULT_FILE = 'leaklint.config.json';

function assertValidRegexEntries(field: string, entries: string[]): void {
  for (const entry of entries) {
    try {
      toRegExp(entry);
    } catch {
      throw new Error(`${field}: "${entry}" is not a valid regular expression`);
    }
  }
}

/** Validates user config and layers it over the defaults. Throws a one-line message for the first problem. */
export function mergeConfig(user: unknown): Config {
  const input = (user ?? {}) as Partial<Config>;

  const unknownKey = Object.keys(input).find((key) => !CONFIG_KEYS.includes(key));
  if (unknownKey) throw new Error(`Unknown config key "${unknownKey}"`);

  const rules = { ...DEFAULT_CONFIG.rules, ...input.rules };
  for (const [id, severity] of Object.entries(rules)) {
    if (!(id in DEFAULT_CONFIG.rules)) throw new Error(`Unknown rule "${id}"`);
    if (!SEVERITIES.includes(severity)) throw new Error(`Rule "${id}": severity must be error, warn or off`);
  }

  const keys = { ...DEFAULT_CONFIG.keys, ...input.keys };
  for (const group of keys.groups) {
    if (!(group in DEFAULT_KEYS)) throw new Error(`Unknown key group "${group}"`);
  }

  if (input.baseline !== undefined && typeof input.baseline !== 'string')
    throw new Error('baseline must be a file path');

  assertValidRegexEntries('keys.add', keys.add);
  assertValidRegexEntries('keys.allow', keys.allow);
  assertValidRegexEntries('sinks', input.sinks ?? []);
  assertValidRegexEntries('safeCalls', input.safeCalls ?? []);

  return { ...DEFAULT_CONFIG, ...input, keys, rules };
}

/** Reads `path`, or `leaklint.config.json` when none is given (a missing default file means defaults). */
export async function loadConfig(path?: string): Promise<Config> {
  const file = path ?? DEFAULT_FILE;
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    if (path) throw new Error(`Cannot read config "${path}"`);
    return DEFAULT_CONFIG;
  }
  try {
    return mergeConfig(JSON.parse(raw));
  } catch (error) {
    throw new Error(error instanceof SyntaxError ? `Config "${file}" is not valid JSON` : (error as Error).message);
  }
}
