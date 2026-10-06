#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { applyBaseline, DEFAULT_BASELINE_FILE, readBaseline, writeBaseline } from './baseline.js';
import { changedSince } from './changed.js';
import { loadConfig } from './config.js';
import { FORMATS, type Format, render } from './report/index.js';
import { count } from './report/summary.js';
import { scanFiles } from './scan.js';

const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;

const fail = (message: string): never => {
  console.error(message);
  process.exit(EXIT_USAGE);
};

function parseOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      format: { type: 'string', default: 'text' },
      output: { type: 'string' },
      'max-warnings': { type: 'string' },
      baseline: { type: 'string' },
      'write-baseline': { type: 'boolean' },
      'changed-only': { type: 'boolean' },
      base: { type: 'string' },
    },
  });
  const format = values.format as Format;
  if (!FORMATS.includes(format)) fail(`--format must be one of: ${FORMATS.join(', ')}`);
  const maxWarnings = values['max-warnings'] === undefined ? Number.POSITIVE_INFINITY : Number(values['max-warnings']);
  if (Number.isNaN(maxWarnings)) fail('--max-warnings must be a number');
  const changedOnly = values['changed-only'] ?? false;
  const writeBaseline = values['write-baseline'] ?? false;
  if (values.base && !changedOnly) fail('--base needs --changed-only');
  if (writeBaseline && changedOnly) fail('--write-baseline needs a full scan: drop --changed-only');
  return {
    format,
    maxWarnings,
    config: values.config,
    output: values.output,
    baseline: values.baseline,
    writeBaseline,
    changedOnly,
    base: values.base,
    paths: positionals.length ? positionals : ['.'],
  };
}

async function main(): Promise<number> {
  const options = parseOptions();
  const config = await loadConfig(options.config);
  const baselinePath = options.baseline ?? config.baseline;
  const knownFindings = baselinePath && !options.writeBaseline ? await readBaseline(baselinePath) : undefined;
  const changes = options.changedOnly ? await changedSince(options.base) : undefined;

  let result = await scanFiles(options.paths, config, changes?.files);

  if (options.writeBaseline) {
    const path = baselinePath ?? DEFAULT_BASELINE_FILE;
    await writeBaseline(path, result.findings);
    console.log(
      `Baseline written to ${path} with ${result.findings.length} known finding(s). ` +
        `Run with --baseline ${path} (or set "baseline" in the config) to report only new ones.`,
    );
    return 0;
  }
  if (knownFindings) result = { ...result, ...(await applyBaseline(result.findings, knownFindings)) };

  const report = render(options.format, result);
  if (options.output) await writeFile(options.output, `${report}\n`);
  else console.log(report);

  const { errors, warnings } = count(result.findings);
  return errors > 0 || warnings > options.maxWarnings ? EXIT_FINDINGS : 0;
}

main().then(
  (code) => process.exit(code),
  (error: Error) => fail(error.message),
);
