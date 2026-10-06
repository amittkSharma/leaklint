import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import ts from 'typescript';
import { makeKeyMatcher } from './keys.js';
import { missingReason } from './messages.js';
import { pinoRedacted } from './redact.js';
import { checkSink } from './rules.js';
import { findSinks } from './sinks.js';
import { parseDirectives } from './suppress.js';
import type { Config, Finding, RawFinding, ScanResult, Skipped } from './types.js';
import { inventory } from './walk.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
};

/** Personal-data key names are advice, not proof, so they never fail a build on their own. */
const severityOf = (finding: RawFinding, config: Config): Finding['severity'] | 'off' => {
  const configured = config.rules[finding.rule];
  return configured === 'error' && finding.rule === 'no-sensitive-key' && finding.group === 'pii' ? 'warn' : configured;
};

export function scanSource(file: string, text: string, config: Config): Finding[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    SCRIPT_KINDS[extname(file)] ?? ts.ScriptKind.TS,
  );
  const ctx = { sf, file, config, matchKey: makeKeyMatcher(config.keys), redacted: pinoRedacted(sf) };
  const directives = parseDirectives(text);

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (finding: RawFinding): void => {
    const severity = severityOf(finding, config);
    const id = `${finding.line}:${finding.column}:${finding.rule}`;
    if (severity === 'off' || seen.has(id)) return;
    seen.add(id);
    findings.push({ ...finding, severity });
  };

  for (const call of findSinks(sf, config)) {
    const callLine = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    const directive = directives.find((d) => d.line === callLine - 1);
    if (directive && !directive.reason)
      add({ file, line: directive.line, column: 1, rule: 'suppression-needs-reason', ...missingReason() });
    for (const finding of checkSink(call, ctx)) {
      const suppressed = directive && (directive.rules.length === 0 || directive.rules.includes(finding.rule));
      if (!suppressed) add(finding);
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** The nearest package.json at or above the first scanned path, else the working directory's name. */
async function packageName(roots: string[]): Promise<string> {
  for (let dir = resolve(roots[0] ?? '.'); ; dir = dirname(dir)) {
    try {
      const { name } = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (typeof name === 'string' && name) return name;
    } catch {
      // no readable package.json in this folder; try its parent
    }
    if (dirname(dir) === dir) return basename(process.cwd());
  }
}

export async function scanFiles(roots: string[], config: Config, changed?: Set<string>): Promise<ScanResult> {
  const { candidates, ...files } = await inventory(roots, config.ignore, changed);
  const findings: Finding[] = [];
  const skipped: Skipped[] = [];

  for (const file of candidates) {
    try {
      const { size } = await stat(file);
      if (size > MAX_FILE_BYTES) {
        skipped.push({ file, reason: `${(size / 1024 / 1024).toFixed(1)} MB, over the 10 MB limit` });
        continue;
      }
      findings.push(...scanSource(file, await readFile(file, 'utf8'), config));
    } catch (error) {
      skipped.push({ file, reason: (error as Error).message });
    }
  }
  return { package: await packageName(roots), findings, skipped, files, baselined: 0 };
}
