import { readFileSync } from 'node:fs';

/** What the report is about. The tool name is the source of the report, not part of this title. */
export const TITLE = 'Sensitive Data in Logs: Scan Report';
export const TOOL = 'leaklint';

const PACKAGE_JSON = new URL('../../../package.json', import.meta.url);
export const VERSION: string = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;
