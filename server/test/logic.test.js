import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeShares, promptPayPayload, crc16, normalizePromptPay } from '../../shared/billing.js';
import { matchMasked, matchName, receiverStatus, allocate, normalize } from '../src/slip.js';
import { verifySignature, textV2, escV2 } from '../src/line.js';
import { reminderMessages, paymentFailMessage, newBillMessage, paymentSuccessMessage, welcomeMessage, menuMessage } from '../src/messages.js';

test('computeShares: หารรายการ + ค่าบริการ + ส่วนลด และผลรวมเท่ายอดบิล', () => {
  const r = computeShares([
    { price: 100, memberIds: ['a'] },
    { price: 100, memberIds: ['a', 'b', 'c'] },
  ], 10, 5);
  assert.equal(r.subtotal, 200);
  assert.equal(r.total, 215);
  const sum = Object.values(r.shares).reduce((s, v) => s + v, 0);
  assert.equal(Math.round(sum * 100) / 100, 215);
  assert.ok(r.shares.a > r.shares.b);
});

test('computeShares: เศษสตางค์ถูกเกลี่ย', () => {
  const r = computeShares([{ price: 100, memberIds: ['a', 'b', 'c'] }]);
  assert.equal(Math.round(Object.values(r.shares).reduce((s, v) => s + v, 0) * 100) / 100, 100);
});

test('crc16 CCITT-FALSE', () => assert.equal(crc16('123456789'), '29B1'));

