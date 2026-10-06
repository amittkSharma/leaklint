import type { ScanResult } from '../types.js';
import { TITLE, TOOL, VERSION } from './meta.js';
import { summary } from './summary.js';

const location = (file: string, region?: { startLine: number; startColumn: number }) => ({
  physicalLocation: { artifactLocation: { uri: file }, ...(region && { region }) },
});

export const sarif = (result: ScanResult): string => {
  const ruleIds = [...new Set(result.findings.map((f) => f.rule))].sort();
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: TOOL, version: VERSION, rules: ruleIds.map((id) => ({ id })) } },
          properties: { title: TITLE, summary: summary(result) },
          invocations: [
            {
              executionSuccessful: true,
              toolExecutionNotifications: result.skipped.map((s) => ({
                level: 'warning',
                message: { text: s.reason },
                locations: [location(s.file)],
              })),
            },
          ],
          results: result.findings.map((f) => ({
            ruleId: f.rule,
            level: f.severity === 'error' ? 'error' : 'warning',
            message: { text: f.message },
            locations: [location(f.file, { startLine: f.line, startColumn: f.column })],
            properties: { severity: f.severity, group: f.group ?? null, fix: f.fix },
          })),
        },
      ],
    },
    null,
    2,
  );
};
