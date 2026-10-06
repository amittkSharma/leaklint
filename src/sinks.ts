import ts from 'typescript';
import type { Config } from './types.js';

const LEVELS = new Set(['log', 'trace', 'debug', 'info', 'warn', 'warning', 'error', 'fatal', 'verbose', 'silly', 'http', 'notice', 'critical', 'child', 'dir', 'table']);
const RECEIVER = /^(?:console|consola|log|logger|logging|[A-Za-z0-9_$]*(?:Logger|Log))$/;
const FACTORIES = new Set(['pino', 'createLogger', 'getLogger', 'Logger']);

export const calleeName = (e: ts.Expression): string | undefined =>
  ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined;

const globToRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*') + '$');

export function findSinks(sf: ts.SourceFile, config: Config): ts.CallExpression[] {
  const bound = new Set<string>(); // variables assigned from a logger factory or <logger>.child()
  const custom = config.sinks.map(globToRe);
  const isLoggerLike = (e: ts.Expression) => {
    const n = calleeName(e);
    return !!n && (RECEIVER.test(n) || bound.has(n));
  };

  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init: ts.Expression = n.initializer;
      while (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isCallExpression(init) || ts.isNewExpression(init)) {
        const name = calleeName(init.expression);
        const isChild = ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && name === 'child' && isLoggerLike(init.expression.expression);
        if ((name && FACTORIES.has(name)) || isChild) bound.add(n.name.text);
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  collect(sf); // second pass resolves .child() chains declared before their parent

  const isSink = (call: ts.CallExpression): boolean => {
    const callee = call.expression;
    if (custom.some((re) => re.test(callee.getText(sf)))) return true;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const method = callee.name.text;
    if (method === 'write' && /^process\.(stdout|stderr)$/.test(callee.expression.getText(sf))) return true;
    return LEVELS.has(method) && isLoggerLike(callee.expression);
  };

  const sinks: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && isSink(n)) sinks.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sinks;
}
