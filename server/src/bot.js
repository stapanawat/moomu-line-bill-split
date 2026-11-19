// จัดการ webhook event จาก LINE
import * as db from './db.js';
import * as line from './line.js';
import * as msg from './messages.js';
import { config, liffUrl } from './config.js';
import { ensureGroup, ensureMember, groupDues, toReminderInput } from './services.js';
import { verifySlip, allocate, SlipError } from './slip.js';
import { round2 } from '../../shared/billing.js';

const MENU_WORDS = new Set(['เมนู', 'บิล', 'หารบิล', 'menu', 'เว็บ', 'ลิงก์']);
const DUES_WORDS = new Set(['ยอดค้าง', 'ค้างจ่าย', 'ใครยังไม่จ่าย']);

const seen = new Set(); // กันประมวลผล event ซ้ำ (LINE ส่งซ้ำได้)

export async function handleEvents(events) {
  events = events.filter((ev) => {
    const id = ev.webhookEventId;
    if (ev.deliveryContext?.isRedelivery && ev.type === 'message') return false;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
    return true;
  });
  await Promise.all(events.map((ev) => handleEvent(ev).catch((e) => console.error('[bot] event error', ev.type, e))));
}

/** ตอบกลับด้วย reply (ไม่เสียโควตา) ถ้า reply token หมดอายุจะส่งแบบ push แทน */
async function safeReply(ev, messages) {
  try {
    await line.reply(ev.replyToken, messages);
  } catch (e) {
    const to = ev.source?.groupId || ev.source?.userId;
    if (!to) return console.error('[bot] reply failed', e.message);
    try { await line.push(to, messages); } catch (e2) { console.error('[bot] reply+push failed', e.message, e2.message); }
  }
}

async function handleEvent(ev) {
  const src = ev.source || {};
  if (src.type !== 'group') {
    if (ev.type === 'message' && ev.replyToken) {
      await safeReply(ev, { type: 'text', text: 'บอทนี้ใช้งานในกลุ่ม LINE เท่านั้น กรุณาเชิญบอทเข้ากลุ่มที่ต้องการหารบิล' });
    }
    return;
  }

  if (ev.type === 'leave') return db.deactivateGroup(src.groupId);

  const group = await ensureGroup(src.groupId);
  const url = liffUrl(group.access_key);

  if (ev.type === 'join') return safeReply(ev, msg.welcomeMessage(url));

  if (ev.type === 'memberJoined') {
    for (const m of ev.joined?.members || []) if (m.userId) await ensureMember(group, m.userId).catch(() => {});
    return;
  }

  if (ev.type !== 'message' || !src.userId) return;
  const member = await ensureMember(group, src.userId);

  if (ev.message.type === 'text') {
    const t = ev.message.text.trim().toLowerCase();
    if (MENU_WORDS.has(t)) return safeReply(ev, msg.menuMessage(url));
    if (DUES_WORDS.has(t)) {
      const dues = await groupDues(group.id);
      if (!dues.bills.length) return safeReply(ev, { type: 'text', text: 'ขณะนี้ไม่มียอดค้างชำระ' });
      return safeReply(ev, msg.reminderMessages(toReminderInput(dues), url));
    }
    return;
  }

  if (ev.message.type === 'image') return handleSlip(ev, group, member);
}

/** ผู้ส่งรูปมียอดค้าง → ถือว่าอาจเป็นสลิป แล้วตรวจสอบ */
export async function handleSlip(ev, group, member) {
  const dues = await groupDues(group.id);
  const mine = [];
  for (const x of dues.bills) {
    const d = x.debtors.find((d) => d.member.id === member.id);
    if (!d) continue;
    mine.push({
      bill_id: x.bill.id,
      title: x.bill.title,
      bill_date: x.bill.bill_date,
      created_at: x.bill.created_at,
      amount: d.amount,
      payee: { ...x.payer, promptpay_id: x.bill.promptpay_id || x.payer?.promptpay_id },
      payerName: x.payer?.display_name || '-',
    });
  }
  if (!mine.length) return; // ไม่มีค้าง ไม่ต้องตรวจรูป

  let slip;
  try {
    const { buffer, contentType } = await line.getContent(ev.message.id);
    slip = await verifySlip(buffer, contentType);
    slip._buffer = buffer;
    slip._contentType = contentType;
  } catch (e) {
    if (e instanceof SlipError && e.kind === 'not_slip') return; // รูปทั่วไป ไม่ตอบ
    console.error('[slip] verify error', e.message);
    const kind = e instanceof SlipError ? e.kind : 'provider';
    return safeReply(ev, msg.paymentFailMessage(member, kind));
  }

  if (!slip.transRef) return safeReply(ev, msg.paymentFailMessage(member, 'not_found'));
  if (slip.isDuplicate || (await db.getPaymentByRef(slip.transRef))) {
    return safeReply(ev, msg.paymentFailMessage(member, 'duplicate'));
  }

  const result = allocate(mine, slip, config.slip.overpayTolerance);
  if (!result.ok) {
    return safeReply(ev, msg.paymentFailMessage(member, result.reason, { slipAmount: slip.amount, dues: mine }));
  }

  const ext = /png/.test(slip._contentType) ? 'png' : 'jpg';
  const slipPath = `slips/${group.id}/${slip.transRef.replace(/[^\w-]/g, '')}.${ext}`;
  try {
    await db.uploadFile(slipPath, slip._buffer, slip._contentType);
    await db.recordPaymentRpc({
      group_id: group.id,
      member_id: member.id,
      trans_ref: slip.transRef,
      amount: slip.amount,
      slip_path: slipPath,
      provider: slip.provider,
      receiver_name: slip.receiver.name || null,
      raw: { receiver: slip.receiver, sender: slip.sender, date: slip.date },
      bill_ids: result.billIds,
    });
  } catch (e) {
    if (/duplicate_slip/.test(e.message)) return safeReply(ev, msg.paymentFailMessage(member, 'duplicate'));
    console.error('[slip] save error', e.message);
    return safeReply(ev, msg.paymentFailMessage(member, 'provider'));
  }

  // สรุปผลหลังบันทึก
  const after = await groupDues(group.id);
  const paid = result.billIds.map((id) => {
    const d = mine.find((x) => x.bill_id === id);
    const still = after.bills.find((x) => x.bill.id === id);
    return { title: d.title, amount: round2(d.amount), payerName: d.payerName, remaining: still ? still.debtors.map((x) => x.member) : [] };
  });
  return safeReply(ev, msg.paymentSuccessMessage(member, slip, paid));
}
