import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { scanFiles } from '../src/scan.js';
import { inventory } from '../src/walk.js';

async function inTmp<T>(files: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'leaklint-'));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), body);
  }
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

test('sorts every file into read candidates, ignored and unsupported; the buckets add up to the total', () =>
  inTmp(
    { 'src/b.ts': '', 'src/a.tsx': '', 'src/a.test.ts': '', 'node_modules/x/i.js': '', 'README.md': '' },
    async () => {
      const inv = await inventory(['.'], DEFAULT_CONFIG.ignore);
      assert.deepEqual(inv.candidates, ['src/a.tsx', 'src/b.ts']);
      assert.deepEqual([inv.total, inv.ignored, inv.unsupported, inv.outside], [5, 2, 1, 0]);
    },
  ));

test('in a git repo the total is the repo files (gitignored excluded) and other folders count as outside', () =>
  inTmp({ 'src/a.ts': '', 'src/a.md': '', 'lib/b.ts': '', 'gen/c.ts': '', '.gitignore': 'gen/\n' }, async () => {
    execFileSync('git', ['init', '-q']);
    const inv = await inventory(['src'], DEFAULT_CONFIG.ignore);
    assert.deepEqual(inv.candidates, ['src/a.ts']);
    assert.deepEqual([inv.total, inv.ignored, inv.unsupported, inv.outside], [4, 0, 1, 2]);
    assert.equal(inv.total, inv.candidates.length + inv.ignored + inv.unsupported + inv.outside);
  }));

test('missing path gives a clear error', () =>
  inTmp({}, async () => {
    await assert.rejects(inventory(['nope'], []), /Path not found: nope/);
  }));

test('scans files, reports relative paths, survives garbage and skips huge files', () =>
  inTmp(
    {
      'src/leak.ts': 'logger.info({ password });',
      'src/garbage.ts': 'const = = ; ((( logger.info(',
      'src/huge.js': 'x'.repeat(10 * 1024 * 1024 + 1),
      'src/big-ok.js': `//${'x'.repeat(5_000_000)}`,
    },
    async () => {
      const r = await scanFiles(['src'], DEFAULT_CONFIG);
      assert.deepEqual(
        r.findings.map((f) => `${f.file}:${f.rule}`),
        ['src/leak.ts:no-sensitive-key'],
      );
      assert.deepEqual(r.files, { total: 4, ignored: 0, unsupported: 0, outside: 0, unchanged: 0 }); // the 5 MB file is scanned, not skipped
      assert.deepEqual(
        r.skipped.map((s) => s.file),
        ['src/huge.js'],
      );
      assert.match(r.skipped[0].reason, /10\.0 MB, over the 10 MB limit/);
    },
  ));
