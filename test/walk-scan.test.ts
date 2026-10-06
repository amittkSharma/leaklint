import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { scanFiles } from '../src/scan.js';
import { collectFiles } from '../src/walk.js';

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

test('collects JS/TS files, honours ignore globs, sorted', () =>
  inTmp({ 'src/b.ts': '', 'src/a.tsx': '', 'src/a.test.ts': '', 'node_modules/x/i.js': '', 'README.md': '' }, async () => {
    assert.deepEqual(await collectFiles(['.'], DEFAULT_CONFIG.ignore), ['src/a.tsx', 'src/b.ts']);
  }));

test('missing path gives a clear error', () =>
  inTmp({}, async () => {
    await assert.rejects(collectFiles(['nope'], []), /Path not found: nope/);
  }));

test('scans files, reports relative paths, survives garbage and skips huge files', () =>
  inTmp(
    { 'src/leak.ts': 'logger.info({ password });', 'src/garbage.ts': 'const = = ; ((( logger.info(', 'src/huge.js': 'x'.repeat(1_100_000) },
    async () => {
      const r = await scanFiles(['src'], DEFAULT_CONFIG);
      assert.deepEqual(r.findings.map((f) => `${f.file}:${f.rule}`), ['src/leak.ts:no-sensitive-key']);
      assert.equal(r.files, 3);
      assert.match(r.warnings.join('\n'), /src\/huge\.js: skipped \(larger than 1 MB\)/);
    },
  ));
