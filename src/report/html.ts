import type { Finding, ScanResult } from '../types.js';
import { escapeMarkup as esc } from './escape.js';
import { CSS, SCRIPT } from './html-assets.js';
import { TITLE, TOOL, VERSION } from './meta.js';
import { summary } from './summary.js';

const filterTile = (filter: string, count: number, label: string): string =>
  `<button type="button" data-filter="${filter}" aria-pressed="false"><b>${count}</b>${label}</button>`;

const infoTile = (count: number, label: string): string => `<div><b>${count}</b>${label}</div>`;

const findingRow = (f: Finding): string => `<tr data-sev="${f.severity}">
  <td class="pos">${f.line}:${f.column}</td>
  <td class="${f.severity}">${f.severity}</td>
  <td class="rule"><code>${f.rule}</code></td>
  <td class="group">${f.group ?? ''}</td>
  <td><div class="msg">${esc(f.message)}</div><div class="fix"><b>How to fix:</b> <span>${esc(f.fix)}</span></div></td>
</tr>`;

const fileSection = (file: string, findings: Finding[]): string => `<section class="file">
<h3><code>${esc(file)}</code></h3>
<table><tr><th>Line</th><th>Severity</th><th>Rule</th><th>Group</th><th>Problem and fix</th></tr>
${findings.map(findingRow).join('\n')}
</table>
</section>`;

function findingsSection({ findings }: ScanResult): string {
  if (!findings.length) return '<p class="muted">No findings.</p>';
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = byFile.get(finding.file) ?? [];
    group.push(finding);
    byFile.set(finding.file, group);
  }
  return [...byFile].map(([file, group]) => fileSection(file, group)).join('\n');
}

function skippedSection({ skipped }: ScanResult): string {
  if (!skipped.length) return '<p class="muted">All files were read.</p>';
  const rows = skipped
    .map((s) => `<tr><td class="file"><code>${esc(s.file)}</code></td><td class="reason">${esc(s.reason)}</td></tr>`)
    .join('\n');
  return `<table><tr><th>File</th><th>Reason</th></tr>\n${rows}\n</table>`;
}

export function html(result: ScanResult): string {
  const s = summary(result);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE} - ${esc(s.package)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${TITLE}</h1>
<p class="source">Source: <span id="source">${TOOL} ${VERSION}</span> &middot; Package under test: <strong id="package">${esc(s.package)}</strong></p>
<div class="tiles">${filterTile('error', s.errors, 'errors')}${filterTile('warn', s.warnings, 'warnings')}${filterTile('skipped', s.skipped, 'skipped')}</div>
<div class="tiles">${infoTile(s.total, 'files in the repo')}${infoTile(s.read, 'read')}${infoTile(s.skipped, 'skipped (too large or unreadable)')}${infoTile(s.ignored, 'ignored by config')}${infoTile(s.unsupported, 'unsupported format')}${infoTile(s.outside, 'outside the scanned paths')}${s.unchanged > 0 ? infoTile(s.unchanged, 'unchanged since the base branch') : ''}${s.baselined > 0 ? infoTile(s.baselined, 'known findings hidden by the baseline') : ''}</div>
<p class="hint">Every file is counted once: ${s.total} files = ${s.read} read + ${s.skipped} skipped + ${s.ignored} ignored + ${s.unsupported} unsupported + ${s.outside} outside the scanned paths${s.unchanged > 0 ? ` + ${s.unchanged} unchanged` : ''}.</p>
<p class="hint">Click errors, warnings or skipped to show only that section. Click again to show everything.</p>
<section id="findings"><h2>Log statements that write sensitive data</h2>${findingsSection(result)}</section>
<section id="skipped"><h2>Files that could not be scanned</h2>${skippedSection(result)}</section>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
