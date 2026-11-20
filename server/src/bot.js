// จัดการ webhook event จาก LINE
import * as db from './db.js';
import * as line from './line.js';
import * as msg from './messages.js';
import { config, liffUrl } from './config.js';
import { ensureGroup, ensureMember, groupDues, toReminderInput } from './services.js';
import { processSlip } from './slipflow.js';
import { publish } from './events.js';

// คำสั่งขอลิงก์เว็บ (ไม่สนตัวพิมพ์เล็ก-ใหญ่ เช่น Moomi, MOOMI)
const MENU_WORDS = new Set(['moomi']);
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
    publish(group.id, 'members', {});
    return;
  }

  if (ev.type !== 'message' || !src.userId) return;
  const member = await ensureMember(group, src.userId);

  if (ev.message.type === 'text') {
    const t = ev.message.text.trim().toLowerCase();
    if (MENU_WORDS.has(t)) {
      const dues = await groupDues(group.id);
      return safeReply(ev, msg.menuMessage(url, { groupName: group.name, dues }));
    }
    if (DUES_WORDS.has(t)) {
      const dues = await groupDues(group.id);
      if (!dues.bills.length) return safeReply(ev, { type: 'text', text: 'ขณะนี้ไม่มียอดค้างชำระ สมาชิกทุกคนชำระครบแล้ว' });
      // แท็กทุกคนที่ค้างพร้อมยอด (ให้ได้รับการแจ้งเตือน) + การ์ดสรุป
      return safeReply(ev, msg.reminderMessages(toReminderInput(dues), url));
    }
    return;
  }

  if (ev.message.type === 'image') return handleSlip(ev, group, member);
}

/** ผู้ส่งรูปมียอดค้าง → ถือว่าอาจเป็นสลิป แล้วตรวจสอบ */
export async function handleSlip(ev, group, member) {
  const url = liffUrl(group.access_key);
  // ไม่มีค้าง ไม่ต้องดาวน์โหลดรูป
  const dues = await groupDues(group.id);
  if (!dues.bills.some((x) => x.debtors.some((d) => d.member.id === member.id))) return;

  let content;
  try { content = await line.getContent(ev.message.id); }
  catch (e) { console.error('[slip] download error', e.message); return safeReply(ev, msg.paymentFailMessage(member, 'provider', { url })); }

  const r = await processSlip({ group, member, buffer: content.buffer, contentType: content.contentType });
  if (r.status === 'no_dues' || r.status === 'not_slip') return; // รูปทั่วไป ไม่ตอบ
  if (r.status === 'fail') {
    return safeReply(ev, msg.paymentFailMessage(member, r.reason, { slipAmount: r.slip?.amount, dues: r.mine, url }));
  }
  return safeReply(ev, msg.paymentSuccessMessage(member, r.slip, r.paid, url));
}
