import ts from 'typescript';
import { normalize } from './keys.js';
import { calleeName } from './sinks.js';
import type { Config, Group, RawFinding, RuleId } from './types.js';

export type Ctx = {
  sf: ts.SourceFile;
  file: string;
  config: Config;
  isSensitive: (name: string) => Group | 'custom' | undefined;
  /** Normalised key names already redacted by pino({ redact }) in this file. */
  redacted: Set<string>;
};

const WHOLE = new Set(['req', 'request', 'res', 'response', 'ctx', 'headers', 'session', 'process.env', 'req.headers', 'request.headers', 'req.body', 'request.body', 'req.cookies', 'request.cookies', 'req.session', 'request.session', 'ctx.request', 'ctx.headers']);
const SERIALIZERS = new Set(['stringify', 'inspect', 'format']);
const SECRET_PATTERNS: [string, RegExp][] = [
  ['JWT', /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer token', /\bBearer\s+[\w.~+/-]{20,}/],
  ['GitHub token', /\bgh[pousr]_\w{36,}/],
  ['credentials in URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i],
];
const PII_PATTERNS: [string, RegExp][] = [
  ['email address', /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/],
  ['US Social Security Number', /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/],
  // UK NINO: first letter not D F I Q U V, second also not O, and not one of the reserved prefixes.
  ['UK National Insurance Number', /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/],
];

const isLiteralValue = (e: ts.Expression) =>
  ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined');

const propKeyName = (n: ts.PropertyName): string | undefined =>
  ts.isIdentifier(n) || ts.isStringLiteralLike(n) || ts.isNumericLiteral(n) ? n.text : ts.isComputedPropertyName(n) && ts.isStringLiteralLike(n.expression) ? n.expression.text : undefined;

const FLOWS_LEFT = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken]);
const FLOWS_RIGHT = new Set([...FLOWS_LEFT, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.CommaToken]);

/**
 * `terminal` = the value itself is what ends up in the output (not merely read to compute something).
 * Key and whole-object checks only fire on terminal values; literal checks fire everywhere.
 */
export function checkSink(call: ts.CallExpression, ctx: Ctx): RawFinding[] {
  const out: RawFinding[] = [];
  const add = (node: ts.Node, rule: RuleId, message: string, group?: Group | 'custom'): void => {
    const { line, character } = ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf));
    out.push({ file: ctx.file, line: line + 1, column: character + 1, rule, message, group });
  };
  const key = (node: ts.Node, name: string): boolean => {
    const group = ctx.isSensitive(name);
    if (!group || ctx.redacted.has(normalize(name))) return false;
    add(node, 'no-sensitive-key', `"${name}" (${group}) is written to a log`, group);
    return true;
  };
  const whole = (node: ts.Node, name: string): void =>
    add(node, 'no-whole-object', `\`${name}\` is logged whole; log selected fields instead`);
  const text = (node: ts.Node, s: string): void => {
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(s)) return add(node, 'no-secret-literal', `${kind} in log message`);
    for (const [kind, re] of PII_PATTERNS) if (re.test(s)) return add(node, 'no-pii-value', `${kind} in log message`);
  };

  const visit = (n: ts.Node, terminal: boolean): void => {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isAwaitExpression(n) || ts.isTypeAssertionExpression(n)) {
      return visit(n.expression, terminal);
    }
    if (ts.isStringLiteralLike(n)) return text(n, n.text);
    if (ts.isTemplateExpression(n)) {
      text(n.head, n.head.text);
      for (const s of n.templateSpans) {
        visit(s.expression, true);
        text(s.literal, s.literal.text);
      }
      return;
    }
    if (ts.isIdentifier(n)) {
      if (terminal && n.text !== 'undefined') {
        if (WHOLE.has(n.text)) whole(n, n.text);
        else key(n, n.text);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (terminal) {
        const full = n.getText(ctx.sf).replace(/\s+/g, '');
        if (WHOLE.has(full)) return whole(n, full);
        if (key(n.name, n.name.text)) return;
      }
      return visit(n.expression, false);
    }
    if (ts.isElementAccessExpression(n)) {
      const a = n.argumentExpression;
      if (terminal && ts.isStringLiteralLike(a) && key(a, a.text)) return;
      visit(n.expression, false);
      return visit(a, false);
    }
    if (ts.isObjectLiteralExpression(n)) {
      if (!terminal) return ts.forEachChild(n, (c) => visit(c, false));
      for (const p of n.properties) {
        if (ts.isShorthandPropertyAssignment(p)) {
          if (WHOLE.has(p.name.text)) whole(p.name, p.name.text);
          else key(p.name, p.name.text);
        } else if (ts.isPropertyAssignment(p)) {
          const name = propKeyName(p.name);
          if (name && !isLiteralValue(p.initializer) && key(p.name, name)) continue;
          visit(p.initializer, true);
        } else if (ts.isSpreadAssignment(p)) {
          visit(p.expression, true);
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(n)) return n.elements.forEach((e) => visit(e, terminal));
    if (ts.isSpreadElement(n)) return visit(n.expression, terminal);
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      visit(n.left, terminal && FLOWS_LEFT.has(k));
      return visit(n.right, terminal && FLOWS_RIGHT.has(k));
    }
    if (ts.isConditionalExpression(n)) {
      visit(n.condition, false);
      visit(n.whenTrue, terminal);
      return visit(n.whenFalse, terminal);
    }
    if (ts.isArrowFunction(n)) return visit(n.body, true); // what a callback returns is data
    if (ts.isReturnStatement(n)) return n.expression ? visit(n.expression, true) : undefined;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const name = calleeName(n.expression) ?? '';
      if (ctx.config.safeCalls.some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) return;
      if (ts.isPropertyAccessExpression(n.expression)) visit(n.expression.expression, false);
      for (const a of n.arguments ?? []) visit(a, SERIALIZERS.has(name));
      return;
    }
    ts.forEachChild(n, (c) => visit(c, false));
  };

  for (const a of call.arguments) visit(a, true);
  return out;
}
