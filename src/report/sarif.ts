import type { ScanResult } from '../types.js';

export const sarif = (r: ScanResult): string =>
  JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'leaklint', rules: [...new Set(r.findings.map((f) => f.rule))].sort().map((id) => ({ id })) } },
          results: r.findings.map((f) => ({
            ruleId: f.rule,
            level: f.severity === 'error' ? 'error' : 'warning',
            message: { text: f.message },
            locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line, startColumn: f.column } } }],
          })),
        },
      ],
    },
    null,
    2,
  );