test('PromptPay payload: เบอร์โทรและเลขบัตร', () => {
  const p = promptPayPayload('081-234-5678', 245.5);
  assert.match(p, /^000201010212/);
  assert.ok(p.includes('01130066812345678'));
  assert.ok(p.includes('5406245.50'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  assert.ok(promptPayPayload('1234567890123', 0).includes('02131234567890123'));
  assert.equal(normalizePromptPay('12345'), null);
});

test('matchMasked', () => {
  assert.ok(matchMasked('xxx-xxx-5678', '0812345678'));
  assert.ok(!matchMasked('xxx-xxx-5679', '0812345678'));
  assert.ok(matchMasked('xxx-x-x3109-x', '1234531095'));
  assert.ok(!matchMasked('xxx-x-xxxxx-x', '1234531095')); // เห็นตัวเลขน้อยเกินไป
  assert.ok(matchMasked('x-xxxx-xxxxx-12-3', '1234567890123'));
});

test('matchName', () => {
  assert.ok(matchName('นาย มายด์ ส', 'มายด์ สุขใจ'));
  assert.ok(matchName('MS. FERN K', 'fern'));
  assert.ok(!matchName('นาย แบงค์ ก', 'มายด์'));
});

const payeeA = { id: 'pA', promptpay_id: '0812345678' };
const payeeB = { id: 'pB', promptpay_id: '0898765432' };
const slip = (amount, proxy) => ({ amount, receiver: { proxyAccount: proxy } });

test('receiverStatus', () => {
  assert.equal(receiverStatus({ proxyAccount: 'xxx-xxx-5678' }, payeeA), 'match');
  assert.equal(receiverStatus({ proxyAccount: 'xxx-xxx-5678' }, payeeB), 'mismatch');
  assert.equal(receiverStatus({ bankAccount: 'xxx-x-x3109-x' }, payeeA), 'unknown');
});

test('allocate: บิลเดียวตรงยอด', () => {
  const dues = [
    { bill_id: 1, amount: 100, payee: payeeA, bill_date: '2026-11-01' },
    { bill_id: 2, amount: 162.5, payee: payeeA, bill_date: '2026-11-02' },
  ];
  assert.deepEqual(allocate(dues, slip(162.5, 'xxx-xxx-5678')), { ok: true, billIds: [2], dueTotal: 162.5 });
  assert.deepEqual(allocate(dues, slip(163, 'xxx-xxx-5678'), 1).billIds, [2]); // ปัดขึ้นได้
});

test('allocate: จ่ายรวมหลายบิลของผู้รับคนเดียว', () => {
  const dues = [
    { bill_id: 1, amount: 100, payee: payeeA, bill_date: '2026-11-01' },
    { bill_id: 2, amount: 50, payee: payeeA, bill_date: '2026-11-02' },
    { bill_id: 3, amount: 70, payee: payeeB, bill_date: '2026-11-02' },
  ];
  assert.deepEqual(allocate(dues, slip(150, 'xxx-xxx-5678'), 0).billIds, [1, 2]);
});

test('allocate: ผู้รับผิด / ยอดไม่ตรง / เทียบผู้รับไม่ได้', () => {
  const dues = [{ bill_id: 1, amount: 100, payee: payeeA, bill_date: '2026-11-01' }];
  assert.equal(allocate(dues, slip(100, 'xxx-xxx-0000')).reason, 'receiver');
  assert.equal(allocate(dues, slip(90, 'xxx-xxx-5678')).reason, 'amount');
  // สลิปแสดงเลขบัญชี แต่เรารู้แค่พร้อมเพย์ และค้างผู้รับคนเดียว -> ยอมรับ
  assert.ok(allocate(dues, { amount: 100, receiver: { bankAccount: 'xxx-x-x3109-x' } }).ok);
  const two = [...dues, { bill_id: 2, amount: 100, payee: payeeB, bill_date: '2026-11-01' }];
  assert.equal(allocate(two, { amount: 100, receiver: { bankAccount: 'xxx-x-x3109-x' } }).reason, 'receiver_unknown');
});

test('normalize: EasySlip v2 และ SlipOK', () => {
  const e = normalize({ transRef: 'T1', amount: { amount: 99.5 }, receiver: { account: { name: { th: 'นาย ก' }, proxy: { type: 'MSISDN', account: 'xxx-xxx-5678' } } } }, {});
  assert.equal(e.amount, 99.5); assert.equal(e.receiver.proxyAccount, 'xxx-xxx-5678'); assert.equal(e.receiver.name, 'นาย ก');
  const s = normalize({ transRef: 'T2', amount: 50, receiver: { displayName: 'นาย ข', account: { value: 'xxx-x-x3109-x' }, proxy: { type: 'MSISDN', value: 'xxx-xxx-1111' } } }, {});
  assert.equal(s.amount, 50); assert.equal(s.receiver.bankAccount, 'xxx-x-x3109-x'); assert.equal(s.receiver.proxyAccount, 'xxx-xxx-1111');
});

test('verifySignature', () => {
  const body = Buffer.from('{"events":[]}');
  const sig = crypto.createHmac('sha256', 'sec').update(body).digest('base64');
  assert.ok(verifySignature(body, sig, 'sec'));
  assert.ok(!verifySignature(body, sig, 'other'));
  assert.ok(!verifySignature(body, undefined, 'sec'));
});

test('textV2: แท็กและหนีวงเล็บปีกกา', () => {
  const m = textV2().add('ร้าน {A} ').mention('U1', 'มายด์').add(' 10 บาท').build();
  assert.equal(m.type, 'textV2');
  assert.equal(m.text, 'ร้าน {{A}} {m0} 10 บาท');
  assert.equal(m.substitution.m0.mentionee.userId, 'U1');
  const plain = textV2().line('สวัสดี {x}').build();
  assert.deepEqual(plain, { type: 'text', text: 'สวัสดี {x}' });
  assert.equal(escV2('}{'), '}}{{');
});

const mem = (i) => ({ line_user_id: 'U' + i, display_name: 'คน' + i });
const noEmoji = (o) => assert.doesNotMatch(JSON.stringify(o), /\p{Extended_Pictographic}/u);

/** ตรวจโครงสร้าง Flex ตามข้อกำหนดของ LINE ที่พบบ่อย */
function checkFlex(m) {
  assert.equal(m.type, 'flex');
  assert.ok(m.altText && m.altText.length <= 400, 'altText');
  const size = Buffer.byteLength(JSON.stringify(m.contents));
  assert.ok(size < (m.contents.type === 'carousel' ? 50000 : 30000), 'size ' + size);
  if (m.contents.type === 'carousel') assert.ok(m.contents.contents.length <= 12);
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.type === 'text') assert.ok(typeof n.text === 'string' && n.text.trim().length > 0, 'empty text');
    if (n.type === 'button') assert.ok(n.action.label.length <= 20, 'label too long: ' + n.action.label);
    if (n.type === 'box') assert.ok(Array.isArray(n.contents));
    Object.values(n).forEach(walk);
  })(m.contents);
}

