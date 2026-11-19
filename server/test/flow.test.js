// ทดสอบขั้นตอนตรวจสลิปทั้งเส้นทาง โดยจำลอง LINE / Supabase / EasySlip ด้วย fetch ปลอม
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 't';
process.env.EASYSLIP_API_KEY = 'e';
process.env.LIFF_ID = 'liff-1';

const { handleSlip } = await import('../src/bot.js');

const group = { id: 'g1', line_group_id: 'Cgroup', access_key: 'key' };
const members = [
  { id: 'mA', line_user_id: 'UA', display_name: 'มายด์', promptpay_id: '0812345678' },
  { id: 'mB', line_user_id: 'UB', display_name: 'Fern' },
  { id: 'mC', line_user_id: 'UC', display_name: 'Bank' },
];
let state;
beforeEach(() => {
  state = {
    shares: [
      { bill_id: 'b1', member_id: 'mB', amount: 162.5, paid: false },
      { bill_id: 'b1', member_id: 'mC', amount: 142.5, paid: false },
    ],
    payments: [],
    replies: [],
    slip: { transRef: 'REF1', amount: { amount: 162.5 }, receiver: { account: { name: { th: 'นาย มายด์ ส' }, proxy: { type: 'MSISDN', account: 'xxx-xxx-5678' } } } },
  };
});
const bill = { id: 'b1', group_id: 'g1', title: 'Roast Coffee', bill_date: '2026-11-19', payer_member_id: 'mA', promptpay_id: '0812345678', status: 'open', created_at: '2026-11-19T10:00:00Z' };

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/rest/v1/bill_shares')) return json(state.shares.filter((s) => !s.paid).map((s) => ({ ...s, paid_at: null, bills: bill })));
  if (u.includes('/rest/v1/members')) return json(members);
  if (u.includes('/rest/v1/payments')) return json(state.payments.filter((p) => u.includes(p.trans_ref)));
  if (u.includes('/rest/v1/rpc/record_payment')) {
    const p = JSON.parse(opts.body).p;
    state.payments.push(p);
    for (const s of state.shares) if (p.bill_ids.includes(s.bill_id) && s.member_id === p.member_id) s.paid = true;
    return json(p.trans_ref);
  }
  if (u.includes('/storage/v1/object/')) return json({ Key: 'x' });
  if (u.includes('api-data.line.me')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
  if (u.includes('easyslip')) return json({ success: true, data: { isDuplicate: false, rawSlip: state.slip } });
  if (u.includes('/message/reply')) { state.replies.push(JSON.parse(opts.body).messages[0]); return json({}); }
  throw new Error('unexpected fetch ' + u);
};

const ev = (userId) => ({ type: 'message', replyToken: 'r', source: { type: 'group', groupId: 'Cgroup', userId }, message: { type: 'image', id: 'm1' } });

test('สลิปถูกต้อง: บันทึกการชำระ และตอบพร้อมแท็กคนที่ยังค้าง', async () => {
  await handleSlip(ev('UB'), group, members[1]);
  assert.equal(state.payments.length, 1);
  assert.deepEqual(state.payments[0].bill_ids, ['b1']);
  const r = state.replies[0];
  assert.equal(r.type, 'textV2');
  assert.match(r.text, /ยืนยันการชำระเงิน/);
  assert.match(r.text, /ผู้ที่ยังไม่ชำระ/);
  const ids = Object.values(r.substitution).map((s) => s.mentionee.userId);
  assert.deepEqual(ids, ['UB', 'UC']);
});

test('ยอดไม่ตรง: ไม่บันทึก และแจ้งสาเหตุ', async () => {
  state.slip.amount.amount = 100;
  await handleSlip(ev('UB'), group, members[1]);
  assert.equal(state.payments.length, 0);
  assert.match(state.replies[0].text, /ยอดเงินในสลิปไม่ตรง/);
});

test('ผู้รับผิดคน: ไม่บันทึก', async () => {
  state.slip.receiver.account.proxy.account = 'xxx-xxx-9999';
  await handleSlip(ev('UB'), group, members[1]);
  assert.equal(state.payments.length, 0);
  assert.match(state.replies[0].text, /บัญชีผู้รับเงินในสลิปไม่ตรง/);
});

test('สลิปซ้ำ: แจ้งว่าใช้แล้ว', async () => {
  await handleSlip(ev('UB'), group, members[1]);
  state.shares[0].paid = false; // สมมติยังค้างอีกบิล
  await handleSlip(ev('UB'), group, members[1]);
  assert.equal(state.payments.length, 1);
  assert.match(state.replies[1].text, /ถูกใช้ยืนยันการชำระไปแล้ว/);
});

test('ผู้ส่งไม่มียอดค้าง: ไม่ตรวจและไม่ตอบ', async () => {
  await handleSlip(ev('UA'), group, members[0]);
  assert.equal(state.replies.length, 0);
});

test('จ่ายคนสุดท้าย: แจ้งว่าปิดรายการ', async () => {
  state.shares[1].paid = true;
  await handleSlip(ev('UB'), group, members[1]);
  assert.match(state.replies[0].text, /ชำระครบแล้ว/);
});
