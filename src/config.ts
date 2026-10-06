import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, DEFAULT_KEYS } from './defaults.js';
import type { Config } from './types.js';

const TOP = ['keys', 'sinks', 'safeCalls', 'ignore', 'rules'];

export function mergeConfig(user: unknown): Config {
  const u = (user ?? {}) as Record<string, any>;
  const bad = Object.keys(u).find((k) => !TOP.includes(k));
  if (bad) throw new Error(`Unknown config key "${bad}"`);
  const rules = { ...DEFAULT_CONFIG.rules, ...u.rules };
  for (const [id, sev] of Object.entries(rules)) {
    if (!(id in DEFAULT_CONFIG.rules)) throw new Error(`Unknown rule "${id}"`);
    if (!['error', 'warn', 'off'].includes(sev as string)) throw new Error(`Rule "${id}": severity must be error, warn or off`);
  }
  const keys = { ...DEFAULT_CONFIG.keys, ...u.keys };
  for (const g of keys.groups) if (!(g in DEFAULT_KEYS)) throw new Error(`Unknown key group "${g}"`);
  return { ...DEFAULT_CONFIG, ...u, keys, rules } as Config;
}

export async function loadConfig(path?: string): Promise<Config> {
  const file = path ?? 'leaklint.config.json';
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    if (path) throw new Error(`Cannot read config "${path}"`);
    return DEFAULT_CONFIG;
  }
  try {
    return mergeConfig(JSON.parse(raw));
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? `Config "${file}" is not valid JSON` : (e as Error).message);
  }
}
