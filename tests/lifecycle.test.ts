import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { bindShutdown } from '../src/lifecycle.js';

test('overlapping EOF and process signals close once and remove only owned listeners', async () => {
  const input = new PassThrough(),
    signals = new EventEmitter();
  const unrelated = () => {};
  signals.on('SIGTERM', unrelated);
  let calls = 0,
    finish!: () => void;
  bindShutdown(
    {
      async close() {
        calls++;
        await new Promise<void>((r) => {
          finish = r;
        });
      }
    },
    input,
    signals
  );
  input.emit('end');
  signals.emit('SIGTERM');
  input.emit('close');
  signals.emit('SIGINT');
  await setImmediate();
  assert.equal(calls, 1);
  finish();
  await setImmediate();
  assert.equal(input.listenerCount('end'), 0);
  assert.equal(input.listenerCount('close'), 0);
  assert.deepEqual(signals.listeners('SIGTERM'), [unrelated]);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('shutdown failures reach the error reporter and cleanup still happens', async () => {
  const input = new PassThrough(),
    signals = new EventEmitter();
  let reported: unknown;
  const failure = new Error('private detail');
  bindShutdown(
    {
      async close() {
        throw failure;
      }
    },
    input,
    signals,
    (error) => {
      reported = error;
    }
  );
  signals.emit('SIGTERM');
  await setImmediate();
  assert.equal(reported, failure);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(input.listenerCount('end'), 0);
});

test('binding an already closed input starts shutdown', async () => {
  const input = new PassThrough();
  input.destroy();
  let calls = 0;
  bindShutdown(
    {
      async close() {
        calls++;
      }
    },
    input,
    new EventEmitter()
  );
  await setImmediate();
  assert.equal(calls, 1);
});

test('a shutdown that does not settle is reported and ends the process once', async () => {
  const input = new PassThrough(),
    signals = new EventEmitter();
  const reported: unknown[] = [];
  let exits = 0;
  bindShutdown({ close: () => new Promise<void>(() => {}) }, input, signals, (error) => reported.push(error), {
    timeoutMs: 5,
    onTimeout: () => {
      exits++;
    }
  });
  signals.emit('SIGTERM');
  input.emit('end');
  await delay(40);
  assert.equal(exits, 1);
  assert.equal(reported.length, 1);
  assert.match((reported[0] as Error).message, /did not finish within 5 ms/);
});

test('a settled shutdown cancels the timeout', async () => {
  const input = new PassThrough();
  let exits = 0;
  bindShutdown({ async close() {} }, input, new EventEmitter(), () => assert.fail('no error expected'), {
    timeoutMs: 5,
    onTimeout: () => {
      exits++;
    }
  });
  input.emit('end');
  await delay(40);
  assert.equal(exits, 0);
});
