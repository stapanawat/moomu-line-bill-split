import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { subscribe, publish, connectionCount } from '../src/events.js';

function fakeConn() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.chunks = [];
  res.writeHead = (s, h) => { res.status = s; res.headers = h; };
  res.write = (c) => { res.chunks.push(c); return true; };
  return { req, res };
}

test('SSE: ส่งเหตุการณ์ให้เฉพาะคนในกลุ่มเดียวกัน และเลิกส่งเมื่อปิดการเชื่อมต่อ', () => {
  const a = fakeConn(), b = fakeConn(), other = fakeConn();
  subscribe('g1', a.req, a.res);
  subscribe('g1', b.req, b.res);
  subscribe('g2', other.req, other.res);
  assert.equal(a.res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
  assert.equal(connectionCount('g1'), 2);

  assert.equal(publish('g1', 'payment', { billIds: ['b1'], message: 'Fern ชำระเงินแล้ว' }), 2);
  const last = a.res.chunks.at(-1);
  assert.match(last, /^event: payment\ndata: /);
  assert.equal(JSON.parse(last.split('data: ')[1]).billIds[0], 'b1');
  assert.ok(!other.res.chunks.some((c) => c.includes('payment')));

  a.req.emit('close');
  assert.equal(connectionCount('g1'), 1);
  b.req.emit('close'); other.req.emit('close');
  assert.equal(publish('g1', 'payment'), 0);
});
