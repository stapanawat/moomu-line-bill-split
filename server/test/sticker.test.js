import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duePhase, reminderBillCard } from '../src/flex.js';
import { config } from '../src/config.js';

test('เฟสค้างชำระนับจากวันที่ในบิล', () => {
  const today = new Date('2026-11-20T11:00:00Z');
  assert.equal(duePhase('2026-11-20', today), 1);
  assert.equal(duePhase('2026-11-19', today), 1);
  assert.equal(duePhase('2026-11-18', today), 2);
  assert.equal(duePhase('2026-11-16', today), 4);
  assert.equal(duePhase('2026-11-01', today), 5);
});

test('การ์ดทวงใส่สติกเกอร์ตามเฟส เมื่อมี URL สาธารณะ', () => {
  const args = { title: 'A', dateText: 'x', payerName: 'P', debtors: [{ name: 'B', amount: 10 }], url: 'https://l', phase: 3 };
  const old = config.publicUrl;
  config.publicUrl = '';
  assert.equal(reminderBillCard(args).hero, undefined);
  config.publicUrl = 'https://app.example.com';
  assert.equal(reminderBillCard(args).hero.contents[0].url, 'https://app.example.com/stickers/due3.png?v=1');
  config.publicUrl = old;
});
