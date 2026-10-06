import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../src/report/index.js';
import type { ScanResult } from '../src/types.js';

const r: ScanResult = {
  files: 2,
  warnings: ['src/huge.js: skipped (larger than 1 MB)'],
  findings: [
    { file: 'src/a.ts', line: 3, column: 5, rule: 'no-sensitive-key', severity: 'error', message: '"password" (credentials) is written to a log' },
    { file: 'src/b.ts', line: 1, column: 1, rule: 'no-pii-value', severity: 'warn', message: 'email address in <log> & message' },
  ],
};

test('text lists findings, warnings and a summary', () => {
  const t = render('text', r);
  assert.match(t, /src\/a\.ts:3:5 {2}error {2}no-sensitive-key {2}"password"/);
  assert.match(t, /warning: src\/huge\.js: skipped/);
  assert.match(t, /1 error, 1 warning in 2 files/);
});

test('json has a summary and the findings', () => {
  const j = JSON.parse(render('json', r));
  assert.deepEqual(j.summary, { errors: 1, warnings: 1, files: 2 });
  assert.equal(j.findings.length, 2);
});

test('sarif is 2.1.0 with located results', () => {
  const s = JSON.parse(render('sarif', r));
  assert.equal(s.version, '2.1.0');
  const [first] = s.runs[0].results;
  assert.equal(first.ruleId, 'no-sensitive-key');
  assert.equal(first.level, 'error');
  assert.equal(first.locations[0].physicalLocation.region.startLine, 3);
  assert.equal(s.runs[0].results[1].level, 'warning');
});

test('junit: errors are failures, warnings are skipped, xml is escaped', () => {
  const x = render('junit', r);
  assert.match(x, /<testsuite name="leaklint" tests="2" failures="1">/);
  assert.match(x, /<failure message="&quot;password&quot;/);
  assert.match(x, /<skipped message="email address in &lt;log&gt; &amp; message"\/>/);
});

test('junit with no findings has one passing case', () => {
  const x = render('junit', { findings: [], warnings: [], files: 1 });
  assert.match(x, /tests="1" failures="0"/);
  assert.match(x, /name="no findings"/);
});
