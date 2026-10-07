import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishNpm } from '../scripts/publish-npm.mjs';

const pack = { name: 'market-fiyati-mcp', version: '1.0.2', integrity: 'sha512-tested', filename: 'tested.tgz' };
const released = {
  versions: { '1.0.2': { version: '1.0.2', dist: { integrity: pack.integrity } } },
  'dist-tags': { latest: pack.version }
};
const stale = { ...released, 'dist-tags': { latest: '1.0.1' } };

function run(responses, status = 200) {
  const calls = [];
  const waits = [];
  return {
    calls,
    waits,
    result: publishNpm(pack, {
      fetch: async () => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (response instanceof Response) return response;
        return Response.json(response, { status });
      },
      publish: (filename) => calls.push(filename),
      wait: async (ms) => waits.push(ms)
    })
  };
}

const brokenBody = (error) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error);
      }
    })
  );

test('new npm version publishes the tested archive and waits for matching integrity and latest', async () => {
  const responses = [{}, {}, stale, released];
  const { result, calls, waits } = run(responses);
  await result;
  assert.deepEqual(calls, ['tested.tgz']);
  assert.equal(responses.length, 0);
  assert.deepEqual(waits, [10000, 10000]);
});

test('an existing matching version is verified without publishing again', async () => {
  const current = run([released]);
  await current.result;
  assert.deepEqual(current.calls, []);
  const newerLatest = run([{ ...released, 'dist-tags': { latest: '1.0.3' } }]);
  await newerLatest.result;
  assert.deepEqual(newerLatest.calls, []);
  const responses = [stale, stale, released];
  const lagging = run(responses);
  await lagging.result;
  assert.deepEqual(lagging.calls, []);
  assert.equal(responses.length, 0);
});

test('transient registry failures after publication retry with the fixed wait and never republish', async () => {
  for (const transient of [
    Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }),
    Response.json({}, { status: 502 }),
    Response.json({}, { status: 503 }),
    Response.json({}, { status: 504 }),
    new TypeError('fetch failed'),
    new DOMException('request timeout', 'TimeoutError'),
    brokenBody(new TypeError('terminated')),
    brokenBody(new DOMException('body timeout', 'TimeoutError')),
    brokenBody(new DOMException('body aborted', 'AbortError'))
  ]) {
    const responses = [{}, transient, released];
    const { result, calls, waits } = run(responses);
    await result;
    assert.deepEqual(calls, ['tested.tgz']);
    assert.equal(responses.length, 0);
    assert.deepEqual(waits, [10000], 'Retry-After is not honoured; the wait is fixed');
  }
});

test('permanent errors and mismatching evidence after publication fail without further reads', async () => {
  for (const [response, error] of [
    [Response.json({}, { status: 401 }), /401/],
    [Response.json({}, { status: 403 }), /403/],
    [new Response('not json'), /JSON|Unexpected/],
    [{ versions: { '1.0.2': { version: '1.0.2', dist: { integrity: 'wrong' } } } }, /integrity/]
  ]) {
    const responses = [{}, response, released];
    const { result, calls } = run(responses);
    await assert.rejects(result, error);
    assert.equal(responses.length, 1);
    assert.equal(calls.length, 1);
  }
});

test('verification stops after 18 reads with a rerun hint and never republishes', async () => {
  for (const pending of [() => ({}), () => stale, () => Response.json({}, { status: 503 })]) {
    const responses = [{}, ...Array.from({ length: 19 }, pending)];
    const { result, calls, waits } = run(responses);
    await assert.rejects(result, /rerun/);
    assert.deepEqual(calls, ['tested.tgz']);
    assert.equal(responses.length, 1, 'exactly 18 verification reads');
    assert.equal(waits.length, 17);
    assert.ok(waits.every((ms) => ms === 10000));
  }
  const responses = [{}, ...Array(17).fill({}), released];
  const { result } = run(responses);
  await result;
  assert.equal(responses.length, 0, 'the 18th read can still succeed');
});

test('pre-publication failures and used versions prevent publication', async () => {
  for (const [response, status, error] of [
    [{ versions: { '1.0.2': { version: '1.0.2', dist: { integrity: 'different' } } } }, 200, /integrity/],
    [{ time: { unpublished: { versions: ['1.0.2'] } } }, 404, /unpublished/],
    [{ error: 'temporary' }, 503, /503/],
    [new Error('network unavailable'), 200, /network unavailable/],
    [new TypeError('fetch failed'), 200, /fetch failed/]
  ]) {
    const { result, calls } = run([response], status);
    await assert.rejects(result, error);
    assert.deepEqual(calls, []);
  }
});

test('a removed older version does not block a new version', async () => {
  const { result, calls } = run([{ time: { unpublished: { versions: ['1.0.0'] } } }, released]);
  await result;
  assert.deepEqual(calls, ['tested.tgz']);
});

test('a new version older than npm latest is refused', async () => {
  const { result, calls } = run([{ 'dist-tags': { latest: '1.0.3' } }, released]);
  await assert.rejects(result, /newer than npm latest/);
  assert.deepEqual(calls, []);
});
