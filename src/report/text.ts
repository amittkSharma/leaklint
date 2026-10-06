import type { ScanResult } from '../types.js';
import { TITLE, TOOL, VERSION } from './meta.js';
import { summary } from './summary.js';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function text(result: ScanResult): string {
  const s = summary(result);
  const findings = result.findings.flatMap((f) => [
    `${f.file}:${f.line}:${f.column}  ${f.severity.padEnd(5)}  ${f.rule}  ${f.message}`,
    ...(f.group ? [`    group: ${f.group}`] : []),
    `    fix: ${f.fix}`,
  ]);
  const skipped = result.skipped.map((k) => `warning: ${k.file}: skipped (${k.reason})`);
  const unchanged = s.unchanged > 0 ? `, ${s.unchanged} unchanged since the base branch` : '';
  const files = `${plural(s.total, 'file')} in the repo: ${s.read} read, ${s.skipped} skipped, ${s.ignored} ignored, ${s.unsupported} unsupported format, ${s.outside} outside the scanned paths${unchanged}`;
  const baselined = s.baselined > 0 ? `; ${plural(s.baselined, 'known finding')} hidden by the baseline` : '';
  return [
    TITLE,
    `source: ${TOOL} ${VERSION}`,
    `package: ${s.package}`,
    ...findings,
    ...skipped,
    `${plural(s.errors, 'error')}, ${plural(s.warnings, 'warning')}; ${files}${baselined}`,
  ].join('\n');
}
