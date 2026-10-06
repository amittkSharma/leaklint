# leaklint

Static CI gate that finds **log statements writing secrets or personal data** in JS/TS. Zero config, runs in seconds, understands `console`, `process.stdout/stderr`, pino, winston, bunyan and more.

```bash
npx leaklint src                                   # text report, exit 1 on errors
npx leaklint src --format sarif --output results.sarif
npx leaklint src --max-warnings 0                  # warnings fail the build too
```

Exit codes: `0` clean, `1` findings (errors, or warnings above `--max-warnings`), `2` usage or config error. Output formats: `text`, `json`, `sarif` (GitHub code scanning), `junit` (Azure DevOps, Jenkins). It never prints the matched value, only the kind and key.

## What it catches

| Rule | Default | Flags | Does not flag |
|---|---|---|---|
| `no-sensitive-key` | error (`pii` keys: warn) | A sensitive key that is logged: `password`, `user.email`, `{ 'x-api-key': k }`, `` `token=${token}` ``, `h['authorization']`. Credential, PII (date of birth, passport, health insurance, phone, IP, home address, SSN/NINO keys) and financial groups. | Literals (`{ password: '[REDACTED]' }`), reads that don't reach output (`user.email.length`), masked values (`mask(x)`, `hash(x)`), keys in pino `redact`, lookalikes (`tokenCount`, `emailVerified`, `username`). |
| `no-whole-object` | error | `req`, `res`, `ctx`, `headers`, `session`, `req.body`, `process.env`, also inside `JSON.stringify` and spreads. | `req.method`, `req.headers.host`. |
| `no-secret-literal` | error | JWT, AWS key id, private key header, `Bearer <token>`, GitHub token, `user:pass@` URL in a log message. | Ordinary words like "password reset requested". |
| `no-pii-value` | warn | Email, US Social Security Number, UK National Insurance Number inside a log string. | `@scope/package`, SSN/NINO lookalikes that fail the format checks. |
| `suppression-needs-reason` | error | `// leaklint-disable-next-line` without `-- reason`. | |

Pino `redact` config in the same file is honoured. Suppress one line with `// leaklint-disable-next-line <rule> -- <reason>`; a missing reason is itself a finding.

## Supported loggers

`console.*`, `process.stdout/stderr.write`, pino (incl. `child`, `req.log`, `fastify.log`), winston, bunyan, log4js, NestJS `Logger`, loglevel/consola/tslog/roarr (by name), and in-house wrappers via `sinks`. Not detected: aliased or destructured loggers, `debug`, Sentry/OpenTelemetry (use `sinks`).

## Config (`leaklint.config.json`, optional)

```json
{
  "rules": { "no-pii-value": "error", "no-whole-object": "warn" },
  "keys": { "groups": ["credentials", "pii", "financial"], "add": ["zeissId"], "allow": ["token"] },
  "sinks": ["audit.record", "metrics.*"],
  "safeCalls": ["mask", "redact", "hash"],
  "ignore": ["**/fixtures/**"]
}
```

## CI

GitHub: run `npx leaklint src --format sarif --output leaklint.sarif`, then `github/codeql-action/upload-sarif`.
Azure DevOps: `npx leaklint src --format junit --output leaklint.xml`, then `PublishTestResults@2`.

## Limitations

- Heuristic and name-based; no type information, so it can't know `x` holds a password.
- No cross-file or inter-procedural data flow. A wrapper around your logger is invisible unless listed in `sinks`.
- Dynamic keys, aliasing, destructured loggers and values assembled elsewhere are not detected.
- Masking is trusted by function name.
- Pino `redact` awareness is file-local and matches the last path segment only. Pino `serializers` are not understood.
- In text, only emails, SSNs, NINOs and credential-shaped strings are detected. Dates of birth, passport, health insurance, phone numbers, IPs, names and addresses are caught only under a sensitive key name (`dob`, `passportNumber`, `clientIp`). Bare `address` is not a key (it is usually `server.address()`).
- Suppression is next-line `//` comments only. Files over 1 MB are skipped with a warning.
- A fast first gate, not a replacement for runtime redaction or CodeQL/Semgrep.

## How it compares

- `eslint-plugin-pii`: unmaintained since 2022, name matching only. leaklint tracks what flows into a log call.
- `eslint-plugin-no-secrets`, gitleaks: find secrets in source, not in log output.
- CodeQL / Semgrep: deeper data flow, but heavy platform or rule authoring. Use alongside.
- pino `redact`: runtime safety net; doesn't stop the bad line being written.

## Audit

Run on `pinojs/pino-http` and `fastify/fastify` (101 files): 9 findings. 3 false positives (`server listening on ${address}`), fixed by dropping bare `address` as a key. The remaining 6 are `no-whole-object` hits: 2 log `request.headers`/`request.body` in examples (real), 4 pass `req`/`request` to pino, which those projects serialise through pino `serializers` (a known limitation). If you use serializers, set `no-whole-object` to `warn`.

## License

MIT
