# leaklint: design

How leaklint works and why. For using it, see the [README](../README.md).

## Purpose

Find log statements that write secrets or personal data, in JavaScript and TypeScript, fast enough to run on every commit. It is a static gate: no execution, no type-checking, no network. It complements runtime redaction (pino `redact`) and data-flow scanners (CodeQL, Semgrep); it does not replace them.

## Principles

1. **Never echo a matched value.** Messages name the kind and the key, never the content.
2. **No network, no telemetry.**
3. **Deterministic output.** Findings are sorted and carry no timestamps, so diffs are meaningful.
4. **Fail safe.** An unreadable, unparsable or oversized file never aborts a run; it is listed as skipped.
5. **Zero config is useful; config only tunes.**
6. **Prefer precision.** A name is flagged only when it is the thing itself, not a flag, count or derived value about it. Ambiguous names need evidence before they count.
7. **Account for every file.** Each file in the repository lands in exactly one bucket (read, skipped, ignored, unsupported, outside the scanned paths, unchanged), so a clean result can be checked.

## Pipeline

```
file list (git, else folder walk) -> bucket every file (outside | ignored | unsupported | candidate)
  -> parse candidate (TypeScript AST, parse only)
  -> find logging calls (sinks)
  -> check each argument (rules)       -> apply pino redact and suppression comments
  -> findings -> reporter -> exit code
```

## Modules

| File | Responsibility |
|---|---|
| `cli.ts` | Options, exit codes |
| `config.ts`, `defaults.ts` | Load and validate config; default keys, ignore globs, severities |
| `regex-entry.ts` | `/regex/flags` entries in config lists |
| `walk.ts` | File inventory: git file list (or folder walk), glob ignore, bucketing |
| `changed.ts` | Files changed since the branch point from a base ref (`--changed-only`) |
| `baseline.ts` | Write, read and apply a baseline of known findings |
| `scan.ts` | Parse a file, run the checks, apply severity and suppression; scan many files |
| `sinks.ts` | Recognise logging calls: console, stdio, logger factories, receivers named like loggers, configured `sinks` |
| `rules.ts` | Walk a logging call's arguments and produce findings |
| `keys.ts`, `vocabulary.ts` | Decide whether a name is sensitive; the words that cancel a match |
| `literals.ts` | Secret and personal-data patterns for strings |
| `evidence.ts` | Syntax evidence: is `res` an HTTP response, is `token` streamed text, is a constant a plain string |
| `syntax.ts` | Small AST helpers shared by the above |
| `messages.ts` | The sentence and the fix example for each finding |
| `redact.ts` | Keys redacted by `pino({ redact })` in the same file |
| `suppress.ts` | `leaklint-disable-next-line` comments |
| `report/` | One renderer per format, plus shared summary and escaping |

## How a logging call is checked

`rules.ts` visits each argument and tracks whether a value is *terminal*: the value itself ends up in the output. `user.email` is terminal in `log(user.email)` but not in `log(user.email.length)` or `log(a.email === b)`. Name and whole-object checks fire only on terminal values; string checks fire everywhere.

- **Objects:** each property key is checked, unless its value is harmless (a literal, `!!x`, `Boolean(x)`, a comparison, `.length`, `Object.keys(x)`, a conditional of literals) or a call to a safe function.
- **Templates and concatenation:** interpolations are terminal; `+`, `??`, `||` pass values through, comparisons do not.
- **Callbacks:** an arrow function's returned value is data.
- **Serializing calls** (`JSON.stringify`, `inspect`, `format`): their arguments are written as they are.

## Sensitive names

A name is split into lowercase words (`accessToken` -> `access`, `token`) and matched by its last one to three words against the key table. Then the surrounding words can cancel the match:

