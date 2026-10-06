import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const bin = resolve('dist/src/cli.js');
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });

async function project(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'leaklint-cli-'));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), body);
  }
  return dir;
}

test('clean project exits 0', async () => {
  const dir = await project({ 'src/a.ts': 'logger.info({ userId });' });
  const r = run(dir, 'src');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0 errors, 0 warnings; 1 file in the repo: 1 read/);
});

test('a leak exits 1 and never prints the value', async () => {
  const dir = await project({ 'src/a.ts': "logger.info('contact a@b.com, ssn 123-45-6789', { password });" });
  const r = run(dir, 'src');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no-sensitive-key/);
  assert.doesNotMatch(r.stdout, /a@b\.com|123-45-6789/);
});

test('warnings only: exit 0, but 1 with --max-warnings 0', async () => {
  const dir = await project({ 'src/a.ts': "logger.info('contact a@b.com');" });
  assert.equal(run(dir, 'src').status, 0);
  assert.equal(run(dir, 'src', '--max-warnings', '0').status, 1);
});

test('sarif and junit formats, and --output', async () => {
  const dir = await project({ 'src/a.ts': 'logger.info({ password });' });
  assert.equal(JSON.parse(run(dir, 'src', '--format', 'sarif').stdout).version, '2.1.0');
  assert.match(run(dir, 'src', '--format', 'junit').stdout, /<failure /);
  run(dir, 'src', '--format', 'json', '--output', 'out.json');
  assert.equal(JSON.parse(await readFile(join(dir, 'out.json'), 'utf8')).summary.errors, 1);
});

test('config file severity is honoured', async () => {
  const dir = await project({
    'src/a.ts': 'logger.info({ password });',
    'leaklint.config.json': '{"rules":{"no-sensitive-key":"warn"}}',
  });
  assert.equal(run(dir, 'src').status, 0);
});

test('usage and input errors exit 2 with one line, no stack trace', async () => {
  const dir = await project({ 'src/a.ts': '' });
  for (const args of [
    ['src', '--format', 'xml'],
    ['nope'],
    ['src', '--config', 'missing.json'],
    ['src', '--max-warnings', 'x'],
  ]) {
    const r = run(dir, ...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  assert.match(run(dir, 'nope').stderr, /Path not found: nope/);
});
