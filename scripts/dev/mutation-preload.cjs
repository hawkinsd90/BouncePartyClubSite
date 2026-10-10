// Preload for every test process of a mutation run.
// 1. Fail fast: the first FAIL line ends the process (that is all a kill needs).
// 2. No outbound network: a mutant that adds a fetch (or any socket to a non-local host) must fail, never contact a host.
const orig = console.error;
console.error = (...a) => {
  orig(...a);
  if (typeof a[0] === 'string' && /^FAIL/.test(a[0])) process.exit(1);
};

const blocked = () => {
  throw new Error('NETWORK BLOCKED (mutation run)');
};
globalThis.fetch = blocked;

const isLocal = (host) => host === undefined || host === '127.0.0.1' || host === 'localhost' || host === '::1';
const net = require('net');
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const host = first && typeof first === 'object' ? first.host : args[1];
  if (first && typeof first === 'object' && first.path) return realConnect.apply(this, args);
  if (!isLocal(host)) blocked();
  return realConnect.apply(this, args);
};
require('tls').connect = blocked;
const dns = require('dns');
const realLookup = dns.lookup;
dns.lookup = function (host, ...rest) {
  if (!isLocal(host)) blocked();
  return realLookup.call(this, host, ...rest);
};
