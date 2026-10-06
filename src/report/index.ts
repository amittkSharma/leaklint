import type { ScanResult } from '../types.js';
import { html } from './html.js';
import { json } from './json.js';
import { junit } from './junit.js';
import { sarif } from './sarif.js';
import { text } from './text.js';

export const FORMATS = ['text', 'json', 'sarif', 'junit', 'html'] as const;
export type Format = (typeof FORMATS)[number];

const RENDERERS: Record<Format, (result: ScanResult) => string> = { text, json, sarif, junit, html };

export const render = (format: Format, result: ScanResult): string => RENDERERS[format](result);
