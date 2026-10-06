import { git, splitPaths } from './git.js';

const COMMON_BASES = ['origin/main', 'origin/master', 'main', 'master'];

const refExists = (ref: string): Promise<boolean> =>
  git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).then(
    () => true,
    () => false,
  );

/** The requested ref, or the first common base branch that exists. */
async function resolveBase(requested?: string): Promise<string> {
  for (const ref of requested ? [requested] : COMMON_BASES) {
    if (await refExists(ref)) return ref;
  }
  throw new Error(
    requested
      ? `Cannot find git ref "${requested}" for --base`
      : `Cannot find a base branch (tried ${COMMON_BASES.join(', ')}). Pass one with --base`,
  );
}

async function branchPoint(base: string): Promise<string> {
  try {
    return (await git('merge-base', base, 'HEAD')).trim();
  } catch {
    throw new Error(
      `Cannot find where this branch left "${base}". In CI, fetch the full history (for example actions/checkout with fetch-depth: 0)`,
    );
  }
}

export type Changes = { base: string; files: Set<string> };

/**
 * The files changed since this branch left `base`: committed, staged, modified and new files.
 * Paths are relative to the working directory, like the file list they are matched against.
 */
export async function changedSince(requestedBase?: string): Promise<Changes> {
  try {
    await git('rev-parse', '--is-inside-work-tree');
  } catch {
    throw new Error('--changed-only needs a git repository');
  }
  const base = await resolveBase(requestedBase);
  const [modified, created] = await Promise.all([
    git('diff', '--name-only', '--relative', '--diff-filter=d', '-z', await branchPoint(base)),
    git('ls-files', '-o', '--exclude-standard', '-z'),
  ]);
  return { base, files: new Set([...splitPaths(modified), ...splitPaths(created)]) };
}
