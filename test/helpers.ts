import { DEFAULT_CONFIG } from '../src/defaults.js';
import { scanSource } from '../src/scan.js';
import type { Config, ScanResult } from '../src/types.js';

/** The rule ids reported for a snippet that is scanned as TypeScript. */
export const rulesFor = (code: string, config: Config = DEFAULT_CONFIG) =>
  scanSource('x.ts', code, config).map((finding) => finding.rule);

export const configWith = (overrides: Partial<Config>): Config => ({ ...DEFAULT_CONFIG, ...overrides });

/** A scan result with nothing in it; override what a test needs. */
export const scanResult = (overrides: Partial<ScanResult> = {}): ScanResult => ({
  package: 'p',
  findings: [],
  skipped: [],
  files: { total: 0, ignored: 0, unsupported: 0, outside: 0, unchanged: 0 },
  baselined: 0,
  ...overrides,
});
