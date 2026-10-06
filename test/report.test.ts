import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../src/report/index.js';
import { scanResult } from './helpers.js';

const result = scanResult({
  package: 'demo-pkg',
  files: { total: 5, ignored: 1, unsupported: 1, outside: 1, unchanged: 0 },
  skipped: [{ file: 'src/huge.js', reason: '11.0 MB, over the 10 MB limit' }],
  findings: [
    {
      file: 'src/a.ts',
      line: 3,
      column: 5,
      rule: 'no-sensitive-key',
      severity: 'error',
      message: 'The credentials field "password" is written to the log.',
      fix: 'Remove it or mask it: { password: mask(value) }',
      group: 'credentials',
    },
    {
      file: 'src/b.ts',
      line: 1,
      column: 1,
      rule: 'no-pii-value',
      severity: 'warn',
      message: 'An email address is written in a <log> & message.',
      fix: "Log an id: logger.info('user ' + id)",
    },
  ],
});

test('sarif is 2.1.0 with located results', () => {
  const sarif = JSON.parse(render('sarif', result));
  assert.equal(sarif.version, '2.1.0');
  const [first, second] = sarif.runs[0].results;
  assert.equal(first.ruleId, 'no-sensitive-key');
  assert.equal(first.level, 'error');
  assert.equal(first.locations[0].physicalLocation.region.startLine, 3);
  assert.equal(second.level, 'warning');
});

test('junit: errors are failures, warnings and skipped files are skipped cases, xml is escaped', () => {
  const xml = render('junit', result);
  assert.match(xml, /<testsuite name="Sensitive Data in Logs: Scan Report" tests="3" failures="1">/);
  assert.match(xml, /classname="src\/huge\.js" name="not scanned"><skipped message="11.0 MB, over the 10 MB limit/);
  assert.match(xml, /<failure message="The credentials field &quot;password&quot;/);
  assert.match(xml, /<skipped message="An email address is written in a &lt;log&gt; &amp; message\."\/>/);
});

test('junit with no findings has one passing case', () => {
  const xml = render(
    'junit',
    scanResult({ files: { total: 1, ignored: 0, unsupported: 0, outside: 0, unchanged: 0 } }),
  );
  assert.match(xml, /tests="1" failures="0"/);
  assert.match(xml, /name="no findings"/);
});

test('html groups findings by file, lists skipped files and escapes everything', () => {
  const html = render('html', {
    ...result,
    findings: [...result.findings, { ...result.findings[0], file: 'src/<x>.ts' }],
  });
  assert.match(html, /<h3><code>src\/a\.ts<\/code><\/h3>/);
  assert.match(html, /src\/&lt;x&gt;\.ts/);
  assert.match(html, /An email address is written in a &lt;log&gt; &amp; message/);
  assert.match(html, /<h2>Files that could not be scanned<\/h2>[\s\S]*src\/huge\.js[\s\S]*over the 10 MB limit/);
  assert.doesNotMatch(html, /<log>|<x>/);
  assert.match(render('html', scanResult()), /No findings\.[\s\S]*All files were read/);
});

test('html has filter tiles and tags every row with its severity', () => {
  const html = render('html', result);
  for (const filter of ['error', 'warn', 'skipped']) {
    assert.match(html, new RegExp(`<button type="button" data-filter="${filter}"`));
  }
  assert.equal(html.match(/<tr data-sev="error">/g)?.length, 1);
  assert.equal(html.match(/<tr data-sev="warn">/g)?.length, 1);
});
