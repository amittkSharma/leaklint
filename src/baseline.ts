import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { Finding } from './types.js';

export const DEFAULT_BASELINE_FILE = 'leaklint-baseline.json';

const FORMAT_VERSION = 1;

/** One group of identical known findings in one file. */
type Entry = { file: string; rule: string; hash: string; count: number };
type Baseline = { version: number; findings: Entry[] };

const entryKey = (file: string, hash: string): string => `${file}\0${hash}`;

/**
 * Identifies a finding by what it says and the code it points at, not by its line number, so unrelated edits
 * above it do not make it look new. Only a hash of the line is stored: a baseline never contains the code.
 */
const fingerprint = (finding: Finding, lines: string[]): string =>
  createHash('sha1')
    .update(`${finding.rule}\0${finding.message}\0${(lines[finding.line - 1] ?? '').trim()}`)
    .digest('hex')
    .slice(0, 16);

/** One fingerprint per finding, or undefined when its file can no longer be read. */
async function fingerprints(findings: Finding[]): Promise<(string | undefined)[]> {
  const sources = new Map<string, string[] | undefined>();
  for (const { file } of findings) {
    if (sources.has(file)) continue;
    sources.set(
      file,
      await readFile(file, 'utf8').then(
        (text) => text.split('\n'),
        () => undefined,
      ),
    );
  }
  return findings.map((finding) => {
    const lines = sources.get(finding.file);
    return lines && fingerprint(finding, lines);
  });
}

export async function writeBaseline(path: string, findings: Finding[]): Promise<void> {
  const hashes = await fingerprints(findings);
  const counts = new Map<string, Entry>();
  findings.forEach((finding, index) => {
    const hash = hashes[index];
    if (!hash) return;
    const key = entryKey(finding.file, hash);
    const entry = counts.get(key) ?? { file: finding.file, rule: finding.rule, hash, count: 0 };
    entry.count++;
    counts.set(key, entry);
  });
  const entries = [...counts.values()].sort((a, b) => a.file.localeCompare(b.file) || a.hash.localeCompare(b.hash));
  const baseline: Baseline = { version: FORMAT_VERSION, findings: entries };
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

const isEntry = (value: unknown): value is Entry => {
  const entry = value as Entry | null;
  return (
    typeof entry?.file === 'string' &&
    typeof entry.rule === 'string' &&
    typeof entry.hash === 'string' &&
    Number.isInteger(entry.count) &&
    entry.count > 0
  );
};

const isBaseline = (value: unknown): value is Baseline => {
  const baseline = value as Baseline | undefined;
  return baseline?.version === FORMAT_VERSION && Array.isArray(baseline.findings) && baseline.findings.every(isEntry);
};

export async function readBaseline(path: string): Promise<Baseline> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Baseline "${path}" not found. Create it with --write-baseline`);
  }
  const baseline: unknown = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (!isBaseline(baseline)) {
    throw new Error(`Baseline "${path}" is not a leaklint baseline. Recreate it with --write-baseline`);
  }
  return baseline;
}

/** Splits findings into new ones and the number already known. A new duplicate beyond the recorded count is new. */
export async function applyBaseline(
  findings: Finding[],
  baseline: Baseline,
): Promise<{ findings: Finding[]; baselined: number }> {
  const remaining = new Map(baseline.findings.map((entry) => [entryKey(entry.file, entry.hash), entry.count]));
  const hashes = await fingerprints(findings);
  const fresh = findings.filter((finding, index) => {
    const hash = hashes[index];
    if (!hash) return true;
    const key = entryKey(finding.file, hash);
    const left = remaining.get(key) ?? 0;
    if (left === 0) return true;
    remaining.set(key, left - 1);
    return false;
  });
  return { findings: fresh, baselined: findings.length - fresh.length };
}
