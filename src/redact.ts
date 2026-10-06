import ts from 'typescript';
import { normalize } from './keys.js';
import { calleeName } from './syntax.js';

const stringValues = (expression: ts.Expression): string[] =>
  ts.isArrayLiteralExpression(expression) ? expression.elements.filter(ts.isStringLiteralLike).map((s) => s.text) : [];

const propertyNamed = (object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
  const property = object.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name,
  );
  return property?.initializer;
};

/** `pino({ redact: [...] })` or `pino({ redact: { paths: [...] } })` -> the redacted paths. */
function redactPaths(options: ts.Expression): string[] {
  if (!ts.isObjectLiteralExpression(options)) return [];
  const redact = propertyNamed(options, 'redact');
  if (!redact) return [];
  const paths = ts.isObjectLiteralExpression(redact) ? propertyNamed(redact, 'paths') : redact;
  return paths ? stringValues(paths) : [];
}

/** `req.headers["authorization"]` and `a.b.authorization` both end in `authorization`. */
const lastSegment = (path: string): string =>
  path
    .replace(/\[['"]?([^\]'"]+)['"]?\]$/, '.$1')
    .split('.')
    .pop() ?? '';

/**
 * Normalised last path segments of every `pino({ redact })` call in the file. Matching on the last segment only
 * is deliberately loose: a key redacted anywhere in the file is treated as redacted everywhere in it.
 */
export function pinoRedacted(sf: ts.SourceFile): Set<string> {
  const redacted = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 'pino' && node.arguments[0]) {
      for (const path of redactPaths(node.arguments[0])) {
        const segment = lastSegment(path);
        if (segment && segment !== '*') redacted.add(normalize(segment));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return redacted;
}
