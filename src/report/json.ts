import type { ScanResult } from '../types.js';
import { TITLE, TOOL, VERSION } from './meta.js';
import { summary } from './summary.js';

export const json = (result: ScanResult): string =>
  JSON.stringify(
    {
      title: TITLE,
      source: { tool: TOOL, version: VERSION },
      summary: summary(result),
      findings: result.findings,
      skipped: result.skipped,
    },
    null,
    2,
  );
