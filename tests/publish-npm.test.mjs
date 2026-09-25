import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishNpm } from '../scripts/publish-npm.mjs';

const pack = { name: 'market-fiyati-mcp', version: '1.0.2', integrity: 'sha512-tested', filename: 'tested.tgz' };
const released = {
  versions: { '1.0.2': { version: '1.0.2', dist: { integrity: pack.integrity } } },
  'dist-tags': { latest: pack.version }
};

function run(responses, status = 200) {
  const calls = [];
  return {
    calls,
    result: publishNpm(pack, {
      fetch: async () => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (response instanceof Response) return response;
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

test('new and existing artifacts wait for latest without publishing twice', async () => {
  const stale = { ...released, 'dist-tags': { latest: '1.0.1' } };
  for (const initial of [{}, stale]) {
    const responses = [initial, stale, released];
    const { result, calls } = run(responses);
    await result;
    assert.equal(responses.length, 0);
    assert.equal(calls.length, initial === stale ? 0 : 1);
  }
  const { result, calls } = run(Array(62).fill(stale));
  await assert.rejects(result, /latest|channel/);
  assert.equal(calls.length, 0);
});

test('post-publication transient errors retry reads, never publication', async () => {
  for (const transient of [429, 502, 503, 504, new TypeError('fetch failed')]) {
    const response = transient instanceof Error ? transient : Response.json({}, { status: transient });
    const { result, calls } = run([{}, response, released]);
    await result;
    assert.deepEqual(calls, ['tested.tgz']);
  }
});

test('post-publication permanent errors and mismatching evidence fail immediately', async () => {
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

test('post-publication body disconnects and timeouts retry within the verification deadline', async () => {
  for (const error of [
    new TypeError('terminated'),
    new DOMException('body timeout', 'TimeoutError'),
    new DOMException('body aborted', 'AbortError')
  ]) {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(error);
        }
      })
    );
    const responses = [{}, broken, released];
    const { result, calls } = run(responses);
    await result;
    assert.equal(responses.length, 0);
    assert.deepEqual(calls, ['tested.tgz']);
  }
  let clock = 0;
  let reads = 0;
  await assert.rejects(
    publishNpm(pack, {
      now: () => clock,
      fetch: async () => {
        reads++;
        if (reads === 1) return Response.json({});
        return new Response(
          new ReadableStream({
            start(controller) {
              clock += 300000;
              controller.error(new TypeError('terminated'));
            }
          })
        );
      },
      publish: () => {},
      wait: async () => {
        throw new Error('must not wait after deadline');
      }
    }),
    /deadline/
  );
  assert.equal(reads, 2);
});

test('verification deadline includes requests and never polls before Retry-After', async () => {
  for (const header of ['8', new Date(18000).toUTCString()]) {
    let clock = 10000;
    let reads = 0;
    const waits = [];
    await publishNpm(pack, {
      now: () => clock,
      wallNow: () => clock,
      fetch: async () => {
        reads++;
        return reads === 1
          ? Response.json({})
          : reads === 2
            ? Response.json({}, { status: 429, headers: { 'Retry-After': header } })
            : Response.json(released);
      },
      publish: () => {},
      wait: async (ms) => {
        waits.push(ms);
        clock += ms;
      }
    });
    assert.deepEqual(waits, [8000]);
    assert.equal(reads, 3);
  }
  let clock = 0;
  let reads = 0;
  await assert.rejects(
    publishNpm(pack, {
      now: () => clock,
      fetch: async () => {
        reads++;
        if (reads > 1) clock += 300000;
        return Response.json({});
      },
      publish: () => {},
      wait: async () => {
        throw new Error('must not wait past deadline');
      }
    }),
    /visible|deadline/
  );
  assert.equal(reads, 2);
  const responses = [{}, Response.json({}, { status: 429, headers: { 'Retry-After': '301' } }), released];
  const { result, calls } = run(responses);
  await assert.rejects(result, /Retry-After|deadline/);
  assert.equal(responses.length, 1);
  assert.equal(calls.length, 1);
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

test('unbounded Retry-After and repeated transient failures cannot republish or retry early', async () => {
  const responses = [{}, Response.json({}, { status: 429, headers: { 'Retry-After': '9'.repeat(400) } }), released];
  const overflow = run(responses);
  await assert.rejects(overflow.result, /deadline/);
  assert.equal(responses.length, 1);
  assert.equal(overflow.calls.length, 1);
  const persistent = run([{}, ...Array.from({ length: 61 }, () => Response.json({}, { status: 503 }))]);
  await assert.rejects(persistent.result, /deadline/);
  assert.equal(persistent.calls.length, 1);
});
