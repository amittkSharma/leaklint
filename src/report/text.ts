import type { ScanResult } from '../types.js';

export const count = (r: ScanResult) => ({
  errors: r.findings.filter((f) => f.severity === 'error').length,
  warnings: r.findings.filter((f) => f.severity === 'warn').length,
});

export function text(r: ScanResult): string {
  const { errors, warnings } = count(r);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [
    ...r.findings.map((f) => `${f.file}:${f.line}:${f.column}  ${f.severity.padEnd(5)}  ${f.rule}  ${f.message}`),
    ...r.warnings.map((w) => `warning: ${w}`),
    `${plural(errors, 'error')}, ${plural(warnings, 'warning')} in ${plural(r.files, 'file')}`,
  ].join('\n');
}
