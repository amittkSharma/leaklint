import ts from 'typescript';
import { toRegExp } from './regex-entry.js';
import { calleeName, unwrap } from './syntax.js';
import type { Config } from './types.js';

const LOG_METHODS = new Set([
  'log',
  'trace',
  'debug',
  'info',
  'warn',
  'warning',
  'error',
  'fatal',
  'verbose',
  'silly',
  'http',
  'notice',
  'critical',
  'child',
  'dir',
  'table',
]);

/** Receivers that are loggers by name: `console`, `logger`, `appLogger`, `authLog`, ... */
const LOGGER_NAME = /^(?:console|consola|log|logger|logging|[A-Za-z0-9_$]*(?:Logger|Log))$/;

/** Calls whose result is a logger, so a variable assigned from them is one too. */
const LOGGER_FACTORIES = new Set(['pino', 'createLogger', 'getLogger', 'Logger']);

const PROCESS_STREAM = /^process\.(stdout|stderr)$/;

/** `audit.record` or `metrics.*` (`*` is any method name), or a `/regex/flags` entry. */
const sinkPattern = (entry: string): RegExp =>
  toRegExp(entry) ?? new RegExp(`^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]*')}$`);

const isLoggerReceiver = (expression: ts.Expression, variables: ReadonlySet<string>): boolean => {
  const name = calleeName(expression);
  return name !== undefined && (LOGGER_NAME.test(name) || variables.has(name));
};

/** Variables assigned from a logger factory or from `<logger>.child()`. */
function findLoggerVariables(sf: ts.SourceFile): Set<string> {
  const variables = new Set<string>();

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isCallExpression(init) || ts.isNewExpression(init)) {
        const name = calleeName(init.expression);
        const isChild =
          ts.isCallExpression(init) &&
          ts.isPropertyAccessExpression(init.expression) &&
          name === 'child' &&
          isLoggerReceiver(init.expression.expression, variables);
        if ((name && LOGGER_FACTORIES.has(name)) || isChild) variables.add(node.name.text);
      }
    }
    ts.forEachChild(node, collect);
  };

  collect(sf);
  collect(sf); // a second pass resolves `.child()` chains declared before their parent
  return variables;
}

/** Every call in the file that writes to a log, including the configured `sinks`. */
export function findSinks(sf: ts.SourceFile, config: Config): ts.CallExpression[] {
  const custom = config.sinks.map(sinkPattern);
  const variables = findLoggerVariables(sf);

  const isSink = (call: ts.CallExpression): boolean => {
    const callee = call.expression;
    if (custom.some((pattern) => pattern.test(callee.getText(sf)))) return true;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const method = callee.name.text;
    if (method === 'write' && PROCESS_STREAM.test(callee.expression.getText(sf))) return true;
    return LOG_METHODS.has(method) && isLoggerReceiver(callee.expression, variables);
  };

  const sinks: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSink(node)) sinks.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sinks;
}
