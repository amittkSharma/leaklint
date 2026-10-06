# leaklint

**Stop passwords, tokens and personal data from ending up in your logs.**

leaklint reads your JavaScript and TypeScript, finds every line that writes to a log, and tells you when one of them writes something it shouldn't. It runs in seconds, needs no setup, and fails your build before the leak ships.

```ts
logger.info({ password: user.password });          // leaklint: "password" is written to the log
console.log(`Welcome back ${user.email}`);         // leaklint: "email" is written to the log
logger.error(req);                                 // leaklint: `req` is logged whole
```

```text
src/auth.ts:12:20  error  no-sensitive-key  The credential field "password" is written to the log.
    group: credentials
    fix: Remove it from the log call, or log a masked value: logger.info({ password: mask(value) }). If "password" is safe to log in your code, add it to "keys.allow" in leaklint.config.json.
```

Every finding says what is wrong and shows how to fix it. leaklint never prints the leaked value itself.

## Quick start

```bash
npx @amittksharma/leaklint src
```

That is the whole setup. It exits `0` when clean and `1` when it finds problems, so it works as a CI gate as is.

Add it to your project so everyone runs the same thing:

```bash
npm install --save-dev @amittksharma/leaklint        # or: yarn add -D @amittksharma/leaklint
```

```json
{ "scripts": { "lint:leaks": "leaklint src" } }
```

Needs Node 20 or newer. Scans `.js .jsx .ts .tsx .mjs .cjs .mts .cts` files.

## What it catches

