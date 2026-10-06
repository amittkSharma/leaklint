import ts from 'typescript';
import { normalize } from './keys.js';
import { calleeName } from './sinks.js';

const strings = (e: ts.Expression): string[] =>
  ts.isArrayLiteralExpression(e) ? e.elements.filter(ts.isStringLiteralLike).map((s) => s.text) : [];

/** Normalised last path segments from `pino({ redact: [...] | { paths: [...] } })` calls in this file. */
export function pinoRedacted(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && calleeName(n.expression) === 'pino') {
      const opts = n.arguments[0];
      if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const p of opts.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || p.name.text !== 'redact') continue;
          const v = p.initializer;
          const paths = ts.isObjectLiteralExpression(v)
            ? v.properties.flatMap((q) => (ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && q.name.text === 'paths' ? strings(q.initializer) : []))
            : strings(v);
          for (const path of paths) {
            const last = path.replace(/\[['"]?([^\]'"]+)['"]?\]$/, '.$1').split('.').pop() ?? '';
            if (last && last !== '*') out.add(normalize(last));
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
