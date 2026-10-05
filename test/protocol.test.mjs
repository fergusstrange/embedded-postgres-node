import test from 'node:test';
import assert from 'node:assert/strict';
import { ProtocolParser } from '../dist/esm/protocol.js';

test('split and coalesced JSON lines, CRLF, empty lines, extra fields and final fragment', () => {
  const events = [];
  const parser = new ProtocolParser(e => events.push(e));
  const input = '\n' + JSON.stringify({ protocol: 1, event: 'ready', port: 12345, connection_url: 'postgresql://a:b@localhost/db', future: 1 }) + '\r\n{"protocol":1,"event":"stopped"}';
  for (const char of input) parser.push(char);
  parser.finish();
  parser.finish();
  assert.equal(events.length, 2);
  assert.equal(events[0].future, 1);
});
for (const [input, pattern] of [
  ['{oops}\n', /invalid JSON/], ['null\n', /protocol 1/], ['1\n', /protocol 1/], ['[]\n', /protocol 1/],
  ['{"protocol":2,"event":"stopped"}\n', /protocol 1/], ['{"protocol":1}\n', /protocol 1/],
  ['{"protocol":1,"event":"future"}\n', /Unknown/], ['{"protocol":1,"event":"error","error":1}\n', /error event/],
  ['{"protocol":1,"event":"ready","port":0}\n', /ready event/],
  ...[65536, 1.5, '3'].map(port => [JSON.stringify({protocol:1,event:'ready',port,connection_url:'postgres://localhost'}) + '\n', /ready event/]),
  ['{"protocol":1,"event":"ready","port":1,"connection_url":"bad"}\n', /connection URL/],
  ['{"protocol":1,"event":"ready","port":1,"connection_url":"https://host"}\n', /scheme/],
  ['x'.repeat(65537), /64 KiB/], ['x'.repeat(65537) + '\n', /64 KiB/],
]) test(`malformed protocol ${pattern} (${input.length} bytes)`, () => {
  const parser = new ProtocolParser(() => assert.fail('should not emit'));
  assert.throws(() => parser.push(input), pattern);
});
