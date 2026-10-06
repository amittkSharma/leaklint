import type { Finding, ScanResult, Skipped } from '../types.js';
import { escapeMarkup as esc } from './escape.js';
import { TITLE, TOOL, VERSION } from './meta.js';
import { summary } from './summary.js';

/** An error is a failed test case, a warning a skipped one; the rest of the finding goes in `system-out`. */
function findingCase(f: Finding): string {
  const details = [
    `severity: ${f.severity}`,
    `line: ${f.line}`,
    `column: ${f.column}`,
    ...(f.group ? [`group: ${f.group}`] : []),
    `fix: ${f.fix}`,
  ].join('\n');
  const outcome =
    f.severity === 'error'
      ? `<failure message="${esc(f.message)}" type="${f.rule}"/>`
      : `<skipped message="${esc(f.message)}"/>`;
  const name = esc(`${f.rule}:${f.line}:${f.column}`);
  return `  <testcase classname="${esc(f.file)}" name="${name}">${outcome}<system-out>${esc(details)}</system-out></testcase>`;
}

const skippedFileCase = ({ file, reason }: Skipped): string =>
  `  <testcase classname="${esc(file)}" name="not scanned"><skipped message="${esc(reason)}"/></testcase>`;

export function junit(result: ScanResult): string {
  const s = summary(result);
  const findings = result.findings.length
    ? result.findings.map(findingCase)
    : [`  <testcase classname="${esc(s.package)}" name="no findings"/>`];
  const cases = [...findings, ...result.skipped.map(skippedFileCase)];
  const properties = Object.entries({ source: `${TOOL} ${VERSION}`, ...s })
    .map(([name, value]) => `    <property name="${name}" value="${esc(String(value))}"/>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${esc(TITLE)}" tests="${cases.length}" failures="${s.errors}">`,
    `  <properties>\n${properties}\n  </properties>`,
    ...cases,
    '</testsuite>',
    '',
  ].join('\n');
}
