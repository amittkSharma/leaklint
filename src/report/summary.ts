import type { Finding, ScanResult } from '../types.js';

export const count = (findings: Finding[]) => ({
  errors: findings.filter((f) => f.severity === 'error').length,
  warnings: findings.filter((f) => f.severity === 'warn').length,
});

/** The numbers every report format carries. */
export const summary = (r: ScanResult) => ({
  package: r.package,
  ...count(r.findings),
  total: r.files.total,
  read: r.files.total - r.files.ignored - r.files.unsupported - r.files.outside - r.files.unchanged - r.skipped.length,
  skipped: r.skipped.length,
  ignored: r.files.ignored,
  unsupported: r.files.unsupported,
  outside: r.files.outside,
  unchanged: r.files.unchanged,
  baselined: r.baselined,
});
