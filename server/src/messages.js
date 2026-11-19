// ข้อความที่บอทส่งในกลุ่ม: ข้อความสั้นที่แท็กคน (ให้มีการแจ้งเตือน) + การ์ด Flex สรุปรายละเอียด
import { textV2 } from './line.js';
import { config } from './config.js';
import { formatBaht, round2 } from '../../shared/billing.js';
import * as card from './flex.js';

export const thDate = (d) =>
  new Date(String(d).length <= 10 ? `${d}T00:00:00+07:00` : d)
    .toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: config.remind.timezone });

/** ลิงก์เว็บที่เปิดบิลนั้นทันที */
export const billUrl = (url, billId) => (billId ? `${url}${url.includes('?') ? '&' : '?'}bill=${encodeURIComponent(billId)}` : url);

const MENTIONS_PER_MESSAGE = 20;

/** ข้อความแท็กหลายคน แบ่งเป็นหลายข้อความถ้าคนเยอะ */
function mentionMessages(prefix, people, suffix) {
  const out = [];
  for (let i = 0; i < Math.max(people.length, 1); i += MENTIONS_PER_MESSAGE) {
    const b = textV2();
    if (i === 0) b.add(prefix);
    people.slice(i, i + MENTIONS_PER_MESSAGE).forEach((m, j) => { if (j || i === 0) b.add(' '); b.mention(m.line_user_id, m.display_name); });
    if (suffix && i + MENTIONS_PER_MESSAGE >= people.length) b.add(suffix);
    out.push(b.build());
  }
  return out;
}

export function welcomeMessage(url) {
  return card.flex('ระบบหารบิลพร้อมใช้งานในกลุ่มนี้ กรุณาพิมพ์ข้อความใดก็ได้หนึ่งครั้ง', card.welcomeCard({ url, remindTime: config.remind.time }));
}

/** เมนูหลัก: การ์ดพร้อมปุ่มลัด (ตอบเมื่อพิมพ์ moomi) */
export function menuMessage(url, { groupName, dues } = {}) {
  const bills = dues?.bills || [];
  const people = new Set();
  let total = 0;
  for (const x of bills) for (const d of x.debtors) { people.add(d.member.id); total += Number(d.amount); }
  return card.flex('เมนู Moomi หารบิล: ดูรายการบิล ดูยอดค้าง สร้างบิลใหม่', card.menuCard({
    groupName, url, dueTotal: round2(total), dueBills: bills.length, duePeople: people.size, remindTime: config.remind.time,
  }));
}

/**
 * บิลใหม่
 * @param bill {id,title,bill_date,total}
 * @param debtors [{member:{line_user_id,display_name}, amount}]
 */
export function newBillMessage(bill, payerName, debtors, url) {
  const u = billUrl(url, bill.id);
  return [
    ...mentionMessages(`บันทึกบิลใหม่ "${bill.title}" ผู้ที่ต้องชำระ:`, debtors.map((d) => d.member), ' กรุณาตรวจสอบยอดในการ์ดด้านล่าง'),
    card.flex(`บิลใหม่ ${bill.title} ยอดรวม ${formatBaht(bill.total)}`, card.newBillCard({
      title: bill.title, date: thDate(bill.bill_date), total: bill.total, payerName,
      debtors: debtors.map((d) => ({ name: d.member.display_name, amount: d.amount })), url: u,
    })),
  ].slice(0, 5);
}

/**
 * ยืนยันการชำระ
 * @param paid [{ id, title, bill_date, payerName, amount, shares:[{name, amount, status}] }]
 */
export function paymentSuccessMessage(member, slip, paid, url) {
  const b = textV2();
  b.mention(member.line_user_id, member.display_name);
  b.add(` ชำระเงินจำนวน ${formatBaht(slip.amount)} เรียบร้อยแล้ว`);
  const cards = paid.slice(0, 4).map((p) => card.flex(
    `${member.display_name} ชำระ ${p.title} ${formatBaht(p.amount)} แล้ว`,
    card.paymentCard({
      title: p.title, date: thDate(p.bill_date), payerName: p.payerName, amountPaid: p.amount,
      payerOfSlip: member.display_name, transRef: slip.transRef, shares: p.shares, url: billUrl(url, p.id),
    }),
  ));
  return [b.build(), ...cards];
}