| Rule | Default | In one line |
|---|---|---|
| [`no-sensitive-key`](#no-sensitive-key) | error (personal data: warning) | A password, token, email, phone, card number... is written to a log |
| [`no-whole-object`](#no-whole-object) | error | A whole `req`, `res`, `headers`, `session` or `process.env` is logged |
| [`no-secret-literal`](#no-secret-literal) | error | A JWT, AWS key, private key or `user:pass@` URL sits inside a log message |
| [`no-pii-value`](#no-pii-value) | warning | An email, US SSN or UK National Insurance number sits inside a log message |
| [`suppression-needs-reason`](#suppress-a-line) | error | A `leaklint-disable` comment has no explanation |

It understands `console`, `process.stdout/stderr`, pino, winston, bunyan, log4js, NestJS `Logger`, loglevel, consola, tslog and roarr, plus your own logging helpers (see [`sinks`](#teach-it-your-code)).

## The rules

### `no-sensitive-key`

A sensitive name is written to a log. Names are compared ignoring case and separators, so `api_key`, `apiKey`, `API_KEY` and `X-Api-Key` are all the same.

| Group | Examples | Severity |
|---|---|---|
| `credentials` | `password`, `secret`, `token`, `apiKey`, `authorization`, `cookie`, `jwt`, `otp` | error |
| `pii` | `email`, `recipient`, `phone`, `firstName`, `ssn`, `nino`, `dateOfBirth`, `passport`, `ip`, `homeAddress` | warning |
| `financial` | `cardNumber`, `cvv`, `iban`, `accountNumber` | error |

```ts
console.log({ password: user.password });    // flagged
logger.info({ 'x-api-key': key });           // flagged
logger.info(`token=${token}`);               // flagged
logger.info(headers['authorization']);       // flagged
logger.info(users.map((u) => u.email));      // flagged

logger.info({ password: '[REDACTED]' });     // fine: a literal
logger.info({ email: mask(user.email) });    // fine: masked
logger.info(user.email.length);              // fine: read, not written
logger.info({ tokenCount, emailVerified });  // fine: different names
```

It is careful about names that only talk about the data:

```ts
logger.info({ hasEmail: Boolean(email), isPasswordSet: !!pw });  // flags and booleans
logger.info({ numEmails: emails.length, emailCount });           // counts
logger.info(`input=${usage.input_tokens}`);                      // LLM token counts
logger.info({ hashedToken, maskedEmail, fakePassword });         // derived or made-up values
logger.info({ cookies: Object.keys(req.cookies) });              // names, not values
logger.info(`${SUPPORT_EMAIL}`);                                 // a constant
```

`to`, `cc` and `bcc` count as personal data when read from a mail-like object (`emailRequest.to`, `message.cc`), not on their own.

`sessionId` and `payload` are not checked by default: a session id is as often a chat or database id as a login, and a payload is usually generic application data. Turn them on if yours carry credentials or personal data (below).

**Configure it**

```json
{
  "keys": {
    "groups": ["credentials", "financial"],
    "add": ["customerRef", "sessionId", "/^cust_\\d+_ref$/i"],
    "allow": ["token", "/^debug/i"]
  }
}
```

- `groups`: which built-in groups apply. Leave `pii` out to stop all personal-data checks.
- `add`: your own sensitive names. A plain name ignores case and separators; `/regex/flags` is matched as written.
- `allow`: names that are always fine.

### `no-whole-object`

Logging a whole request, response, context, headers, session or the environment dumps everything inside it, secrets included.

```ts
app.get('/', (req, res) => {
  logger.info(req);                  // flagged
  logger.info(req.headers);          // flagged
  logger.info(req.body);             // flagged
  logger.info({ ...req.session });   // flagged
  logger.info(JSON.stringify(res));  // flagged
  console.log(process.env);          // flagged

  logger.info(req.method);           // fine: one field
  logger.info(req.headers.host);     // fine: one field
});
```

`res`, `response`, `request` and `ctx` are flagged only when they really are HTTP objects (handler parameters, typed as a response, or the result of an HTTP client call), because those names are often used for other things:

```ts
db.query(sql).then((res) => logger.info(res));   // fine: just a query result
logger.info(`resolving '${request}'`);           // fine: not an HTTP request
```

`{ req, res }` is accepted for pino, bunyan and fastify loggers, where those two keys go through serializers. `console.log({ req })` is still flagged.

**Configure it**: if your serializers already clean these objects, make the rule advisory.

```json
{ "rules": { "no-whole-object": "warn" } }
```

### `no-secret-literal`

A string that looks like a credential is inside a log message: a JWT, an AWS access key, a private key header, `Bearer <token>`, a GitHub token, or a URL with a password.

```ts
logger.info('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...');      // flagged
logger.info('db postgres://admin:hunter2@db.internal/app');        // flagged

logger.info('password reset requested');                           // fine: ordinary words
logger.info('use postgres://user:pass@localhost/db in dev');       // fine: placeholder
```

A secret that reached a log message is already in your source history, so rotate it as well as removing it.

**Configure it**: `{ "rules": { "no-secret-literal": "off" } }` to disable it.

### `no-pii-value`

An email address, US Social Security Number or UK National Insurance number is inside a log string. SSNs and NINOs must pass real format checks, so lookalike numbers are ignored.

```ts
logger.info('sent mail to jane.doe@acme.io');    // flagged
logger.info('ssn 123-45-6789');                  // flagged
logger.info('nino AB 12 34 56 C');               // flagged

logger.info('installing @scope/package');        // fine
logger.info('mail owner@example.com failed');    // fine: reserved example domain
logger.info('write to support@acme.io');        // fine: role mailbox (noreply, help, support, info...)
```

**Configure it**: make it block the build with `{ "rules": { "no-pii-value": "error" } }`.

### Suppress a line

When a line is safe, say so and say why. The reason is required.

```ts
// leaklint-disable-next-line no-sensitive-key -- value is hashed upstream
logger.info({ email: hashedEmail });

// leaklint-disable-next-line
logger.info({ email: hashedEmail });   // flagged: suppression-needs-reason
```

Leave out the rule id to silence every rule on that line. Only `//` comments on the line above are supported. For pino, a key listed in `pino({ redact: [...] })` in the same file is already treated as safe.

## Configuration

Everything is optional. Put a `leaklint.config.json` next to your `package.json` (or point to another file with `--config`).

**Every option, with its default value where it has one:**

```json
{
  "rules": {
    "no-sensitive-key": "error",
    "no-whole-object": "error",
    "no-secret-literal": "error",
    "no-pii-value": "warn",
    "suppression-needs-reason": "error"
  },
  "keys": { "groups": ["credentials", "pii", "financial"], "add": [], "allow": [] },
  "sinks": [],
  "safeCalls": ["mask", "redact", "hash", "sanitize", "sanitise", "scrub", "anonymize", "anonymise", "obfuscate", "encrypt"],
  "ignore": [
    "**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/.git/**",
    "**/*.d.ts", "**/*.min.js", "**/*.test.*", "**/*.spec.*",
    "**/__tests__/**", "**/__mocks__/**", "**/__fixtures__/**",
    "**/test/**", "**/tests/**", "**/spec/**", "**/e2e/**", "**/playwright/**", "**/cypress/**"
  ]
}
```

`baseline` is optional and has no default: set it to a file path to hide the findings recorded there (see [adopting it on an existing codebase](#adopting-it-on-an-existing-codebase)). A rule is `"error"` (fails the build), `"warn"` (reported, fails only with `--max-warnings`) or `"off"`.

### Recipes

**Only fail on the serious stuff.** Personal-data findings stay as warnings, which do not fail the build:

```json
{ "rules": { "no-pii-value": "warn" } }
```

**Fail on everything, including warnings:**

```bash
npx @amittksharma/leaklint src --max-warnings 0
```

**Add your own sensitive names:**

```json
{ "keys": { "add": ["customerRef", "taxId", "/^internal_.*_secret$/i"] } }
```

**Also check names that are sensitive in your code** (for example mail or webhook payloads, or login sessions):

```json
{ "keys": { "add": ["payload", "sessionId"] } }
```

**Stop flagging a name that is safe in your code:**

```json
{ "keys": { "allow": ["token", "passwordHint"] } }
```

**Check your own logging helper:**

```json
{ "sinks": ["audit.record", "metrics.*", "/^trackEvent$/"] }
```

**Trust your own masking function:**

```json
{ "safeCalls": ["mask", "redact", "toSafeUser", "/^scrub/i"] }
```

**Skip generated code or fixtures.** `ignore` replaces the default list, so repeat the defaults you still want:

```json
{ "ignore": ["**/node_modules/**", "**/dist/**", "**/*.test.*", "**/generated/**", "**/fixtures/**"] }
```

**No personal-data checks at all:**

```json
{ "keys": { "groups": ["credentials", "financial"] }, "rules": { "no-pii-value": "off" } }
```

### Teach it your code

- `sinks`: logging helpers leaklint can't recognise on its own. Plain entries are call paths (`audit.record`, `metrics.*` where `*` is any method), or use `/regex/flags`.
- `safeCalls`: functions whose result is safe to log. Matched case-insensitively by name prefix, or `/regex/flags`.
- `ignore`: globs, relative to where you run the command. A pattern matches from that folder, so write `**/*.test.ts` (not `*.test.ts`) to match at any depth.

Unknown options, bad severities and invalid `/regex/` entries are rejected with a clear message and exit code `2`.

## Add it to your pipeline

### GitHub Actions

Block pull requests and show findings in the Security tab:

```yaml
- run: npx @amittksharma/leaklint src --format sarif --output leaklint.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: leaklint.sarif }
- run: npx @amittksharma/leaklint src        # fail the job on findings
```

Or just the gate:

```yaml
- run: npx @amittksharma/leaklint src
```

### Azure DevOps

```yaml
- script: npx @amittksharma/leaklint src --format junit --output leaklint.xml
- task: PublishTestResults@2
  condition: always()
  inputs: { testResultsFiles: leaklint.xml }
```

### GitLab CI

```yaml
leaklint:
  image: node:22
  script: npx @amittksharma/leaklint src
```

### A report people can read

```bash
npx @amittksharma/leaklint src --format html --output leaklint.html
```

Upload `leaklint.html` as a build artifact. Open it in a browser, and click **errors**, **warnings** or **skipped** at the top to filter.

### Before every commit (husky)

```bash
# .husky/pre-commit
npx @amittksharma/leaklint src
```

### Monorepos (Turborepo, Nx, Lerna, workspaces)

leaklint scans files, so it works with any layout.

One run from the repo root:

```bash
npx @amittksharma/leaklint apps packages
```

Or one task per package so your task runner can cache and parallelise it:

```json
{ "scripts": { "lint:leaks": "leaklint src" } }
```

```bash
turbo run lint:leaks          # or: nx run-many -t lint:leaks / lerna run lint:leaks
```

Give a package its own rules with `--config`, or share one: `leaklint src --config ../../leaklint.config.json`. For GitHub code scanning, prefer one run from the repo root so paths match the repository.

## Adopting it on an existing codebase

You do not have to fix every old finding before turning the gate on. Record them once, then fail only on new ones.

**1. Record what is there today:**

```text
$ npx @amittksharma/leaklint src --write-baseline
Baseline written to leaklint-baseline.json with 2 known finding(s). Run with --baseline leaklint-baseline.json (or set "baseline" in the config) to report only new ones.
```

Commit `leaklint-baseline.json`. It holds a short hash for each known finding, never your code. The path is relative to the folder you run `leaklint` from.

**2. Run with the baseline.** Known findings are hidden, new ones fail the build:

```text
$ npx @amittksharma/leaklint src --baseline leaklint-baseline.json
0 errors, 0 warnings; 2 files in the repo: 1 read, ... ; 2 known findings hidden by the baseline
```

A week later someone adds a leak:

```text
$ npx @amittksharma/leaklint src --baseline leaklint-baseline.json
src/billing.ts:1:15  error  no-sensitive-key  The credential field "apiKey" is written to the log.
1 error, 0 warnings; 3 files in the repo: ... ; 2 known findings hidden by the baseline
```

To skip typing the flag, set it once in `leaklint.config.json`, and then plain `npx @amittksharma/leaklint src` uses it:

```json
{ "baseline": "leaklint-baseline.json" }
```

A known finding stays known when code above it moves. A second copy of the same leak counts as new. Fixed a few? Run `--write-baseline` again to shrink the file.

## Check only what a pull request changed

On a feature branch, scan just the files you touched (committed, staged, modified or new) since the branch left `main`:

```text
$ npx @amittksharma/leaklint --changed-only
src/billing.ts:1:15  error  no-sensitive-key  The credential field "apiKey" is written to the log.
1 error, 0 warnings; 3 files in the repo: 1 read, ... , 1 unchanged since the base branch
```

The base branch is found automatically (`origin/main`, `origin/master`, `main`, `master`). Choose it yourself with `--base`:

```bash
npx @amittksharma/leaklint --changed-only --base origin/develop
```

It combines with a baseline: `npx @amittksharma/leaklint --changed-only --baseline leaklint-baseline.json`.

In GitHub Actions the checkout needs history to find the branch point:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- run: npx @amittksharma/leaklint --changed-only --base origin/${{ github.base_ref }}
```

`--changed-only` needs a git repository, and cannot be combined with `--write-baseline` (a baseline must come from a full scan).

## Rolling it out step by step

1. Run `npx @amittksharma/leaklint src` once and read the findings. Fix the real leaks. For each finding that is safe, pick the smallest tool:

   | The finding is... | Do this |
   |---|---|
   | A real leak | Remove the field, or log a masked value |
   | A safe name that looks sensitive | Add it to `keys.allow` |
   | One safe line | Suppress it with a reason |
   | A rule that does not fit your setup | Set it to `"warn"` |
   | Too many old findings to fix now | Record them in a [baseline](#adopting-it-on-an-existing-codebase) |

2. Gate the build on errors only: `leaklint src`. Warnings are reported but do not fail it.
3. Once the warnings are clean, tighten: `leaklint src --max-warnings 0`.

## Reports

| Format | Use it for |
|---|---|
| `text` (default) | Reading in the terminal |
| `html` | A shareable page with filters |
| `sarif` | GitHub code scanning |
| `junit` | Azure DevOps, Jenkins, GitLab test reports |
| `json` | Your own tooling |

All formats carry the same information: what was found (file, line, column, rule, severity, message and fix), which files could not be scanned and why, how many known findings the baseline hid, and a count of every file in the repository.

That count adds up, so you can see nothing was missed:

```text
3835 files in the repo: 2077 read, 0 skipped, 464 ignored, 909 unsupported format, 385 outside the scanned paths
```

| Count | Meaning |
|---|---|
| `read` | JS/TS files that were scanned |
| `skipped` | JS/TS files that could not be scanned: over 10 MB, or unreadable (listed one by one) |
| `ignored` | Matched an `ignore` glob |
| `unsupported format` | Not JS/TS (`.md`, `.json`, `.png`...) |
| `outside the scanned paths` | In the repo, but not under the paths you passed |
| `unchanged since the base branch` | Skipped by `--changed-only` (shown only then) |

In a git repo, files in `.gitignore` are left out of the count and are never scanned.

## Command line

```text
leaklint [paths...] [options]        paths default to "."
```

| Option | Default | What it does |
|---|---|---|
| `--config <file>` | `leaklint.config.json` | Config file to use |
| `--format <name>` | `text` | `text`, `html`, `sarif`, `junit` or `json` |
| `--output <file>` | stdout | Write the report to a file |
| `--max-warnings <n>` | no limit | Fail when there are more than `n` warnings (`0` fails on any) |
| `--baseline <file>` | config `baseline` | Hide findings recorded in this baseline file |
| `--write-baseline` | | Record the current findings in the baseline file and exit `0` |
| `--changed-only` | | Scan only files changed since the base branch |
| `--base <ref>` | auto | Base branch for `--changed-only` |

| Exit code | Meaning |
|---|---|
| `0` | Clean |
| `1` | Findings: errors, or warnings above `--max-warnings` |
| `2` | Bad option, config or path |

Skipped files do not change the exit code.

## Good to know

leaklint reads names and code shapes. It does not run your code or know your types, so treat it as a fast first gate rather than a proof:

- It works file by file. A value logged through a wrapper it does not know is missed until you list the wrapper in `sinks`.
- Aliased or destructured loggers (`const { info } = logger`), dynamic keys and values built elsewhere are not followed.
- In free text it recognises emails, SSNs, NINOs and credential-shaped strings. Other personal data (dates of birth, phone numbers, names, addresses) is caught only under a sensitive name such as `dob` or `phone`.
- A masking function is trusted by its name.
- A name can look sensitive and not be (a DI `token`, a CSS `token`). Add it to `keys.allow` or suppress that line with a reason.
- Pair it with runtime redaction (pino `redact`) and a deeper scanner such as CodeQL or Semgrep. It stops the bad line being written; they catch what it cannot see.

## License

MIT
