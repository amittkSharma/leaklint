export type Group = 'credentials' | 'pii' | 'financial';
/** `custom` marks names added through `keys.add`. */
export type KeyGroup = Group | 'custom';
export type RuleId =
  | 'no-sensitive-key'
  | 'no-whole-object'
  | 'no-secret-literal'
  | 'no-pii-value'
  | 'suppression-needs-reason';
export type Severity = 'error' | 'warn' | 'off';

export type KeysConfig = { groups: Group[]; add: string[]; allow: string[] };

export type Config = {
  keys: KeysConfig;
  /** Extra logging calls, matched against the callee text. `*` matches any method, or use `/regex/flags`. */
  sinks: string[];
  /** Functions whose result is trusted as masked: a name prefix, or `/regex/flags`. */
  safeCalls: string[];
  /** Globs relative to the working directory. */
  ignore: string[];
  rules: Record<RuleId, Severity>;
  /** Findings recorded in this file are known and not reported. */
  baseline?: string;
};

export type RawFinding = {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  rule: RuleId;
  /** One sentence saying what is wrong. Never contains the logged value. */
  message: string;
  /** How to solve it, with an example. */
  fix: string;
  group?: KeyGroup;
};

export type Finding = RawFinding & { severity: Exclude<Severity, 'off'> };

/** A file that was found but not scanned, and why. */
export type Skipped = { file: string; reason: string };

/** Where the files of a repo went; `read` is what remains after these and the skipped files are subtracted. */
export type FileCounts = {
  total: number;
  ignored: number;
  unsupported: number;
  outside: number;
  /** Not changed since the base branch; only counted with `--changed-only`. */
  unchanged: number;
};

export type ScanResult = {
  /** Name from the nearest package.json, else the folder name. */
  package: string;
  findings: Finding[];
  skipped: Skipped[];
  files: FileCounts;
  /** Findings hidden because the baseline already records them. */
  baselined: number;
};
