import ts from 'typescript';
import { resolveBinding, unwrap } from './syntax.js';
import { CONSTANT_NAME } from './vocabulary.js';

type HttpEvidence = {
  /** Sibling parameters that make the function a request handler. */
  siblings: string[];
  /** A parameter type that names the object. */
  type: RegExp;
};

/**
 * Names that are HTTP objects only with evidence, because they are just as often something else:
 * `res`/`response` (a query or workflow result), `request` (a module specifier, a payload), `ctx` (any context).
 */
const HTTP_EVIDENCE: Record<string, HttpEvidence> = {
  res: { siblings: ['req', 'request', 'ctx', 'next'], type: /Response|Reply|ServerResponse/ },
  response: { siblings: ['req', 'request', 'ctx', 'next'], type: /Response|Reply|ServerResponse/ },
  request: { siblings: ['res', 'response', 'reply', 'next', 'ctx'], type: /Request|IncomingMessage/ },
  ctx: { siblings: ['next'], type: /Koa|RouterContext|ParameterizedContext/ },
};

const HTTP_CLIENT = /\b(?:axios|fetch|got|ky|superagent|needle|request|http|https|undici|ofetch|supertest|\$fetch)\b/;
const RESPONSE_NAMES = new Set(['res', 'response']);

const calleeText = (expression: ts.Expression | undefined): string => {
  const call = expression && unwrap(expression);
  return call && ts.isCallExpression(call) ? call.expression.getText() : '';
};

/**
 * Whether `id` is an HTTP request, response or context. Names outside HTTP_EVIDENCE always are. The others need
 * a handler's parameter list, a parameter type, or (for responses) to be the result of an HTTP client call.
 */
export function isHttpObject(id: ts.Identifier): boolean {
  const evidence = HTTP_EVIDENCE[id.text];
  if (!evidence) return true;

  const binding = resolveBinding(id);
  if (!binding) return false;

  if (binding.kind === 'variable') {
    return RESPONSE_NAMES.has(id.text) && HTTP_CLIENT.test(calleeText(binding.declaration.initializer));
  }

  const { fn, parameter } = binding;
  if (evidence.type.test(parameter.type?.getText() ?? '')) return true;
  if (fn.parameters.some((p) => ts.isIdentifier(p.name) && evidence.siblings.includes(p.name.text))) return true;

  const call = fn.parent;
  return (
    RESPONSE_NAMES.has(id.text) &&
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    HTTP_CLIENT.test(call.expression.expression.getText())
  );
}

/** `handleLLMNewToken(token)`, `onToken: (token) => ...`: the owner of a callback that receives streamed text. */
const STREAM_CALLBACK = /new_?token|on_?token|on_?chunk/i;

/** A `token` that is a streamed text chunk (an LLM callback or a `for await` loop variable), not a credential. */
export function isStreamedToken(id: ts.Identifier): boolean {
  const binding = resolveBinding(id);
  if (!binding) return false;
  if (binding.kind === 'variable') return binding.loop?.awaitModifier !== undefined;

  const { fn } = binding;
  const owner = ts.isMethodDeclaration(fn) ? fn.name : ts.isPropertyAssignment(fn.parent) ? fn.parent.name : undefined;
  return owner !== undefined && STREAM_CALLBACK.test(owner.getText());
}

/** `const FORBIDDEN_TOKEN = 'pull_request_target'`: an ALL_CAPS constant holding a plain string is a name, not a secret. */
export function isConstantLiteral(id: ts.Identifier): boolean {
  if (!CONSTANT_NAME.test(id.text)) return false;
  const binding = resolveBinding(id);
  if (binding?.kind !== 'variable') return false;
  const { declaration } = binding;
  return (
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0 &&
    declaration.initializer !== undefined &&
    ts.isStringLiteralLike(declaration.initializer)
  );
}