- A **flag or count prefix** (`has`, `is`, `skip`, `num`, `number of`) means the name talks about the data.
- A **derived or made-up prefix** (`hashed`, `masked`, `without`, `fake`, `mock`, `public`).
- A **qualifier** before one noun (`inputToken`, `channel.token`, `pathInZip`), or a **quantity word** before a plural credential (`cacheReadTokens`, `deletedSecrets`).
- A **machine owner** (`serviceAccountEmail`) or a **test owner** (`spec.fullName`) for personal data.
- A bare **ALL_CAPS_WITH_UNDERSCORES** personal-data name is a constant. Credentials stay flagged.

`vocabulary.ts` holds all of these word lists; `keys.ts` applies them. Config can add names, allow names, and use regular expressions.

## Evidence for ambiguous names

`res`, `response`, `request` and `ctx` are common names for non-HTTP things. `evidence.ts` flags them only when:

- the function also has handler parameters (`req`, `next`, ...), or
- the parameter is typed as a request or response, or
- (for responses) the value is the result of an HTTP client call.

`{ req, res }` as object keys are serializer slots for pino, bunyan and fastify, so they are accepted there and still flagged for `console`.

## Severity

Configured per rule. Personal-data key names are capped at `warn` because a name is weaker evidence than a pattern. Suppression comments silence the next line; a missing reason is itself a finding, and the suppression still applies.

## Baseline and changed-only

- **Baseline:** a finding is identified by its file, rule, message and a hash of its (trimmed) source line, not by its line number, so edits above it do not make it new. Identical findings are stored with a count, so a second copy is new. The file holds hashes only, never code.
- **`--changed-only`:** the changed set is the diff from the merge base with the base ref to the working tree, plus untracked files. Unchanged JS/TS files get their own bucket so the file counts still add up.
- Both are applied outside the scanner: `changed` narrows the candidate list in `walk.ts`, and the baseline filters findings in `cli.ts`. `--write-baseline` refuses `--changed-only`, because a baseline from a partial scan would silently drop everything else.

## Files and reports

- File list: `git ls-files` (tracked and untracked, minus gitignored and deleted); outside git, a folder walk.
- Files over 10 MB, and unreadable files, are skipped and listed with the reason. They do not change the exit code.
- Every format carries the same data. A test renders one result in all formats, parses each back, and requires them to match.
- The HTML report is one self-contained file. Its filter script is inline; all text is escaped.

## Decisions and trade-offs

- **No type information.** Keeps it fast and dependency-free, at the cost of guessing from names.
- **Evidence over blanket rules** for ambiguous names: fewer false alarms, at the price of missing a leak when the evidence is absent (an untyped `request` parameter on its own).
- **`sessionId` is not a default key.** It is a login credential in some systems and a chat, database or payment id in most. It is opt-in through `keys.add`.
- **Pino `redact` matching is file-local and by last path segment.** A key redacted anywhere in the file counts as redacted everywhere in it.
- **A masking function is trusted by name.**

## Known limits

- No cross-file or inter-procedural flow; wrappers must be listed in `sinks`.
- Aliased or destructured loggers, dynamic keys and strings built elsewhere are not followed.
- In free text only emails, SSNs, NINOs and credential-shaped strings are recognised.
- Not detected: the `debug` package, and Sentry or OpenTelemetry calls unless listed in `sinks`.

## Extending

- **A rule:** add the id to `RuleId` and the defaults in `defaults.ts`, produce findings in `rules.ts`, add the text in `messages.ts`, and cover it with a test in `test/`.
- **A key word list:** edit `vocabulary.ts` or `DEFAULT_KEYS`; add a case to `test/false-positives.test.ts` or `test/rules.test.ts`.
- **A format:** add `report/<name>.ts`, register it in `report/index.ts`, and add it to the parity test.

## Development

```bash
yarn install
yarn test     # builds, then runs node --test on dist/test
yarn types    # tsc --noEmit
yarn lint     # biome check
yarn format   # biome check --write
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org). `yarn release` (or `yarn release:first` once) bumps the version, updates `CHANGELOG.md`, commits and tags; `yarn release --dry-run` previews. Publish with `git push --follow-tags origin master && npm publish`, which runs the tests first.
