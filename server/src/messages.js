// ข้อความที่บอทส่งในกลุ่ม (ภาษาทางการ ไม่ใช้อีโมจิ)
import { textV2 } from './line.js';
import { config } from './config.js';
import { formatBaht, round2 } from '../../shared/billing.js';

export const thDate = (d) =>
  new Date(String(d).length <= 10 ? `${d}T00:00:00+07:00` : d)
    .toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: config.remind.timezone });

const LIMIT = 4500; // text สูงสุด 5000 ตัวอักษร เผื่อไว้

export function welcomeMessage(url) {
  return {
    type: 'text',
    text: [
      'ขอบคุณที่เพิ่มบอทหารบิลเข้ากลุ่ม',
      '',
      'วิธีใช้งาน',
      '1. เปิดเว็บเพื่อบันทึกบิล แนบใบเสร็จ และระบุเลขพร้อมเพย์ของผู้รับเงิน',
      '2. สมาชิกสแกน QR ในเว็บเพื่อชำระเงิน แล้วส่งรูปสลิปในกลุ่มนี้',
      `3. ระบบตรวจสลิปอัตโนมัติ และแจ้งเตือนผู้ที่ยังไม่ชำระทุกวัน เวลา ${config.remind.time} น.`,
      '',
      'หมายเหตุ: สมาชิกที่ยังไม่ปรากฏชื่อในระบบ กรุณาพิมพ์ข้อความใดก็ได้ในกลุ่มหนึ่งครั้ง',
      '',
      `เปิดเว็บ: ${url}`,
      'พิมพ์ "เมนู" เพื่อขอลิงก์อีกครั้ง หรือ "ยอดค้าง" เพื่อดูยอดคงค้าง',
    ].join('\n'),
  };
}

export const menuMessage = (url) => ({
  type: 'text',
  text: `เว็บบันทึกบิลและชำระเงินของกลุ่มนี้\n${url}\n\nพิมพ์ "ยอดค้าง" เพื่อดูยอดคงค้างทั้งหมด`,
});

/** @param {{title,bill_date,total}} bill @param {{member:{line_user_id,display_name}, amount}[]} debtors */
export function newBillMessage(bill, payerName, debtors, url) {
  const b = textV2();
  b.line('บันทึกบิลใหม่');
  b.line(`รายการ: ${bill.title}`);
  b.line(`วันที่: ${thDate(bill.bill_date)}`);
  b.line(`ยอดรวม: ${formatBaht(bill.total)}`);
  b.line(`ผู้รับเงิน: ${payerName}`);
  b.line('');
  b.line('ยอดที่ต้องชำระ');
  for (const d of debtors) { b.mention(d.member.line_user_id, d.member.display_name); b.line(` ${formatBaht(d.amount)}`); }
  b.line('');
  b.line(`ดูใบเสร็จและ QR สำหรับชำระเงิน: ${url}`);
  b.add('เมื่อโอนแล้ว กรุณาส่งรูปสลิปในกลุ่มนี้');
  return b.build();
}

/**
 * @param member ผู้ชำระ
 * @param paid [{title, amount, payerName, remaining:[{line_user_id,display_name}]}]
 */
export function paymentSuccessMessage(member, slip, paid) {
  const b = textV2();
  b.line('ยืนยันการชำระเงิน');
  b.mention(member.line_user_id, member.display_name);
  b.line(` ชำระเงินจำนวน ${formatBaht(slip.amount)} เรียบร้อยแล้ว`);
  b.line(`เลขอ้างอิง: ${slip.transRef}`);
  for (const p of paid) {
    b.line('');
    b.line(`รายการ: ${p.title} (ผู้รับเงิน ${p.payerName}) ยอด ${formatBaht(p.amount)}`);
    if (p.remaining.length) {
      b.add('ผู้ที่ยังไม่ชำระ: ');
      p.remaining.forEach((m, i) => { if (i) b.add(' '); b.mention(m.line_user_id, m.display_name); });
      b.line('');
    } else {
      b.line('สมาชิกทุกคนชำระครบแล้ว รายการนี้ปิดเรียบร้อย');
    }
  }
  return b.build();
}

