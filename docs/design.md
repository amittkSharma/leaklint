# leaklint: Design

Date: 2026-10-06 · Status: proposed, nothing implemented yet · Plan: `../plans/2026-10-06-leaklint.md`

## 1. One-line pitch

`leaklint` is a zero-config CLI that statically scans JS/TS source for **log statements that write secrets or personal data**, and fails CI with SARIF, JUnit or JSON output. It knows about `console`, `process.stdout/stderr`, pino, winston, bunyan and more.

## 2. Problem statement

Sensitive data leaks into logs by accident: `logger.info({ user })`, `console.log(req.headers)`, `` `token=${token}` ``. Logs are widely readable, kept for months, shipped to third parties and rarely redacted. This is a recurring audit finding (GDPR, ISO 27001, SOC 2) and a real breach source. Typical failure path: someone adds a debug log, review misses it, and it ships.

Existing options and why they fall short (measured 2026-10-06):

| Option | Gap |
|---|---|
| `eslint-plugin-pii` (280k downloads a month) | Last published 2022, name matching only, no notion of what is actually logged. |
| `eslint-plugin-no-secrets` (1.2M) | Finds secrets in string literals anywhere, not data flowing into log calls. |
| gitleaks / secret scanners | Scan committed secrets, not runtime log content. |
| CodeQL `js/clear-text-logging`, Semgrep rules | The strongest alternatives. They do real data-flow but need a heavy platform or rule authoring, and know nothing about pino `redact` config. |
| pino `redact`, log scrubbers | Runtime safety net only. They don't stop the bad log line from being written, and only cover what someone configured. |

**Niche:** a small, npm-native, zero-config gate that runs in seconds in any CI, understands the common Node loggers, honours pino `redact` config, and emits JUnit for Azure DevOps. It is complementary to CodeQL/Semgrep and to runtime redaction, not a replacement.

## 3. Features (v0.1)

- Finds log calls for the loggers in section 6 and scans every argument expression.
- Five rules (section 7), each with a configurable severity (`error`, `warn`, `off`).
- Flags only values that **flow into the output**, not values merely read (for example `user.email.length` and `a.email === b` are fine).
- Understands masking: calls such as `mask*`, `redact*`, `hash*` and `sanitize*` are treated as safe, and literal values (`{ password: '[REDACTED]' }`) are not leaks.
- **Pino `redact` awareness** (same file): keys already redacted by `pino({ redact: [...] })` are not flagged.
- Inline suppression `// leaklint-disable-next-line <rule> -- <reason>`; a missing reason is itself a finding.
- Output: `text`, `json`, `sarif` (GitHub code scanning), `junit` (Azure DevOps, Jenkins).
- Exit codes: `0` clean, `1` findings (errors, or warnings above `--max-warnings`), `2` usage or config error.
- Config file `leaklint.config.json`: key groups, extra keys, allowed keys, extra sinks, safe-call prefixes, ignore globs, rule severities.
- Never prints the matched secret value in any output.

### Not in v0.1 (YAGNI; revisit on demand)
- Cross-file data-flow or type information (use CodeQL for that).
- `debug` package, telemetry sinks (Sentry, OpenTelemetry `setAttribute`, Application Insights). The `sinks` config covers these manually; built-in support is v0.2.
- Auto-fix, editor extension, ESLint plugin wrapper, non-JS languages.
- Field-name consistency checks (`userId` vs `user_id`).
- Value patterns for IP addresses (skipping loopback, private and documentation ranges) and E.164 phone numbers inside log strings: v0.2, once the audit corpus shows they are quiet enough. In v0.1 they are covered by key name only.

## 4. Architecture

Pure pipeline, no state, no network, no database:

```
files (walk + ignore globs) -> parse (TypeScript AST, no type-check)
  -> find sink calls (sinks.ts) -> check arguments (rules.ts)
  -> apply pino redact + suppression comments (redact.ts, suppress.ts)
  -> findings -> reporter (text | json | sarif | junit) -> exit code
```

