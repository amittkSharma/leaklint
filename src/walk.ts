import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export const globToRegExp = (g: string): RegExp =>
  new RegExp(
    '^' +
      g
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '(?:.*/)?')
        .replace(/\u0001/g, '.*') +
      '$',
  );

export async function collectFiles(roots: string[], ignore: string[]): Promise<string[]> {
  const res = ignore.map(globToRegExp);
  const out: string[] = [];
  const visit = async (path: string, isDir: boolean): Promise<void> => {
    const rel = relative(process.cwd(), path).split(sep).join('/');
    if (res.some((re) => re.test(rel) || re.test(rel + '/'))) return;
    if (!isDir) {
      if (EXT.test(path)) out.push(rel);
      return;
    }
    for (const e of await readdir(path, { withFileTypes: true })) await visit(join(path, e.name), e.isDirectory());
  };
  for (const r of roots) {
    const s = await stat(r).catch(() => undefined);
    if (!s) throw new Error(`Path not found: ${r}`);
    await visit(r, s.isDirectory());
  }
  return [...new Set(out)].sort();
}
