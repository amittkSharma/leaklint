import ts from 'typescript';
import { isConstantLiteral, isHttpObject, isStreamedToken } from './evidence.js';
import { type KeyMatcher, normalize } from './keys.js';
import { findLiteral } from './literals.js';
import * as messages from './messages.js';
import { toRegExp } from './regex-entry.js';
import { calleeName, isHarmlessValue, isWrapper, propertyKeyName } from './syntax.js';
import type { Config, KeyGroup, RawFinding, RuleId } from './types.js';

export type Ctx = {
  sf: ts.SourceFile;
  file: string;
  config: Config;
  matchKey: KeyMatcher;
  /** Normalised key names already redacted by `pino({ redact })` in this file. */
  redacted: Set<string>;
};

const WHOLE_OBJECTS = new Set([
  'req',
  'request',
  'res',
  'response',
  'ctx',
  'headers',
  'session',
  'process.env',
  'req.headers',
  'request.headers',
  'req.body',
  'request.body',
  'req.cookies',
  'request.cookies',
  'req.session',
  'request.session',
  'ctx.request',
  'ctx.headers',
]);

/** `{ req, res, err }`: the keys pino, bunyan and fastify attach serializers to. console has none, so it is still flagged. */
const SERIALIZER_SLOTS = new Set(['req', 'res']);

/** Calls whose arguments are written out as they are, such as `JSON.stringify(req.body)`. */
const SERIALIZING_CALLS = new Set(['stringify', 'inspect', 'format']);

const CONSOLE_CALL = /^(?:console|process\.std(?:out|err))\b/;

/** Operators through which a value flows into the result, so a sensitive name on that side is still written out. */
const FLOWS_LEFT = new Set([ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken]);
const FLOWS_RIGHT = new Set([...FLOWS_LEFT, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.CommaToken]);

const isSafeName = (name: string, safeCalls: string[]): boolean =>
  safeCalls.some((entry) => {
    const pattern = toRegExp(entry);
    return pattern ? pattern.test(name) : name.toLowerCase().startsWith(entry.toLowerCase());
  });

/**
 * Finds what a logging call writes out. Values are visited as `terminal` when the value itself ends up in the
 * output, and not when it is only read to compute something (`user.email.length`, `x === y`). Key and
 * whole-object checks fire on terminal values only; string checks fire everywhere.
 */
export function checkSink(call: ts.CallExpression, ctx: Ctx): RawFinding[] {
  const findings: RawFinding[] = [];
  const isConsole = CONSOLE_CALL.test(call.expression.getText(ctx.sf));
  const isSafe = (name: string) => isSafeName(name, ctx.config.safeCalls);

  const report = (node: ts.Node, rule: RuleId, { message, fix }: messages.Advice, group?: KeyGroup): void => {
    const { line, character } = ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf));
    findings.push({ file: ctx.file, line: line + 1, column: character + 1, rule, message, fix, group });
  };

  /** Reports and returns true when `name` is a sensitive key. */
  const checkKey = (node: ts.Node, name: string, options: { bare?: boolean; owner?: string } = {}): boolean => {
    const group = ctx.matchKey(name, options);
    if (!group || ctx.redacted.has(normalize(name))) return false;
    report(node, 'no-sensitive-key', messages.sensitiveKey(name, group), group);
    return true;
  };

  const checkWholeObject = (node: ts.Node, name: string): void =>
    report(node, 'no-whole-object', messages.wholeObject(name));

  const checkText = (node: ts.Node, text: string): void => {
    const match = findLiteral(text);
    if (match) report(node, match.rule, messages.literal(match));
  };

  /** `{ name }` or `name` as a value: a whole object, or a sensitive variable. */
  const checkReference = (id: ts.Identifier): void => {
    if (WHOLE_OBJECTS.has(id.text)) {
      if (isHttpObject(id)) checkWholeObject(id, id.text);
    } else if (!(id.text === 'token' && isStreamedToken(id)) && !isConstantLiteral(id)) {
      checkKey(id, id.text, { bare: true });
    }
  };

  const visitTemplate = (template: ts.TemplateExpression): void => {
    checkText(template.head, template.head.text);
    for (const span of template.templateSpans) {
      visit(span.expression, true);
      checkText(span.literal, span.literal.text);
    }
  };

  const visitProperty = (property: ts.ObjectLiteralElementLike): void => {
    if (ts.isShorthandPropertyAssignment(property)) {
      const { name } = property;
      if (isConsole || !SERIALIZER_SLOTS.has(name.text)) checkReference(name);
    } else if (ts.isPropertyAssignment(property)) {
      const name = propertyKeyName(property.name);
      const value = property.initializer;
      if (!isConsole && name && SERIALIZER_SLOTS.has(name) && ts.isIdentifier(value)) return;
      const isMasked = ts.isCallExpression(value) && isSafe(calleeName(value.expression) ?? '');
      if (name && !isHarmlessValue(value) && !isMasked && checkKey(property.name, name)) return;
      visit(value, true);
    } else if (ts.isSpreadAssignment(property)) {
      visit(property.expression, true);
    }
  };

  const visitPropertyAccess = (access: ts.PropertyAccessExpression, terminal: boolean): void => {
    if (terminal) {
      const path = access.getText(ctx.sf).replace(/\s+/g, '');
      if (WHOLE_OBJECTS.has(path)) return checkWholeObject(access, path);
      if (checkKey(access.name, access.name.text, { owner: calleeName(access.expression) })) return;
    }
    visit(access.expression, false);
  };

  const visitCall = (node: ts.CallExpression | ts.NewExpression): void => {
    const name = calleeName(node.expression) ?? '';
    if (isSafe(name)) return;
    if (ts.isPropertyAccessExpression(node.expression)) visit(node.expression.expression, false);
    for (const argument of node.arguments ?? []) visit(argument, SERIALIZING_CALLS.has(name));
  };

  function visit(node: ts.Node, terminal: boolean): void {
    if (isWrapper(node)) return visit(node.expression, terminal);
    if (ts.isStringLiteralLike(node)) return checkText(node, node.text);
    if (ts.isTemplateExpression(node)) return visitTemplate(node);
    if (ts.isIdentifier(node)) {
      if (terminal && node.text !== 'undefined') checkReference(node);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) return visitPropertyAccess(node, terminal);
    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (terminal && ts.isStringLiteralLike(key) && checkKey(key, key.text)) return;
      visit(node.expression, false);
      return visit(key, false);
    }
    if (ts.isObjectLiteralExpression(node)) {
      if (!terminal) return ts.forEachChild(node, (child) => visit(child, false));
      for (const property of node.properties) visitProperty(property);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) visit(element, terminal);
      return;
    }
    if (ts.isSpreadElement(node)) return visit(node.expression, terminal);
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      visit(node.left, terminal && FLOWS_LEFT.has(operator));
      return visit(node.right, terminal && FLOWS_RIGHT.has(operator));
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.condition, false);
      visit(node.whenTrue, terminal);
      return visit(node.whenFalse, terminal);
    }
    if (ts.isArrowFunction(node)) return visit(node.body, true); // what a callback returns is data
    if (ts.isReturnStatement(node)) return node.expression ? visit(node.expression, true) : undefined;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) return visitCall(node);
    ts.forEachChild(node, (child) => visit(child, false));
  }

  for (const argument of call.arguments) visit(argument, true);
  return findings;
}
