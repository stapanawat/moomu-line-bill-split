// โค้ดคำนวณที่ใช้ร่วมกันทั้งเว็บและเซิร์ฟเวอร์ (ESM, ไม่มี dependency)

/** ปัดเป็นสตางค์ */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * คำนวณยอดของแต่ละคน
 * - แต่ละรายการหารเท่ากันตามคนที่เลือก
 * - ค่าบริการ/VAT (%) และส่วนลด (บาท) กระจายตามสัดส่วนยอดของแต่ละคน
 * - ปัดเป็นสตางค์ และเกลี่ยเศษให้ผลรวมเท่ากับยอดรวมบิลพอดี
 * @param {{price:number|string, memberIds:string[]}[]} items
 * @param {number} servicePct
 * @param {number} discount
 */
export function computeShares(items, servicePct = 0, discount = 0) {
  const raw = {};
  let subtotal = 0;
  for (const it of items) {
    const price = Number(it.price) || 0;
    subtotal += price;
    const ids = it.memberIds || [];
    if (!ids.length) continue;
    for (const id of ids) raw[id] = (raw[id] || 0) + price / ids.length;
  }
  subtotal = round2(subtotal);
  const total = Math.max(0, round2(subtotal * (1 + (Number(servicePct) || 0) / 100) - (Number(discount) || 0)));
  const factor = subtotal > 0 ? total / subtotal : 0;

  const ids = Object.keys(raw);
  const shares = {};
  let sum = 0;
  for (const id of ids) { shares[id] = round2(raw[id] * factor); sum += shares[id]; }
  // เกลี่ยเศษสตางค์ไปที่คนที่ยอดมากที่สุด
  let diff = round2(total - sum);
  if (ids.length && diff !== 0) {
    const top = ids.reduce((a, b) => (shares[a] >= shares[b] ? a : b));
    shares[top] = round2(shares[top] + diff);
  }
  return { subtotal, total, shares };
}

// ---------------- PromptPay (EMVCo) ----------------

export function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

/** ตรวจรูปแบบเลขพร้อมเพย์: เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก */
export function normalizePromptPay(id) {
  const d = String(id || '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(d) || /^\d{13}$/.test(d)) return d;
  return null;
}

/** สร้างข้อความสำหรับ QR พร้อมเพย์ (มียอดเงินเมื่อ amount > 0) */
export function promptPayPayload(id, amount) {
  const d = normalizePromptPay(id);
  if (!d) throw new Error('invalid_promptpay');
  const f = (k, v) => k + String(v.length).padStart(2, '0') + v;
  const acc = d.length === 13 ? f('02', d) : f('01', ('0066' + d.slice(1)));
  const amt = Number(amount) > 0 ? f('54', round2(amount).toFixed(2)) : '';
  const p = f('00', '01') + f('01', amt ? '12' : '11') + f('29', f('00', 'A000000677010111') + acc) +
    f('53', '764') + amt + f('58', 'TH') + '6304';
  return p + crc16(p);
}

export const formatBaht = (n) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' บาท';