test('reminderMessages: แท็กทุกคนที่ค้าง + การ์ดสรุป', () => {
  const msgs = reminderMessages([
    { id: 'b1', title: 'Roast Coffee', bill_date: '2026-11-19', payerName: 'มายด์', debtors: [{ member: mem(1), amount: 162.5 }, { member: mem(2), amount: 120 }] },
  ], 'https://liff.line.me/x?g=k', '2026-11-19T11:00:00Z');
  assert.equal(msgs[0].type, 'textV2');
  assert.equal(Object.keys(msgs[0].substitution).length, 2);
  const f = msgs.at(-1);
  checkFlex(f);
  assert.match(f.altText, /282\.50/);
  assert.match(JSON.stringify(f), /bill=b1/);
  noEmoji(msgs);
});

test('reminderMessages: คนเยอะแบ่งข้อความแท็ก และไม่เกิน 5 ข้อความ', () => {
  const g = Array.from({ length: 14 }, (_, b) => ({ id: 'b' + b, title: 'บิล' + b, bill_date: '2026-11-19', payerName: 'ก', debtors: Array.from({ length: 6 }, (_, i) => ({ member: mem(b * 10 + i), amount: 10 })) }));
  const msgs = reminderMessages(g, 'u');
  assert.ok(msgs.length <= 5);
  const texts = msgs.filter((m) => m.type === 'textV2');
  assert.ok(texts.length >= 2);
  assert.ok(texts.every((m) => Object.keys(m.substitution).length <= 20));
  checkFlex(msgs.at(-1));
});

test('การ์ดอื่น ๆ ถูกต้องตามข้อกำหนด และไม่มีอีโมจิ', () => {
  const all = [
    ...paymentFailMessage(mem(1), 'amount', { slipAmount: 90, dues: [{ title: 'A', amount: 100 }], url: 'https://x' }),
    ...newBillMessage({ id: 'b1', title: 'ร้าน {ทดสอบ}', bill_date: '2026-11-19', total: 300 }, 'มายด์', [{ member: mem(1), amount: 100 }, { member: mem(2), amount: 100 }], 'https://x?g=1'),
    ...paymentSuccessMessage(mem(1), { amount: 100, transRef: 'R1' }, [{ id: 'b1', title: 'A', bill_date: '2026-11-19', amount: 100, payerName: 'มายด์', shares: [{ name: 'คน1', amount: 100, status: 'paid' }, { name: 'มายด์', amount: 100, status: 'payee' }] }], 'https://x?g=1'),
    welcomeMessage('https://x'),
    menuMessage('https://x?g=1', { groupName: 'แก๊งคาเฟ่', dues: { bills: [{ debtors: [{ member: { id: 'a' }, amount: 100 }, { member: { id: 'b' }, amount: 50.5 }] }] } }),
    menuMessage('https://x?g=1', { groupName: 'แก๊งคาเฟ่', dues: { bills: [] } }),
  ];
  const menu = JSON.stringify(all.at(-2));
  assert.match(menu, /150\.50/);
  assert.match(menu, /tab=new/);
  assert.match(menu, /tab=dues/);
  for (const m of all) { if (m.type === 'flex') checkFlex(m); noEmoji(m); }
  assert.equal(all[0].type, 'textV2');
});
