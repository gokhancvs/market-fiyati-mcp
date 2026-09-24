// Loaded before tests and local verification. Socket/HTTP/fetch calls fail closed.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const blocked = () => {
  throw new Error('TEST_NETWORK_DISABLED: real network access is forbidden');
};
globalThis.fetch = blocked;
net.Socket.prototype.connect = blocked;
net.connect = net.createConnection = blocked;
http.request = http.get = https.request = https.get = tls.connect = blocked;
syncBuiltinESMExports();
