#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { FORMATS, render, type Format } from './report/index.js';
import { scanFiles } from './scan.js';

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(2);
};

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      format: { type: 'string', default: 'text' },
      output: { type: 'string' },
      'max-warnings': { type: 'string' },
    },
  });
  if (!FORMATS.includes(values.format as Format)) fail(`--format must be one of: ${FORMATS.join(', ')}`);
  const maxWarnings = values['max-warnings'] === undefined ? Infinity : Number(values['max-warnings']);
  if (Number.isNaN(maxWarnings)) fail('--max-warnings must be a number');

  const result = await scanFiles(positionals.length ? positionals : ['.'], await loadConfig(values.config));
  const report = render(values.format as Format, result);
  if (values.output) await writeFile(values.output, report + '\n');
  else console.log(report);

  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const warns = result.findings.length - errors;
  process.exit(errors > 0 || warns > maxWarnings ? 1 : 0);
} catch (e) {
  fail((e as Error).message);
}