| File | Responsibility |
|---|---|
| `src/defaults.ts` | Default key lists and default config |
| `src/keys.ts` | Sensitive-key matcher: split names into words, match head noun or a multi-word suffix |
| `src/sinks.ts` | Identify log calls (console, stdio, known factories, name heuristics, custom sinks) |
| `src/rules.ts` | Walk arguments and produce raw findings; tracks whether a value "flows into" output |
| `src/redact.ts` | Collect keys redacted by `pino({ redact })` in the same file |
| `src/suppress.ts` | Parse suppression comments |
| `src/scan.ts` | Parse one source, run the above, apply severities; scan many files |
| `src/walk.ts` | File discovery and glob ignore |
| `src/config.ts` | Load and validate config |
| `src/report/*` | Four reporters |
| `src/cli.ts` | Flags and exit codes |

## 5. Technical stack

| Concern | Choice | Why |
|---|---|---|
| Language / runtime | TypeScript 5, Node >= 20, ESM | Target audience is Node and TS teams. |
| Parser | `typescript` compiler API (`createSourceFile`, parse only) | One parser for JS, JSX, TS and TSX. No type-checker, so it is fast. |
| CLI | `node:util` `parseArgs` | No framework needed. |
| Globs | ~8-line converter | Avoids a dependency for one function. |
| Tests | `node:test` + `node:assert` | Zero test dependencies. |
| Release | `npm publish --provenance` from CI | Credibility for a security tool. |

Only runtime dependency: `typescript`. (`// ponytail:` swap to `oxc-parser` if install size ever matters.)

## 6. Logger support

"By name" means the receiver's last identifier is `log`, `logger`, `logging`, `consola`, or ends in `Logger` or `Log` (for example `this.logger`, `req.log`, `fastify.log`, `appLogger`).

| Logger / sink | How it is detected | v0.1 |
|---|---|---|
| `console.*` (`log`, `info`, `warn`, `error`, `debug`, `trace`, `dir`, `table`) | exact | yes |
| `process.stdout.write`, `process.stderr.write` | exact | yes |
| **pino** (incl. `logger.child(bindings)`, `req.log`, `fastify.log`, pino-http) | `const x = pino(...)`, `x.child(...)`, or by name; `redact` aware | yes |
| **winston** (`logger.info(msg, meta)`, `logger.log(level, msg, meta)`) | `winston.createLogger()` variable or by name | yes |
| **bunyan** | `bunyan.createLogger()` variable or by name | yes |
| **log4js** | `log4js.getLogger()` variable | yes |
| **NestJS `Logger`** | `new Logger()` variable, `this.logger` | yes |
| loglevel, consola, tslog, roarr | by name only | yes (best effort) |
| In-house wrappers | `sinks` config, e.g. `["audit.record", "metrics.*"]` | yes |
| `debug` package (`debug('ns')(...)`) | not detected | no, v0.2 |
| Sentry, OpenTelemetry attributes, Application Insights | `sinks` config only | no built-in, v0.2 |

Not detected: aliased or destructured sinks (`const { info } = logger`; `const l = console.log`) and wrappers in other files unless listed in `sinks`.

## 7. Rules

Defaults shown. All can be set to `error`, `warn` or `off`.

| Rule ID | Default | Flags | Does not flag |
|---|---|---|---|
| `no-sensitive-key` | error | A sensitive key name that is logged: identifier (`password`), property (`user.email`), shorthand or quoted key (`{ password }`, `{ 'x-api-key': k }`), template expression (`` `token=${token}` ``), element access (`h['authorization']`). | Literal values (`{ password: '[REDACTED]' }`), reads that do not reach output (`user.email.length`, `a.email === b`), masked values (`mask(user.email)`), keys listed in pino `redact`, lookalikes (`tokenCount`, `cacheKey`, `emailVerified`, `isPasswordValid`, `username`). |
| `no-whole-object` | error | Logging an object that routinely holds secrets or personal data: `req`, `request`, `res`, `response`, `ctx`, `headers`, `session`, `req.headers`, `req.body`, `req.cookies`, `process.env`; also inside `JSON.stringify`, `util.inspect`, `format` and spreads. | Reading one safe field (`req.method`, `req.headers.host`). |
| `no-secret-literal` | error | Credential-shaped text in a log message: JWT, AWS access key id, private key header, `Bearer <token>`, GitHub token, URL with `user:pass@`. | Ordinary words such as "password reset requested". |
| `no-pii-value` | warn | Personal data inside a log string: an email address, a US Social Security Number (`###-##-####`, area not 000/666/9xx), a UK National Insurance Number (valid prefix letters, six digits, suffix A-D). | `@scope/package` strings, SSN/NINO-lookalikes that fail the format checks. |
| `suppression-needs-reason` | error | `// leaklint-disable-next-line` without `-- reason`. The suppression still applies; the missing reason is reported. | Suppressions with a reason. |

