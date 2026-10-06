import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Large repos list hundreds of thousands of paths; the default 1 MB output limit is far too small. */
const OUTPUT_LIMIT = 1 << 30;

/** Runs git and returns its stdout. Rejects when git exits non-zero. */
export async function git(...args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { maxBuffer: OUTPUT_LIMIT })).stdout;
}

/** Splits NUL-separated (`-z`) git output into paths. */
export const splitPaths = (output: string): string[] => output.split('\0').filter(Boolean);
