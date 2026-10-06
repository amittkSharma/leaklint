import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const bin = resolve('dist/src/cli.js');
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });

const LEAK = 'logger.info({ password: user.password });\n';
const OTHER_LEAK = 'logger.info({ apiKey: settings.apiKey });\n';

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'leaklint-feature-'));
  await write(dir, files);
  return dir;
}

async function write(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), body);
  }
}

describe('baseline', () => {
  test('records known findings, then reports only new ones', async () => {
    const dir = await project({ 'src/old.ts': LEAK });

    const written = run(dir, 'src', '--write-baseline');
    assert.equal(written.status, 0);
    assert.match(written.stdout, /Baseline written to leaklint-baseline\.json with 1 known finding/);

    const clean = run(dir, 'src', '--baseline', 'leaklint-baseline.json');
    assert.equal(clean.status, 0);
    assert.match(clean.stdout, /0 errors, 0 warnings;.*; 1 known finding hidden by the baseline/);

    await write(dir, { 'src/new.ts': OTHER_LEAK });
    const withNew = run(dir, 'src', '--baseline', 'leaklint-baseline.json');
    assert.equal(withNew.status, 1);
    assert.match(withNew.stdout, /src\/new\.ts:1:\d+ {2}error {2}no-sensitive-key/);
    assert.doesNotMatch(withNew.stdout, /src\/old\.ts:/);
  });

  test('still recognises a known finding after the code above it moves', async () => {
    const dir = await project({ 'src/old.ts': LEAK });
    run(dir, 'src', '--write-baseline');
    await write(dir, { 'src/old.ts': `// a new comment\n\n${LEAK}` });
    assert.equal(run(dir, 'src', '--baseline', 'leaklint-baseline.json').status, 0);
  });

  test('reports a second copy of a known finding as new', async () => {
    const dir = await project({ 'src/old.ts': LEAK });
    run(dir, 'src', '--write-baseline');
    await write(dir, { 'src/old.ts': LEAK + LEAK });
    const result = run(dir, 'src', '--baseline', 'leaklint-baseline.json');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /1 error,.*1 known finding hidden/);
  });

  test('never stores the code, and is picked up from the config', async () => {
    const dir = await project({
      'src/old.ts': "logger.info('Bearer abcdefghijklmnopqrstuvwxyz0123');\n",
      'leaklint.config.json': '{ "baseline": "known.json" }',
    });
    assert.equal(run(dir, 'src', '--write-baseline').status, 0);
    const saved = await readFile(join(dir, 'known.json'), 'utf8');
    assert.doesNotMatch(saved, /abcdefghijklmnopqrstuvwxyz0123/);
    assert.equal(run(dir, 'src').status, 0);
  });

  test('a missing or foreign baseline file exits 2 with a one-line message', async () => {
    const dir = await project({ 'src/a.ts': LEAK, 'other.json': '{}' });
    const missing = run(dir, 'src', '--baseline', 'nope.json');
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /^Baseline "nope\.json" not found\. Create it with --write-baseline\n$/);
    const foreign = run(dir, 'src', '--baseline', 'other.json');
    assert.equal(foreign.status, 2);
    assert.match(foreign.stderr, /not a leaklint baseline/);
  });
});

describe('--changed-only', () => {
  /** A repo whose main branch already contains one leak, on a feature branch with nothing changed yet. */
  async function repo(): Promise<string> {
    const dir = await project({ 'src/old.ts': LEAK });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'initial');
    git(dir, 'checkout', '-q', '-b', 'feature');
    return dir;
  }

  test('scans only what changed since main and counts the rest as unchanged', async () => {
    const dir = await repo();
    const untouched = run(dir, '--changed-only');
    assert.equal(untouched.status, 0);
    assert.match(untouched.stdout, /1 unchanged since the base branch/);

    await write(dir, { 'src/new.ts': OTHER_LEAK });
    const changed = run(dir, '--changed-only');
    assert.equal(changed.status, 1);
    assert.match(changed.stdout, /src\/new\.ts:/);
    assert.doesNotMatch(changed.stdout, /src\/old\.ts:/);
  });

  test('includes committed and modified files, and honours --base', async () => {
    const dir = await repo();
    await write(dir, { 'src/committed.ts': OTHER_LEAK });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'add');
    await write(dir, { 'src/old.ts': `${LEAK}// edited\n` });

    const result = run(dir, '--changed-only', '--base', 'main');
    assert.match(result.stdout, /src\/committed\.ts:/);
    assert.match(result.stdout, /src\/old\.ts:/);
  });

  test('fails clearly outside git, with an unknown base, and with --write-baseline', async () => {
    const plain = await project({ 'src/a.ts': LEAK });
    assert.match(run(plain, '--changed-only').stderr, /^--changed-only needs a git repository\n$/);

    const dir = await repo();
    assert.match(run(dir, '--changed-only', '--base', 'nope').stderr, /Cannot find git ref "nope" for --base/);
    assert.match(run(dir, '--base', 'main').stderr, /--base needs --changed-only/);
    assert.match(run(dir, '--changed-only', '--write-baseline').stderr, /--write-baseline needs a full scan/);
    for (const args of [['--changed-only'], ['--base', 'main'], ['--changed-only', '--write-baseline']]) {
      assert.equal(run(plain, ...args).status, 2);
    }
  });
});

describe('baseline validation', () => {
  test('rejects entries that are missing a count or have the wrong shape', async () => {
    const dir = await project({
      'src/a.ts': LEAK,
      'broken.json': JSON.stringify({
        version: 1,
        findings: [{ file: 'src/a.ts', rule: 'no-sensitive-key', hash: 'abc' }],
      }),
      'nulls.json': JSON.stringify({ version: 1, findings: [null] }),
    });
    for (const file of ['broken.json', 'nulls.json']) {
      const result = run(dir, 'src', '--baseline', file);
      assert.equal(result.status, 2, file);
      assert.match(result.stderr, /not a leaklint baseline/);
    }
  });
});
