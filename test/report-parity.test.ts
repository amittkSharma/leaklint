import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FORMATS, type Format, render } from '../src/report/index.js';
import { TITLE, TOOL, VERSION } from '../src/report/meta.js';
import type { Finding, ScanResult, Skipped } from '../src/types.js';
import { scanResult } from './helpers.js';

/** Every format is parsed back into this one shape; all of them must reproduce the input exactly. */
type Parsed = {
  title: string;
  source: string;
  summary: {
    package: string;
    errors: number;
    warnings: number;
    total: number;
    read: number;
    skipped: number;
    ignored: number;
    unsupported: number;
    outside: number;
    unchanged: number;
    baselined: number;
  };
  findings: (Finding & { group?: string })[];
  skipped: Skipped[];
};

const unesc = (s: string) =>
  s.replace(
    /&(lt|gt|amp|quot|apos|#39);/g,
    (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'" })[e as string] as string,
  );
const norm = (f: Finding) => ({
  file: f.file,
  line: f.line,
  column: f.column,
  rule: f.rule,
  severity: f.severity,
  message: f.message,
  fix: f.fix,
  group: f.group ?? null,
});

const input: ScanResult = {
  package: '@scope/demo <pkg>',
  files: { total: 12, ignored: 3, unsupported: 2, outside: 1, unchanged: 2 },
  baselined: 3,
  skipped: [
    { file: 'src/huge <1>.js', reason: '11.0 MB, over the 10 MB limit' },
    { file: 'src/denied.ts', reason: "EACCES: permission denied, open 'src/denied.ts'" },
  ],
  findings: [
    {
      file: 'src/a.ts',
      line: 3,
      column: 5,
      rule: 'no-sensitive-key',
      severity: 'error',
      group: 'credentials',
      message: 'The credentials field "password" is written to the log.',
      fix: 'Remove it or mask it: logger.info({ password: mask(value) }). If safe, add it to "keys.allow".',
    },
    {
      file: 'src/a.ts',
      line: 9,
      column: 1,
      rule: 'no-whole-object',
      severity: 'error',
      message: '`req` is logged whole & unsafe <b>.',
      fix: 'Log only the fields you need: logger.info({ method: req.method }).',
    },
    {
      file: 'src/<b>.ts',
      line: 1,
      column: 13,
      rule: 'no-pii-value',
      severity: 'warn',
      message: 'An email address is written in a log message.',
      fix: "Log an id: logger.info('sent mail to user ' + user.id).",
    },
  ],
};

const parse: Record<Format, (out: string) => Parsed> = {
  json(o) {
    const j = JSON.parse(o);
    return { ...j, source: `${j.source.tool} ${j.source.version}` };
  },
  text(o) {
    const lines = o.split('\n');
    const findings: Parsed['findings'] = [];
    const skipped: Skipped[] = [];
    let sum: Parsed['summary'] | undefined;
    let pkg = '';
    let source = '';
    for (const l of lines) {
      let m: RegExpMatchArray | null;
      if ((m = l.match(/^(.+?):(\d+):(\d+) {2}(error|warn) +(\S+) {2}(.*)$/)))
        findings.push({
          file: m[1],
          line: +m[2],
          column: +m[3],
          severity: m[4] as 'error' | 'warn',
          rule: m[5] as Finding['rule'],
          message: m[6],
          fix: '',
        });
      else if ((m = l.match(/^ {4}group: (.*)$/))) findings[findings.length - 1].group = m[1] as Finding['group'];
      else if ((m = l.match(/^ {4}fix: (.*)$/))) findings[findings.length - 1].fix = m[1];
      else if ((m = l.match(/^warning: (.+?): skipped \((.*)\)$/))) skipped.push({ file: m[1], reason: m[2] });
      else if ((m = l.match(/^package: (.*)$/))) pkg = m[1];
      else if ((m = l.match(/^source: (.*)$/))) source = m[1];
      else if (
        (m = l.match(
          /^(\d+) errors?, (\d+) warnings?; (\d+) files? in the repo: (\d+) read, (\d+) skipped, (\d+) ignored, (\d+) unsupported format, (\d+) outside the scanned paths(?:, (\d+) unchanged since the base branch)?(?:; (\d+) known findings? hidden by the baseline)?$/,
        ))
      )
        sum = {
          package: pkg,
          errors: +m[1],
          warnings: +m[2],
          total: +m[3],
          read: +m[4],
          skipped: +m[5],
          ignored: +m[6],
          unsupported: +m[7],
          outside: +m[8],
          unchanged: +(m[9] ?? 0),
          baselined: +(m[10] ?? 0),
        };
    }
    return { title: lines[0], source, summary: sum as Parsed['summary'], findings, skipped };
  },
  sarif(o) {
    const run = JSON.parse(o).runs[0];
    const at = (x: any) => x.locations[0].physicalLocation;
    return {
      title: run.properties.title,
      source: `${run.tool.driver.name} ${run.tool.driver.version}`,
      summary: run.properties.summary,
      findings: run.results.map((x: any) => ({
        file: at(x).artifactLocation.uri,
        line: at(x).region.startLine,
        column: at(x).region.startColumn,
        rule: x.ruleId,
        severity: x.properties.severity,
        message: x.message.text,
        fix: x.properties.fix,
        group: x.properties.group ?? undefined,
      })),
      skipped: run.invocations[0].toolExecutionNotifications.map((n: any) => ({
        file: at(n).artifactLocation.uri,
        reason: n.message.text,
      })),
    };
  },
  junit(o) {
    const sum: Record<string, number | string> = {};
    for (const m of o.matchAll(/<property name="(\w+)" value="([^"]*)"\/>/g))
      sum[m[1]] = m[1] === 'package' || m[1] === 'source' ? unesc(m[2]) : +m[2];
    const source = sum.source as string;
    delete sum.source;
    const findings: Parsed['findings'] = [];
    const skipped: Skipped[] = [];
    for (const m of o.matchAll(/<testcase classname="([^"]*)" name="([^"]*)">(.*?)<\/testcase>/gs)) {
      const [, file, name, body] = m;
      if (name === 'not scanned')
        skipped.push({ file: unesc(file), reason: unesc(body.match(/message="([^"]*)"/)![1]) });
      else {
        const d = Object.fromEntries(
          unesc(body.match(/<system-out>(.*)<\/system-out>/s)![1])
            .split('\n')
            .map((l) => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)]),
        );
        findings.push({
          file: unesc(file),
          line: +d.line,
          column: +d.column,
          rule: name.split(':')[0] as Finding['rule'],
          severity: d.severity as 'error' | 'warn',
          message: unesc(body.match(/message="([^"]*)"/)![1]),
          fix: d.fix,
          group: d.group as Finding['group'],
        });
      }
    }
    return {
      title: unesc(o.match(/<testsuite name="([^"]*)"/)![1]),
      source,
      summary: sum as Parsed['summary'],
      findings,
      skipped,
    };
  },
  html(raw) {
    const o = raw.replace(/>\s+</g, '><');
    const sum: Record<string, number | string> = {
      package: unesc(o.match(/<strong id="package">(.*?)<\/strong>/)![1]),
      unchanged: 0,
      baselined: 0,
    };
    const names: Record<string, string> = {
      'files in the repo': 'total',
      'skipped (too large or unreadable)': 'skipped',
      'ignored by config': 'ignored',
      'unsupported format': 'unsupported',
      'outside the scanned paths': 'outside',
      'unchanged since the base branch': 'unchanged',
      'known findings hidden by the baseline': 'baselined',
    };
    for (const m of o.matchAll(/<b>(\d+)<\/b>([^<]+)</g)) sum[names[m[2]] ?? m[2]] = +m[1];
    const findings: Parsed['findings'] = [];
    for (const sec of o.split('<h3>').slice(1)) {
      const file = unesc(sec.match(/^<code>(.*?)<\/code>/)![1]);
      for (const m of sec.matchAll(
        /<tr data-sev="(?:error|warn)"><td class="pos">(\d+):(\d+)<\/td><td class="(error|warn)">\3<\/td><td class="rule"><code>(.*?)<\/code><\/td><td class="group">(.*?)<\/td><td><div class="msg">(.*?)<\/div><div class="fix"><b>How to fix:<\/b><span>(.*?)<\/span><\/div><\/td><\/tr>/gs,
      )) {
        findings.push({
          file,
          line: +m[1],
          column: +m[2],
          severity: m[3] as 'error' | 'warn',
          rule: m[4] as Finding['rule'],
          group: (m[5] || undefined) as Finding['group'],
          message: unesc(m[6]),
          fix: unesc(m[7]),
        });
      }
    }
    const skipped = [...o.matchAll(/<td class="file"><code>(.*?)<\/code><\/td><td class="reason">(.*?)<\/td>/g)].map(
      (m) => ({ file: unesc(m[1]), reason: unesc(m[2]) }),
    );
    return {
      title: unesc(o.match(/<h1>(.*?)<\/h1>/)![1]),
      source: unesc(o.match(/<span id="source">(.*?)<\/span>/)![1]),
      summary: sum as Parsed['summary'],
      findings,
      skipped,
    };
  },
};

for (const format of FORMATS) {
  test(`${format} carries every field, identical to the other formats`, () => {
    const p = parse[format](render(format, input));
    assert.equal(p.title, TITLE);
    assert.equal(p.source, `${TOOL} ${VERSION}`);
    assert.deepEqual(p.summary, {
      package: input.package,
      errors: 2,
      warnings: 1,
      total: 12,
      read: 2,
      skipped: 2,
      ignored: 3,
      unsupported: 2,
      outside: 1,
      unchanged: 2,
      baselined: 3,
    });
    assert.deepEqual(p.findings.map(norm), input.findings.map(norm));
    assert.deepEqual(p.skipped, input.skipped);
  });
}

test('an empty scan reports zeros in every format', () => {
  for (const format of FORMATS) {
    const p = parse[format](render(format, scanResult()));
    assert.deepEqual(
      p.summary,
      {
        package: 'p',
        errors: 0,
        warnings: 0,
        total: 0,
        read: 0,
        skipped: 0,
        ignored: 0,
        unsupported: 0,
        outside: 0,
        unchanged: 0,
        baselined: 0,
      },
      format,
    );
    assert.deepEqual([p.findings, p.skipped], [[], []], format);
    assert.equal(p.title, TITLE, format);
  }
});
