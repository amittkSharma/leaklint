import { DEFAULT_KEYS } from './defaults.js';
import type { Group, KeysConfig } from './types.js';

export const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

export const normalize = (name: string): string => words(name).join('');

export function makeKeyMatcher(cfg: KeysConfig): (name: string) => Group | 'custom' | undefined {
  const table = new Map<string, Group | 'custom'>();
  for (const g of cfg.groups) for (const k of DEFAULT_KEYS[g]) table.set(k, g);
  for (const k of cfg.add) table.set(normalize(k), 'custom');
  const allow = new Set(cfg.allow.map(normalize));
  return (name) => {
    if (allow.has(normalize(name))) return undefined;
    const w = words(name);
    for (let n = Math.min(3, w.length); n >= 1; n--) {
      const joined = w.slice(-n).join(''); // longest suffix first
      const hit = table.get(joined) ?? table.get(joined.replace(/s$/, ''));
      if (hit) return hit;
    }
    return undefined;
  };
}
