import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishNpm } from '../scripts/publish-npm.mjs';

const pack = { name: 'market-fiyati-mcp', version: '1.0.2', integrity: 'sha512-tested', filename: 'tested.tgz' };
const released = { versions: { '1.0.2': { version: '1.0.2', dist: { integrity: pack.integrity } } } };

function run(responses, status = 200) {
  const calls = [];
  return {
    calls,
    result: publishNpm(pack, {
      fetch: async () => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return Response.json(response, { status });
      },
      publish: (filename) => calls.push(filename),
      wait: async () => {}
    })
  };
}

test('new npm version publishes the tested archive and waits for matching registry integrity', async () => {
  const { result, calls } = run([{}, {}, released]);
  await result;
  assert.deepEqual(calls, ['tested.tgz']);
});

test('delayed registry visibility succeeds after sixty polling waits without republishing', async () => {
  const { result, calls } = run([...Array(61).fill({}), released]);
  await result;
  assert.deepEqual(calls, ['tested.tgz']);
});

test('a matching existing npm version is verified without publishing again', async () => {
  const { result, calls } = run([released]);
  await result;
  assert.deepEqual(calls, []);
});

test('used versions, registry errors and missing proof prevent publication or success', async () => {
  for (const [responses, status, error, publishes] of [
    [{ versions: { '1.0.2': { version: '1.0.2', dist: { integrity: 'different' } } } }, 200, /integrity/, 0],
    [{ time: { unpublished: { versions: ['1.0.2'] } } }, 404, /unpublished/, 0],
    [{ error: 'temporary' }, 503, /503/, 0],
    [new Error('network unavailable'), 200, /network unavailable/, 0]
  ]) {
    const { result, calls } = run([responses], status);
    await assert.rejects(result, error);
    assert.equal(calls.length, publishes);
  }
  const { result, calls } = run([...Array(62).fill({}), released]);
  await assert.rejects(result, /not visible/);
  assert.equal(calls.length, 1);
});

test('a removed older version does not block a new version', async () => {
  const { result, calls } = run([{ time: { unpublished: { versions: ['1.0.0'] } } }, released]);
  await result;
  assert.equal(calls.length, 1);
});

test('out-of-order releases cannot downgrade latest but existing matching releases can be verified', async () => {
  const { result, calls } = run([{ 'dist-tags': { latest: '1.0.3' } }, released]);
  await assert.rejects(result, /newer than npm latest/);
  assert.deepEqual(calls, []);
  const existing = run([{ ...released, 'dist-tags': { latest: '1.0.3' } }]);
  await existing.result;
  assert.deepEqual(existing.calls, []);
});
