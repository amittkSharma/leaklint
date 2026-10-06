import type { ScanResult } from '../types.js';
import { count } from './text.js';

export const json = (r: ScanResult): string =>
  JSON.stringify({ summary: { ...count(r), files: r.files }, findings: r.findings, warnings: r.warnings }, null, 2);