const REASONS = {
  duplicate: 'สลิปนี้ถูกใช้ยืนยันการชำระไปแล้ว',
  not_found: 'ไม่พบรายการโอนนี้ในระบบธนาคาร (สลิปอาจไม่ถูกต้อง หรือเพิ่งโอนไม่นาน กรุณาลองส่งใหม่อีกครั้งในอีกสักครู่)',
  receiver: 'บัญชีผู้รับเงินในสลิปไม่ตรงกับผู้รับเงินของรายการที่ค้างชำระ',
  receiver_unknown: 'ไม่สามารถยืนยันบัญชีผู้รับเงินได้ เนื่องจากค้างชำระกับผู้รับเงินมากกว่าหนึ่งคน ผู้รับเงินกรุณาเพิ่มเลขบัญชีหรือชื่อบัญชีในหน้า "บัญชีรับเงิน" ของเว็บ',
  amount: 'ยอดเงินในสลิปไม่ตรงกับยอดที่ค้างชำระ',
  provider: 'ระบบตรวจสลิปขัดข้องชั่วคราว กรุณาส่งสลิปอีกครั้งภายหลัง',
};

/** @param dues [{title, amount}] รายการค้าง (ใช้แสดงเมื่อยอดไม่ตรง) */
export function paymentFailMessage(member, reason, { slipAmount, dues = [] } = {}) {
  const b = textV2();
  b.line('ไม่สามารถยืนยันการชำระเงินได้');
  b.mention(member.line_user_id, member.display_name);
  b.line('');
  b.line(`สาเหตุ: ${REASONS[reason] || REASONS.provider}`);
  if (reason === 'amount') {
    if (slipAmount != null) b.line(`ยอดในสลิป: ${formatBaht(slipAmount)}`);
    if (dues.length) {
      b.line('ยอดที่ค้างชำระ:');
      for (const d of dues) b.line(`- ${d.title} ${formatBaht(d.amount)}`);
    }
  }
  b.add('กรุณาตรวจสอบและส่งสลิปใหม่อีกครั้ง');
  return b.build();
}

/**
 * ข้อความทวงรายวัน แบ่งหลายข้อความถ้ายาวเกิน
 * @param groupDues [{ title, bill_date, payerName, debtors:[{member, amount}] }]
 */
export function reminderMessages(groupDues, url, today = new Date().toISOString()) {
  const header = `แจ้งเตือนยอดค้างชำระ ประจำวันที่ ${thDate(today)}`;
  const footer = [`ชำระผ่าน QR ได้ที่ ${url}`, 'เมื่อโอนแล้ว กรุณาส่งรูปสลิปในกลุ่มนี้ ระบบจะตรวจสอบให้อัตโนมัติ'];
  const total = round2(groupDues.reduce((s, g) => s + g.debtors.reduce((a, d) => a + Number(d.amount), 0), 0));

  const out = [];
  let b = textV2(); let mentions = 0;
  b.line(header); b.line('');
  const flush = () => { out.push(b.build()); b = textV2(); mentions = 0; b.line(`${header} (ต่อ)`); b.line(''); };

  for (const g of groupDues) {
    const blockLen = 80 + g.title.length + g.debtors.length * 40;
    if (b.length + blockLen > LIMIT || mentions + g.debtors.length > 20) flush();
    b.line(`${g.title} (${thDate(g.bill_date)}) ผู้รับเงิน ${g.payerName}`);
    for (const d of g.debtors) { b.mention(d.member.line_user_id, d.member.display_name); b.line(` ${formatBaht(d.amount)}`); mentions++; }
    b.line('');
  }
  b.line(`ยอดค้างชำระรวม ${formatBaht(total)}`);
  footer.forEach((l) => b.line(l));
  out.push(b.build());
  return out.slice(0, 5); // push ได้สูงสุด 5 ข้อความต่อครั้ง
}
