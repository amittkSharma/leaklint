import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { findSinks } from '../src/sinks.js';

const sinks = (code: string, cfg = DEFAULT_CONFIG) =>
  findSinks(ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true), cfg).map((c) => c.getText().split('(')[0]);

test('console and process streams', () => {
  assert.deepEqual(sinks('console.log(a); console.error(a); process.stdout.write(a); process.stderr.write(a);'), [
    'console.log',
    'console.error',
    'process.stdout.write',
    'process.stderr.write',
  ]);
});

test('pino: factory variable and child', () => {
  assert.deepEqual(sinks('const base = pino(); base.info({a:1}); const c = base.child({x:1}); c.warn("x");'), [
    'base.info',
    'base.child',
    'c.warn',
  ]);
});

test('winston/bunyan variables and logger-by-name receivers', () => {
  assert.deepEqual(
    sinks(
      'const w = winston.createLogger({}); w.error("x"); this.logger.info("y"); req.log.debug("z"); fastify.log.info("q"); const l = new Logger("ctx"); l.log("m");',
    ),
    ['w.error', 'this.logger.info', 'req.log.debug', 'fastify.log.info', 'l.log'],
  );
});

test('lookalikes, strings and comments are not sinks', () => {
  assert.deepEqual(
    sinks(
      'Math.log(1); form.error(email); catalog.info(x); blog.log(x); const s = "logger.info(password)"; // logger.info(password)',
    ),
    [],
  );
});

test('custom sinks from config', () => {
  const cfg = { ...DEFAULT_CONFIG, sinks: ['audit.record', 'metrics.*'] };
  assert.deepEqual(sinks('audit.record(x); metrics.count(x); other.record(x);', cfg), [
    'audit.record',
    'metrics.count',
  ]);
});
