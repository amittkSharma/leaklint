import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { git, splitPaths } from './git.js';
import type { FileCounts } from './types.js';

const SCANNED_EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Placeholders keep `**` and `*` apart while the other glob characters are escaped. */
const GLOBSTAR_SLASH = '\uE000';
const GLOBSTAR = '\uE001';

const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('**/', GLOBSTAR_SLASH)
      .replaceAll('**', GLOBSTAR)
      .replaceAll('*', '[^/]*')
      .replaceAll(GLOBSTAR_SLASH, '(?:.*/)?')
      .replaceAll(GLOBSTAR, '.*')}$`,
  );

const toPosix = (path: string): string => path.split(sep).join('/');

/** Every file git knows about: tracked plus untracked, minus gitignored and deleted. Undefined outside a git repo. */
async function gitFiles(): Promise<string[] | undefined> {
  try {
    const [listed, deleted] = await Promise.all([
      git('ls-files', '-co', '--exclude-standard', '-z'),
      git('ls-files', '-d', '-z'),
    ]);
    const gone = new Set(splitPaths(deleted));
    return [...new Set(splitPaths(listed))].filter((file) => !gone.has(file));
  } catch {
    return undefined;
  }
}

/** Every file under the given paths, whatever its type. Used when there is no git repo. */
async function walkAll(roots: string[]): Promise<string[]> {
  const files = new Set<string>();
  const visit = async (path: string, isDirectory: boolean): Promise<void> => {
    if (!isDirectory) {
      files.add(toPosix(relative(process.cwd(), path)));
      return;
    }
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name !== '.git') await visit(join(path, entry.name), entry.isDirectory());
    }
  };
  for (const root of roots) await visit(root, (await stat(root)).isDirectory());
  return [...files];
}

export type Inventory = FileCounts & {
  /** The JS/TS files to read, sorted. */
  candidates: string[];
};

/**
 * Puts every file in exactly one bucket: outside the scanned paths, ignored by a glob, not JS/TS, unchanged (only
 * with `changed`), or a candidate. `total` is the sum of all buckets.
 */
export async function inventory(roots: string[], ignore: string[], changed?: Set<string>): Promise<Inventory> {
  for (const root of roots) {
    if (!(await stat(root).catch(() => undefined))) throw new Error(`Path not found: ${root}`);
  }
  const scanned = roots.map((root) => toPosix(relative(process.cwd(), resolve(root))));
  const insideCwd = scanned.every((path) => path !== '..' && !path.startsWith('../'));
  const files = (insideCwd && (await gitFiles())) || (await walkAll(roots));

  const ignoreGlobs = ignore.map(globToRegExp);
  const isIgnored = (file: string): boolean => {
    const parts = file.split('/');
    return parts.some((_, index) => {
      const path = parts.slice(0, index + 1).join('/');
      return ignoreGlobs.some((glob) => glob.test(path) || glob.test(`${path}/`));
    });
  };
  const isScanned = (file: string): boolean =>
    scanned.some((root) => root === '' || file === root || file.startsWith(`${root}/`));

  const result: Inventory = {
    candidates: [],
    total: files.length,
    ignored: 0,
    unsupported: 0,
    outside: 0,
    unchanged: 0,
  };
  for (const file of files) {
    if (!isScanned(file)) result.outside++;
    else if (isIgnored(file)) result.ignored++;
    else if (!SCANNED_EXTENSIONS.test(file)) result.unsupported++;
    else if (changed && !changed.has(file)) result.unchanged++;
    else result.candidates.push(file);
  }
  result.candidates.sort();
  return result;
}
