import type { ScanResult } from '../types.js';
import { json } from './json.js';
import { junit } from './junit.js';
import { sarif } from './sarif.js';
import { text } from './text.js';

export const FORMATS = ['text', 'json', 'sarif', 'junit'] as const;
export type Format = (typeof FORMATS)[number];

const RENDERERS: Record<Format, (r: ScanResult) => string> = { text, json, sarif, junit };
export const render = (format: Format, r: ScanResult): string => RENDERERS[format](r);
