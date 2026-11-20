import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderMessages, newBillMessage } from '../src/messages.js';
import { withoutMentions } from '../src/line.js';

const mem = (n, i) => ({ line_user_id: 'U' + i, display_name: n });

test('ข้อความทวงแท็กทุกคนพร้อมยอดทีละบรรทัด', () => {
  const [t] = reminderMessages([{ id: 'b1', title: 'A', bill_date: '2026-11-19', payerName: 'P', debtors: [{ member: mem('ต้นกล้า', 3), amount: 162.5 }, { member: mem('Bank', 4), amount: 142.5 }] }], 'https://x', '2026-11-20T11:00:00Z');
  assert.equal(t.type, 'textV2');
  assert.match(t.text, /\n\{m0\} 162\.50 บาท\n\{m1\} 142\.50 บาท\n/);
  assert.deepEqual(Object.values(t.substitution).map((s) => s.mentionee.userId), ['U3', 'U4']);
});

test('บิลใหม่แท็กพร้อมยอด และแปลงเป็นข้อความธรรมดาได้เมื่อแท็กไม่ผ่าน', () => {
  const [t] = newBillMessage({ id: 'b1', title: 'A', bill_date: '2026-11-19', total: 100 }, 'P', [{ member: mem('Fern', 2), amount: 50 }], 'https://x');
  assert.match(t.text, /\{m0\} 50\.00 บาท/);
  const [plain] = withoutMentions([t]);
  assert.equal(plain.type, 'text');
  assert.match(plain.text, /@Fern 50\.00 บาท/);
});
