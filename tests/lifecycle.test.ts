import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
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
