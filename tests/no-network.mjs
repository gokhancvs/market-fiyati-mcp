// Loaded before tests and local verification. Socket/HTTP/fetch/DNS/UDP calls fail closed.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

const blocked = () => {
  throw new Error('TEST_NETWORK_DISABLED: real network access is forbidden');
};
globalThis.fetch = blocked;
net.Socket.prototype.connect = blocked;
net.connect = net.createConnection = blocked;
http.request = http.get = https.request = https.get = tls.connect = blocked;
for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype])
  for (const name of Object.getOwnPropertyNames(target))
    if (/^(?:lookup|resolve|reverse)/.test(name) && typeof target[name] === 'function') target[name] = blocked;
dgram.createSocket = blocked;
syncBuiltinESMExports();
