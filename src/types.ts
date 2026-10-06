export type Group = 'credentials' | 'pii' | 'financial';
export type RuleId = 'no-sensitive-key' | 'no-whole-object' | 'no-secret-literal' | 'no-pii-value' | 'suppression-needs-reason';
export type Severity = 'error' | 'warn' | 'off';
export type KeysConfig = { groups: Group[]; add: string[]; allow: string[] };
export type Config = {
  keys: KeysConfig;
  /** Extra sink patterns matched against the callee text, `*` = any method, e.g. "audit.record", "metrics.*". */
  sinks: string[];
  /** Callee-name prefixes whose arguments are treated as sanitised. */
  safeCalls: string[];
  /** Glob patterns, relative to the working directory. */
  ignore: string[];
  rules: Record<RuleId, Severity>;
};
export type RawFinding = { file: string; line: number; column: number; rule: RuleId; message: string; group?: Group | 'custom' };
export type Finding = RawFinding & { severity: 'error' | 'warn' };
export type ScanResult = { findings: Finding[]; warnings: string[]; files: number };
