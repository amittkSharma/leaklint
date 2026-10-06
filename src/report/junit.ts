import type { ScanResult } from '../types.js';

const ESC: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ESC[c]);

export function junit(r: ScanResult): string {
  const cases = r.findings.length
    ? r.findings.map((f) => {
        const name = esc(`${f.rule}:${f.line}:${f.column}`);
        const body = f.severity === 'error' ? `<failure message="${esc(f.message)}" type="${f.rule}"/>` : `<skipped message="${esc(f.message)}"/>`;
        return `  <testcase classname="${esc(f.file)}" name="${name}">${body}</testcase>`;
      })
    : ['  <testcase classname="leaklint" name="no findings"/>'];
  const failures = r.findings.filter((f) => f.severity === 'error').length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="leaklint" tests="${cases.length}" failures="${failures}">\n${cases.join('\n')}\n</testsuite>\n`;
}
