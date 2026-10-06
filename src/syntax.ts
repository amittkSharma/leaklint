import ts from 'typescript';

type Wrapper =
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.NonNullExpression
  | ts.SatisfiesExpression
  | ts.AwaitExpression
  | ts.TypeAssertion;

/** Nodes that do not change the value they wrap. */
export const isWrapper = (node: ts.Node): node is Wrapper =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isAwaitExpression(node) ||
  ts.isTypeAssertionExpression(node);

export function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (isWrapper(current)) current = current.expression;
  return current;
}

/** `logger.info` -> `info`, `warn` -> `warn`. */
export const calleeName = (expression: ts.Expression): string | undefined =>
  ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : undefined;

export const propertyKeyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression) ? name.expression.text : undefined;
};

export type Binding =
  | { kind: 'parameter'; fn: ts.SignatureDeclaration; parameter: ts.ParameterDeclaration }
  | { kind: 'variable'; declaration: ts.VariableDeclaration; loop?: ts.ForOfStatement };

const declares = (declaration: ts.VariableDeclaration, name: string): boolean =>
  ts.isIdentifier(declaration.name)
    ? declaration.name.text === name
    : ts.isObjectBindingPattern(declaration.name) &&
      declaration.name.elements.some((element) => ts.isIdentifier(element.name) && element.name.text === name);

/** The nearest declaration of `id`: a function parameter, a `const`/`let` in an enclosing block, or a loop variable. */
export function resolveBinding(id: ts.Identifier): Binding | undefined {
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node)) {
      const parameter = node.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === id.text);
      if (parameter) return { kind: 'parameter', fn: node, parameter };
    } else if (ts.isBlock(node) || ts.isSourceFile(node)) {
      for (const statement of node.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        const declaration = statement.declarationList.declarations.find((d) => declares(d, id.text));
        if (declaration) return { kind: 'variable', declaration };
      }
    } else if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const declaration = node.initializer.declarations.find((d) => declares(d, id.text));
      if (declaration) return { kind: 'variable', declaration, loop: node };
    }
  }
  return undefined;
}

/** `!x`, `typeof x`, `a === b`, `x in y`, ... */
const COMPARISON_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
]);

const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

const isLiteral = (e: ts.Expression): boolean =>
  ts.isStringLiteralLike(e) ||
  ts.isNumericLiteral(e) ||
  e.kind === ts.SyntaxKind.TrueKeyword ||
  e.kind === ts.SyntaxKind.FalseKeyword ||
  e.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isIdentifier(e) && e.text === 'undefined');

const isCallTo = (e: ts.Expression, object: string | undefined, method: string): boolean =>
  ts.isCallExpression(e) &&
  (object === undefined
    ? ts.isIdentifier(e.expression) && e.expression.text === method
    : ts.isPropertyAccessExpression(e.expression) &&
      ts.isIdentifier(e.expression.expression) &&
      e.expression.expression.text === object &&
      e.expression.name.text === method);

/**
 * A value that cannot carry the data itself: a literal, or something derived from it that is not the data
 * (`!!email`, `Boolean(x)`, `a === b`, `x.length`, `Object.keys(x)`, `ok ? '***' : undefined`).
 */
export function isHarmlessValue(e: ts.Expression): boolean {
  if (isLiteral(e)) return true;
  if (ts.isParenthesizedExpression(e)) return isHarmlessValue(e.expression);
  if (ts.isConditionalExpression(e)) return isHarmlessValue(e.whenTrue) && isHarmlessValue(e.whenFalse);
  if (ts.isPrefixUnaryExpression(e)) return e.operator === ts.SyntaxKind.ExclamationToken;
  if (ts.isTypeOfExpression(e)) return true;
  if (ts.isBinaryExpression(e)) {
    const operator = e.operatorToken.kind;
    if (COMPARISON_OPERATORS.has(operator)) return true;
    return LOGICAL_OPERATORS.has(operator) && isHarmlessValue(e.left) && isHarmlessValue(e.right);
  }
  if (ts.isPropertyAccessExpression(e)) return e.name.text === 'length';
  return isCallTo(e, undefined, 'Boolean') || isCallTo(e, 'Object', 'keys');
}
