import type { LiteralMatch } from './literals.js';
import type { KeyGroup } from './types.js';

/** What a finding says: one sentence for the problem, one for the fix with an example. */
export type Advice = { message: string; fix: string };

const GROUP_LABELS: Record<KeyGroup, string> = {
  credentials: 'credential',
  pii: 'personal data',
  financial: 'financial',
  custom: 'sensitive',
};

const SAFE_FIELDS: Record<string, string> = {
  req: 'logger.info({ method: req.method, url: req.url })',
  request: 'logger.info({ method: request.method, url: request.url })',
  res: 'logger.info({ status: res.statusCode })',
  response: 'logger.info({ status: response.status })',
  headers: 'logger.info({ host: headers.host })',
  'req.headers': 'logger.info({ host: req.headers.host })',
  'request.headers': 'logger.info({ host: request.headers.host })',
  'req.body': 'logger.info({ id: req.body.id })',
  'request.body': 'logger.info({ id: request.body.id })',
  'process.env': 'logger.info({ nodeEnv: process.env.NODE_ENV })',
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function sensitiveKey(name: string, group: KeyGroup): Advice {
  const key = IDENTIFIER.test(name) ? name : `'${name}'`;
  return {
    message: `The ${GROUP_LABELS[group]} field "${name}" is written to the log.`,
    fix: `Remove it from the log call, or log a masked value: logger.info({ ${key}: mask(value) }). If "${name}" is safe to log in your code, add it to "keys.allow" in leaklint.config.json.`,
  };
}

export function wholeObject(name: string): Advice {
  return {
    message: `\`${name}\` is logged whole, so every secret inside it (passwords, tokens, cookies) ends up in the log.`,
    fix: `Log only the fields you need: ${SAFE_FIELDS[name] ?? `logger.info({ id: ${name}.id })`}.`,
  };
}

const LITERAL_FIXES: Record<LiteralMatch['rule'], string> = {
  'no-secret-literal':
    "Delete it from the message and say what happened instead: logger.info('connected to the database'). Then rotate this secret, because it is already in your source history.",
  'no-pii-value': "Log an internal id instead of the value: logger.info('sent mail to user ' + user.id).",
};

export function literal({ rule, article, kind }: LiteralMatch): Advice {
  return {
    message: `${article === 'an' ? 'An' : 'A'} ${kind} is written in a log message.`,
    fix: LITERAL_FIXES[rule],
  };
}

export const missingReason = (): Advice => ({
  message: 'This leaklint-disable comment has no reason, so nobody can tell why the line is safe.',
  fix: 'Add the reason after "--": // leaklint-disable-next-line no-sensitive-key -- value is hashed upstream',
});
