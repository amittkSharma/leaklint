import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { makeKeyMatcher } from './keys.js';
import { pinoRedacted } from './redact.js';
import { checkSink } from './rules.js';
import { findSinks } from './sinks.js';
import { parseDirectives } from './suppress.js';
import type { Config, Finding, RawFinding, ScanResult } from './types.js';
import { collectFiles } from './walk.js';

const KIND: Record<string, ts.ScriptKind> = {
  '.js': ts.ScriptKind.JS, '.mjs': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS, '.jsx': ts.ScriptKind.JSX,
  '.ts': ts.ScriptKind.TS, '.mts': ts.ScriptKind.TS, '.cts': ts.ScriptKind.TS, '.tsx': ts.ScriptKind.TSX,
};

export function scanSource(file: string, text: string, config: Config): Finding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, KIND[file.slice(file.lastIndexOf('.'))] ?? ts.ScriptKind.TS);
  const ctx = { sf, file, config, isSensitive: makeKeyMatcher(config.keys), redacted: pinoRedacted(sf) };
  const directives = parseDirectives(text);
  const seen = new Set<string>();
  const out: Finding[] = [];
  const push = (f: RawFinding) => {
    const base = config.rules[f.rule];
    // ponytail: pii key names are capped at warn (invariant 5); per-group severity config if users ask.
    const severity = base === 'error' && f.rule === 'no-sensitive-key' && f.group === 'pii' ? 'warn' : base;
    const id = `${f.line}:${f.column}:${f.rule}`;
    if (severity === 'off' || seen.has(id)) return;
    seen.add(id);
    out.push({ ...f, severity });
  };
  for (const call of findSinks(sf, config)) {
    const start = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
    const d = directives.find((x) => x.line === start - 1);
    if (d && !d.reason) push({ file, line: d.line, column: 1, rule: 'suppression-needs-reason', message: 'suppression needs a reason: add `-- why this is safe`' });
    for (const f of checkSink(call, ctx)) {
      if (d && (d.rules.length === 0 || d.rules.includes(f.rule))) continue;
      push(f);
    }
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}

const MAX_BYTES = 1_000_000;

export async function scanFiles(roots: string[], config: Config): Promise<ScanResult> {
  const files = await collectFiles(roots, config.ignore);
  const findings: Finding[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    try {
      const text = await readFile(f, 'utf8');
      if (text.length > MAX_BYTES) warnings.push(`${f}: skipped (larger than 1 MB)`);
      else findings.push(...scanSource(f, text, config));
    } catch (e) {
      warnings.push(`${f}: ${(e as Error).message}`);
    }
  }
  return { findings, warnings, files: files.length };
}
