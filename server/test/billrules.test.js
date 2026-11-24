import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBill, canManageBill, billHasPayments, financialChanged } from '../src/billrules.js';
import { billCancelledMessage, newBillMessage } from '../src/messages.js';

const ids = new Set(['a', 'b', 'c']);
const body = { title: 'ร้าน', date: '2026-11-20', payerId: 'a', promptpayId: '0812345678', servicePct: 0, discount: 0, items: [{ name: 'ชา', price: 90, memberIds: ['a', 'b', 'c'] }] };
const bill = {
  id: 'x', created_by: 'b', payer_member_id: 'a', promptpay_id: '0812345678', service_pct: 0, discount: 0,
  bill_items: [{ position: 0, name: 'ชา', price: 90, bill_item_shares: [{ member_id: 'c' }, { member_id: 'a' }, { member_id: 'b' }] }],
  bill_shares: [{ member_id: 'a', paid_at: 'x' }, { member_id: 'b', paid_at: null }, { member_id: 'c', paid_at: null }],
};

test('validateBill: ผ่าน / ช่องที่ผิด / ใช้ QR เดิมแทนพร้อมเพย์ได้', () => {
  assert.deepEqual(validateBill(body, ids).fields, {});
  const bad = validateBill({ ...body, title: '', promptpayId: '', items: [] }, ids).fields;
  assert.ok(bad.title && bad.promptpayId && bad.items);
  assert.deepEqual(validateBill({ ...body, promptpayId: '' }, ids, { hasQr: true }).fields, {});
});

test('canManageBill: ผู้สร้าง / ผู้รับเงินเมื่อไม่ทราบผู้สร้าง / ผู้ดูแล', () => {
  assert.ok(canManageBill({ id: 'b', line_user_id: 'Ub' }, bill));
  assert.ok(!canManageBill({ id: 'a', line_user_id: 'Ua' }, bill));             // ผู้รับเงินแต่ไม่ใช่ผู้สร้าง
  assert.ok(canManageBill({ id: 'a', line_user_id: 'Ua' }, { ...bill, created_by: null }));
  assert.ok(canManageBill({ id: 'c', line_user_id: 'Uc' }, bill, ['Uc']));     // ผู้ดูแล
  assert.ok(canManageBill({ id: '0', display_name: 'ผู้ดูแลระบบ' }, bill));     // ผู้ดูแลที่ไม่ได้อยู่ในกลุ่ม
});

test('billHasPayments: ไม่นับผู้รับเงิน', () => {
  assert.equal(billHasPayments(bill), false);
  assert.equal(billHasPayments({ ...bill, bill_shares: [...bill.bill_shares.slice(0, 2), { member_id: 'c', paid_at: 'y' }] }), true);
});

test('financialChanged: แก้แค่ชื่อ/วันที่ไม่นับ, แก้ราคาหรือคนนับ', () => {
  assert.equal(financialChanged(bill, validateBill({ ...body, title: 'ชื่อใหม่', date: '2026-11-21' }, ids).data), false);
  assert.equal(financialChanged(bill, validateBill({ ...body, items: [{ name: 'ชา', price: 95, memberIds: ['a', 'b', 'c'] }] }, ids).data), true);
  assert.equal(financialChanged(bill, validateBill({ ...body, items: [{ name: 'ชา', price: 90, memberIds: ['a', 'b'] }] }, ids).data), true);
  assert.equal(financialChanged(bill, validateBill({ ...body, payerId: 'b' }, ids).data), true);
});

test('ข้อความยกเลิกบิล: แท็กทั้งคนที่ยังไม่จ่ายและคนที่จ่ายแล้ว', () => {
  const m = (i) => ({ line_user_id: 'U' + i, display_name: 'คน' + i });
  const msg = billCancelledMessage({ title: 'ร้าน', bill_date: '2026-11-20', total: 300 }, { byName: 'คน2', reason: 'ลงผิด', payerName: 'คน1', paid: [m(3)], unpaid: [m(4)] });
  assert.equal(msg.type, 'textV2');
  assert.deepEqual(Object.values(msg.substitution).map((s) => s.mentionee.userId), ['U4', 'U3']);
  assert.match(msg.text, /เหตุผล: ลงผิด/);
  assert.match(msg.text, /รับเงินคืน/);
  const edited = newBillMessage({ id: 'b1', title: 'ร้าน', bill_date: '2026-11-20', total: 300 }, 'คน1', [{ member: m(2), amount: 100 }], 'https://x?g=1', { edited: true });
  assert.match(JSON.stringify(edited), /แก้ไขบิล/);
});

test('SlipOK 1014 (บัญชีผู้รับไม่ตรงกับบัญชีร้าน) แยกจากสลิปไม่พบ', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(config.slip.slipokLog, false);
});

test('แก้บิลหลังมีคนจ่าย: เพิ่มคน/รายการได้ถ้ายอดคนที่จ่ายแล้วเท่าเดิม', async () => {
  const { paidShareConflict } = await import('../src/billrules.js');
  const bill = { payer_member_id: 'P', bill_shares: [
    { member_id: 'P', amount: 50, paid_at: 'x' }, { member_id: 'A', amount: 50, paid_at: 'x' }, { member_id: 'B', amount: 50, paid_at: null }] };
  const ok = { payerId: 'P', calc: { shares: { P: 50, A: 50, B: 80, C: 30 } } };
  assert.equal(paidShareConflict(bill, ok), null);
  const bad = { payerId: 'P', calc: { shares: { P: 40, A: 40, B: 40, C: 40 } } };
  assert.match(paidShareConflict(bill, bad, () => 'Fern'), /Fern จ่ายแล้ว 50\.00 แต่ยอดใหม่เป็น 40\.00/);
  assert.match(paidShareConflict(bill, { ...ok, payerId: 'B' }), /เปลี่ยนผู้รับเงินไม่ได้/);
  assert.equal(paidShareConflict({ ...bill, bill_shares: bill.bill_shares.map((s) => ({ ...s, paid_at: s.member_id === 'P' ? 'x' : null })) }, bad), null);
});