Key matching (used by `no-sensitive-key`):
- Names are split into words (`accessToken` -> `access token`, `X-Api-Key` -> `x api key`).
- A name is sensitive if its **last 1 to 3 words joined** equal a known key (`token`, `apikey`, `firstname`). A trailing plural `s` is ignored.
- Default groups: `credentials`, `pii`, `financial`. Extra keys via `keys.add`, exceptions via `keys.allow`.
- The `pii` group covers identifiers that have no reliable value format, so they are caught by key name only:
  - date of birth: `dob`, `dateofbirth`, `birthdate`
  - passport: `passport`, `passportnumber`
  - health insurance: `insurancenumber`, `healthinsuranceid`, `nhsnumber`, `mbi`
  - residential address: `address`, `homeaddress`, `street`, `postcode`, `zip`
  - phone: `phone`, `mobile`, `tel`
  - IP address: `ip`, `ipaddress`, `clientip`, `remoteaddress`, `xforwardedfor`
  - government ID: `ssn`, `socialsecuritynumber`, `nino`, `nationalinsurancenumber`
- New keys follow invariant 5: they ship as `warn` first, so the `pii` group is reported as `warn` until it passes the audit corpus.
- Consequence: `tokenCount` is not flagged (head noun is `count`) and neither is `passwordHash` (head noun is `hash`). Hashes are documented as lower risk, not safe.

### Package-level rules (invariants for maintainers)

1. **Never echo a matched value.** Messages name the kind and key only.
2. **No network calls, no telemetry,** ever.
3. **Deterministic output:** sorted findings, no timestamps, so diffs are meaningful.
4. **False-positive budget:** a rule that produces false positives on the audit corpus (README step) ships as `warn`, not `error`.
5. **New default keys or rules ship as `warn` first** and are called out in the changelog. A minor release must not newly break a clean CI run.
6. **Fail safe:** one unreadable, unparsable or huge file never aborts the run; it becomes a warning.
7. **Zero config must be useful;** config only tunes.

## 8. Limitations (will be in the README)

- Heuristic and name-based. It has no type information, so it cannot know that a variable called `x` holds a password.
- No cross-file or inter-procedural data-flow. `log(user)` inside your own wrapper is invisible unless the wrapper is in `sinks`.
- Dynamic keys (`obj[key]`), aliasing, destructured loggers and values assembled elsewhere and logged as one string are not detected.
- Masking is trusted by function name. A function named `maskX` that does not mask is not caught.
- Pino `redact` awareness is file-local and matches the last path segment only (coarse).
- Only emails, SSNs, NINOs and credential-shaped strings are detected inside text. Dates of birth, passport numbers, health insurance numbers, phone numbers, IP addresses, names and addresses in free text are not; they are caught only when logged under a sensitive key name (`dob`, `passportNumber`, `clientIp`).
- Findings are suppressed with next-line `//` comments only.
- Not a replacement for runtime redaction or for CodeQL/Semgrep. It is a fast first gate.
- Files over 1 MB are skipped with a warning.

## 9. Target audience

- Backend and full-stack teams on Node/TypeScript (Express, Fastify, NestJS) shipping to regulated or enterprise customers.
- Security, platform and compliance engineers who need an auditable, cheap CI control with SARIF or JUnit evidence.
- Teams on Azure DevOps or Jenkins (JUnit) as well as GitHub (SARIF).

## 10. Is it worth the effort?

- **Effort:** about 4 to 5 days (7 tasks). The rules engine is the real work.
- **Demand signal:** `eslint-plugin-pii` still has 280k downloads a month despite no release since 2022. That is demand without a maintained supplier.
- **Honest expectation (an estimate, not data):** hundreds to low thousands of downloads a month in year one with a good README and an audit write-up. It will not rival large tools.
- **Career value:** shows security thinking, AST tooling, deliberate false-positive control and honest documentation of limits.

## 11. Success criteria

- Every case in the rules table has a passing test, including each "does not flag" case.
- On two public Node projects (audit step in the plan), false-positive and finding counts are recorded in the README.
- `leaklint src` exits 0 on its own source; a seeded leak exits 1 in text, JSON, SARIF and JUnit.
- README states every limitation in section 8.