export const REASONS = {
  duplicate: 'สลิปนี้ถูกใช้ยืนยันการชำระไปแล้ว',
  not_found: 'ไม่พบรายการโอนนี้ในระบบธนาคาร สลิปอาจไม่ถูกต้อง หรือเพิ่งโอนไม่นาน กรุณาส่งใหม่อีกครั้งในอีกสักครู่',
  receiver: 'บัญชีผู้รับเงินในสลิปไม่ตรงกับผู้รับเงินของรายการที่ค้างชำระ',
  receiver_unknown: 'ไม่สามารถยืนยันบัญชีผู้รับเงินได้ เนื่องจากค้างชำระกับผู้รับเงินมากกว่าหนึ่งคน ผู้รับเงินกรุณาเพิ่มเลขบัญชีหรือชื่อบัญชีในหน้า "บัญชีรับเงิน" ของเว็บ',
  amount: 'ยอดเงินในสลิปไม่ตรงกับยอดที่ค้างชำระ',
  provider: 'ระบบตรวจสลิปขัดข้องชั่วคราว กรุณาส่งสลิปอีกครั้งภายหลัง',
};

/** @param opts { slipAmount, dues:[{title, amount}], url } */
export function paymentFailMessage(member, reason, { slipAmount, dues = [], url = '' } = {}) {
  const b = textV2();
  b.mention(member.line_user_id, member.display_name);
  b.add(' ตรวจสอบสลิปไม่ผ่าน กรุณาดูรายละเอียดด้านล่าง');
  const text = REASONS[reason] || REASONS.provider;
  if (!url) return [b.build(), { type: 'text', text: `สาเหตุ: ${text}` }];
  return [
    b.build(),
    card.flex(`ตรวจสอบสลิปไม่ผ่าน: ${text}`, card.failCard({
      name: member.display_name, reason: text,
      slipAmount: reason === 'amount' ? slipAmount : null,
      dues: reason === 'amount' ? dues : [], url,
    })),
  ];
}

/**
 * ข้อความทวงรายวัน
 * @param groupDues [{ id, title, bill_date, payerName, debtors:[{member, amount}] }]
 */
export function reminderMessages(groupDues, url, today = new Date().toISOString()) {
  const per = new Map();
  for (const g of groupDues) for (const d of g.debtors) {
    const r = per.get(d.member.line_user_id) || { member: d.member, amount: 0 };
    r.amount += Number(d.amount);
    per.set(d.member.line_user_id, r);
  }
  const people = [...per.values()].sort((a, b) => b.amount - a.amount);
  const total = round2(people.reduce((s, p) => s + p.amount, 0));
  const dateText = thDate(today);

  const mentions = mentionMessages(`แจ้งเตือนยอดค้างชำระ ประจำวันที่ ${dateText}`, people.map((p) => p.member), ' กรุณาชำระและส่งสลิปในกลุ่มนี้').slice(0, 4);
  const bubbles = [
    card.reminderSummaryCard({ dateText, total, billCount: groupDues.length, url, people: people.map((p) => ({ name: p.member.display_name, amount: round2(p.amount) })) }),
    ...groupDues.slice(0, 11).map((g) => card.reminderBillCard({
      title: g.title, dateText: thDate(g.bill_date), payerName: g.payerName, url: billUrl(url, g.id),
      debtors: g.debtors.map((d) => ({ name: d.member.display_name, amount: d.amount })),
    })),
  ];
  // carousel ต้องไม่เกิน 50 KB: ตัดการ์ดบิลท้าย ๆ ออกถ้าใหญ่เกิน (ดูครบได้ในเว็บ)
  while (bubbles.length > 1 && Buffer.byteLength(JSON.stringify(bubbles)) > 45000) bubbles.pop();
  return [
    ...mentions,
    card.flex(`แจ้งเตือนยอดค้างชำระ รวม ${formatBaht(total)}`, { type: 'carousel', contents: bubbles }),
  ];
}
