import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('offline guard blocks network entry points in an isolated process', () => {
  const guardUrl = new URL('../../tests/no-network.mjs', import.meta.url).href;
  const source = (withGuard: boolean) => `
    import assert from 'node:assert/strict';
    import net,{connect as namedConnect} from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    import tls from 'node:tls';
    import http2 from 'node:http2';
    import {syncBuiltinESMExports} from 'node:module';
    const sentinel=()=>{throw new Error('UNGUARDED_NETWORK_CALL');};
    globalThis.fetch=sentinel;
    net.Socket.prototype.connect=sentinel;
    net.connect=net.createConnection=sentinel;
    http.request=http.get=https.request=https.get=tls.connect=sentinel;
    syncBuiltinESMExports();
    ${withGuard ? `await import(${JSON.stringify(guardUrl)});` : ''}
    const probes=[
      ()=>fetch('http://127.0.0.1:1'),
      ()=>new net.Socket().connect({host:'127.0.0.1',port:1}),
      ()=>net.connect({host:'127.0.0.1',port:1}),
      ()=>net.createConnection({host:'127.0.0.1',port:1}),
      ()=>namedConnect({host:'127.0.0.1',port:1}),
      ()=>http.request('http://127.0.0.1:1'),
      ()=>http.get('http://127.0.0.1:1'),
      ()=>https.request('https://127.0.0.1:1'),
      ()=>https.get('https://127.0.0.1:1'),
      ()=>tls.connect({host:'127.0.0.1',port:1}),
      ()=>http2.connect('http://127.0.0.1:1'),
    ];
    for(const probe of probes)assert.throws(probe,/TEST_NETWORK_DISABLED/);
  `;
  const run = (withGuard: boolean) =>
    spawnSync(process.execPath, ['--input-type=module', '--eval', source(withGuard)], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        MARKET_FIYATI_MODE: 'offline'
      }
    });
  const noGuard = run(false);
  assert.notEqual(noGuard.status, 0);
  assert.match(noGuard.stderr, /UNGUARDED_NETWORK_CALL/);
  const guarded = run(true);
  assert.equal(guarded.status, 0, guarded.stderr);
});
