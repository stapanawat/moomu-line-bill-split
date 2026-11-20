// กติกาของบิล (pure functions ทดสอบได้): ตรวจข้อมูล, สิทธิ์แก้ไข/ยกเลิก, การเปลี่ยนแปลงยอด
import { computeShares, normalizePromptPay, round2 } from '../../shared/billing.js';

/**
 * ตรวจข้อมูลบิลจากเว็บ
 * @param body ข้อมูลจากเว็บ
 * @param memberIds Set ของ member id ในกลุ่ม
 * @param opts { hasQr: มีรูป QR อยู่แล้ว (กรณีแก้ไข) }
 * @returns { fields, data } fields = ข้อความผิดพลาดรายช่อง (ว่าง = ผ่าน)
 */
export function validateBill(body, memberIds, { hasQr = false } = {}) {
  const fields = {};
  const title = String(body.title || '').trim();
  if (!title) fields.title = 'กรุณาระบุชื่อรายการหรือชื่อร้าน';
  else if (title.length > 120) fields.title = 'ชื่อรายการยาวเกิน 120 ตัวอักษร';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) fields.date = 'กรุณาระบุวันที่';
  if (!memberIds.has(body.payerId)) fields.payerId = 'กรุณาเลือกผู้รับเงิน';
  const pp = body.promptpayId ? normalizePromptPay(body.promptpayId) : null;
  if (body.promptpayId && !pp) fields.promptpayId = 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก';
  if (!pp && !body.qrImage && !hasQr) fields.promptpayId = fields.promptpayId || 'กรุณาระบุเลขพร้อมเพย์ หรือแนบรูป QR สำหรับรับเงิน';
  const servicePct = Number(body.servicePct) || 0;
  const discount = Number(body.discount) || 0;
  if (servicePct < 0 || servicePct > 100) fields.servicePct = 'ค่าบริการต้องอยู่ระหว่าง 0–100%';
  if (discount < 0) fields.discount = 'ส่วนลดต้องไม่ติดลบ';

  const items = (Array.isArray(body.items) ? body.items : [])
    .map((i) => ({ name: String(i.name || '').trim(), price: round2(Number(i.price) || 0), memberIds: [...new Set(i.memberIds || [])] }))
    .filter((i) => i.name || i.price);
  if (!items.length) fields.items = 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ';
  items.forEach((it, idx) => {
    if (!it.name) fields[`items.${idx}.name`] = `รายการที่ ${idx + 1}: กรุณาระบุชื่อ`;
    if (!(it.price > 0)) fields[`items.${idx}.price`] = `รายการที่ ${idx + 1}: ราคาต้องมากกว่า 0`;
    if (!it.memberIds.length) fields[`items.${idx}.members`] = `รายการที่ ${idx + 1}: กรุณาเลือกผู้ร่วมจ่ายอย่างน้อย 1 คน`;
    if (it.memberIds.some((m) => !memberIds.has(m))) fields[`items.${idx}.members`] = `รายการที่ ${idx + 1}: มีสมาชิกที่ไม่อยู่ในกลุ่ม`;
  });
  const calc = computeShares(items, servicePct, discount);
  if (items.length && calc.total <= 0) fields.discount = 'ยอดรวมหลังหักส่วนลดต้องมากกว่า 0';
  return { fields, data: { title, date: body.date, payerId: body.payerId, pp, servicePct, discount, items, calc } };
}

/** ผู้ที่แก้ไข/ยกเลิกบิลได้: ผู้สร้างบิล (ถ้าไม่ทราบผู้สร้าง = ผู้รับเงิน) หรือผู้ดูแลระบบ */
export function canManageBill(me, bill, adminUserIds = []) {
  if (!me || !bill) return false;
  if (!me.line_user_id) return true;                                  // ผู้ดูแลที่ไม่ได้อยู่ในกลุ่ม
  if (adminUserIds.includes(me.line_user_id)) return true;
  if (bill.created_by) return bill.created_by === me.id;
  return bill.payer_member_id === me.id;
}

/** มีสมาชิก (ที่ไม่ใช่ผู้รับเงิน) ชำระแล้วหรือยัง */
export const billHasPayments = (bill) =>
  (bill.bill_shares || []).some((s) => s.paid_at && s.member_id !== bill.payer_member_id);

/** เทียบว่าข้อมูลที่กระทบยอดเงินเปลี่ยนหรือไม่ (ผู้รับเงิน พร้อมเพย์ ค่าบริการ ส่วนลด รายการ ผู้ร่วมจ่าย) */
export function financialChanged(bill, data) {
  const cur = {
    payer: bill.payer_member_id,
    pp: bill.promptpay_id || null,
    svc: round2(Number(bill.service_pct) || 0),
    disc: round2(Number(bill.discount) || 0),
    items: [...(bill.bill_items || [])].sort((a, b) => a.position - b.position)
      .map((i) => `${i.name}|${round2(Number(i.price))}|${i.bill_item_shares.map((s) => s.member_id).sort().join(',')}`),
  };
  const next = {
    payer: data.payerId,
    pp: data.pp || null,
    svc: round2(data.servicePct),
    disc: round2(data.discount),
    items: data.items.map((i) => `${i.name}|${round2(i.price)}|${[...i.memberIds].sort().join(',')}`),
  };
  return JSON.stringify(cur) !== JSON.stringify(next);
}
