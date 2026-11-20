/**
 * แปลงข้อความที่ได้จาก OCR ใบเสร็จ ให้เป็นรายการ ราคา วันที่ และยอดรวม
 * ทำงานได้ทั้งในเบราว์เซอร์และ Node (ไม่มี dependency) ผลลัพธ์เป็นค่าเริ่มต้นให้ผู้ใช้ตรวจแก้ ไม่ใช่ค่าสุดท้าย
 */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const THAI_MONTHS = [
  ['ม.ค', 'มกรา', 'jan'], ['ก.พ', 'กุมภา', 'feb'], ['มี.ค', 'มีนา', 'mar'], ['เม.ย', 'เมษา', 'apr'],
  ['พ.ค', 'พฤษภา', 'may'], ['มิ.ย', 'มิถุนา', 'jun'], ['ก.ค', 'กรกฎา', 'jul'], ['ส.ค', 'สิงหา', 'aug'],
  ['ก.ย', 'กันยา', 'sep'], ['ต.ค', 'ตุลา', 'oct'], ['พ.ย', 'พฤศจิกา', 'nov'], ['ธ.ค', 'ธันวา', 'dec'],
];

// บรรทัดที่ไม่ใช่รายการอาหาร (ยอดรวม ภาษี การชำระเงิน ข้อมูลร้าน)
const SKIP = /(sub\s*-?\s*total|grand|total|net\b|amount\s*due|balance|รวม|สุทธิ|ทั้งสิ้น|vat|ภาษี|tax|service|ค่าบริการ|เซอร์วิส|cash|เงินสด|รับเงิน|ทอน|change|discount|ส่?วนลด|ลดราคา|round|ปัดเศษ|credit|card|บัตร|visa|master|promptpay|พร้อมเพย์|qr|โอน|transfer|tel|โทร|fax|เลขประจำตัว|tax\s*id|pos\b|ใบเสร็จ|ใบกำกับ|receipt|invoice|bill\s*no|เลขที่|date|วันที่|time|เวลา|table|โต๊ะ|guest|cashier|พนักงาน|staff|member|สมาชิก|point|คะแนน|qty|จำนวน|items?\b|ชิ้น\s*$|thank|ขอบคุณ|www\.|\.com|deposit|มัดจำ)/i;
const TOTAL = /(grand\s*total|net\s*total|total\s*due|amount\s*due|^\s*ยอด|สุทธิ|รวมทั้งสิ้น|ราคาสุทธิ|^\s*total\b|รวมเงิน|^\s*รวม(?=[\s\d:]|$)|^\s*net\b)/i;
const SUBTOTAL = /(sub\s*-?\s*total|ยอดก่อน|รวมก่อน|ราคารวมก่อน)/i;
const LETTER = /[A-Za-zก-ฮ]/;
const PRICE_AT_END = /(-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)\s*(?:บาท|฿|thb|\.-|-|b)?\s*$/i;

/** ทำความสะอาดข้อความ: เลขไทย, ช่องว่างแทรกระหว่างอักษรไทย, ตัวอักษรที่ OCR อ่านผิดในตัวเลข */
export function normalizeOcrText(text) {
  return String(text || '')
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line
      .normalize('NFC')
      .replace(/\u0E4D\u0E32/g, '\u0E33') // "ํา" ที่ OCR แยกเป็นสองตัว -> "ำ"
      .replace(/([฀-๿])[ \t]+(?=[฀-๿])/g, '$1')
      .replace(/(\d)\s*[.,]\s*(\d{2})\b(?!\d)/g, '$1.$2') // "45 .00" -> "45.00"
      .replace(/(\d)\s+(\d{2})\s*$/, '$1.$2') // จุดทศนิยมหาย "120 00" -> "120.00"
      .replace(/(?<=\d)[Oo](?=\d|\b)/g, '0')
      .replace(/[|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

const toNumber = (s) => Number(String(s).replace(/,/g, ''));

/** แยกราคาท้ายบรรทัด คืน { name, price } หรือ null */
function splitPrice(line) {
  const m = line.match(PRICE_AT_END);
  if (!m) return null;
  const price = toNumber(m[1]);
  if (/:\s*$/.test(line.slice(0, m.index))) return null; // เวลา 12:10 ไม่ใช่ราคา
  const name = line.slice(0, m.index).replace(/[\s.:·•_=*@฿-]+$/, '').trim();
  return Number.isFinite(price) ? { name, price, hasDecimals: /\.\d{2}$/.test(m[1]) } : null;
}

function fullYear(y) {
  let n = Number(y);
  if (y.length <= 2) n = n >= 50 ? 2500 + n : 2000 + n; // 69 -> 2569 (พ.ศ.), 26 -> 2026
  if (n > 2400) n -= 543;
  return n;
}
function isoDate(y, m, d, today) {
  const year = fullYear(y), month = Number(m), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) return null;
  const t = today ? new Date(today + 'T00:00:00Z') : new Date();
  const diff = (t.getTime() - dt.getTime()) / 864e5;
  if (diff < -2 || diff > 800) return null; // ไม่อยู่ในอนาคต และไม่เก่ากว่า ~2 ปี
  return dt.toISOString().slice(0, 10);
}

/** หาวันที่ในใบเสร็จ รองรับ 20/11/2569, 20-11-26, 2026-11-20, 20 พ.ย. 69, 20 Nov 2026 */
export function findDate(lines, today) {
  for (const line of lines) {
    let m = line.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (m) { const r = isoDate(m[1], m[2], m[3], today); if (r) return r; }
    m = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (m) { const r = isoDate(m[3], m[2], m[1], today); if (r) return r; }
    const lower = line.toLowerCase();
    for (let i = 0; i < 12; i++) {
      for (const key of THAI_MONTHS[i]) {
        const at = lower.indexOf(key);
        if (at < 0) continue;
        const before = lower.slice(0, at).match(/(\d{1,2})\s*$/);
        const after = lower.slice(at).match(/^[^\d]*(\d{2,4})\b/);
        if (before && after) { const r = isoDate(after[1], String(i + 1), before[1], today); if (r) return r; }
      }
    }
  }
  return null;
}

/**
 * @param {string} text ข้อความดิบจาก OCR
 * @param {{ today?: string }} [opts]
 */
export function parseReceipt(text, opts = {}) {
  const lines = normalizeOcrText(text);
  const items = [];
  let total = null, subtotal = null, servicePct = null, discount = null, title = null, vatPct = null;

  for (const [idx, line] of lines.entries()) {
    const sp = splitPrice(line);
    const pct = line.match(/(service|ค่าบริการ|เซอร์วิส)[^\d]*(\d{1,2}(?:\.\d+)?)\s*%/i);
    if (pct) servicePct = Number(pct[2]);
    const vat = line.match(/(vat|ภาษี)[^\d]*(\d{1,2}(?:\.\d+)?)\s*%/i);
    if (vat) vatPct = Number(vat[2]);

    if (!sp) {
      if (!title && idx < 5 && (line.match(new RegExp(LETTER.source, 'g')) || []).length >= 3 && !SKIP.test(line) && !/\d{5,}/.test(line)) title = line.slice(0, 80);
      continue;
    }
    if (SUBTOTAL.test(line)) { if (sp.price > 0) subtotal = sp.price; continue; }
    if (TOTAL.test(line)) { if (sp.price > 0) total = sp.price; continue; }
    if (/(discount|ส่?วนลด|ลดราคา)/i.test(line)) { discount = (discount || 0) + Math.abs(sp.price); continue; }
    if (SKIP.test(line)) continue;
    if (findDate([line], opts.today)) continue;

    // ชื่อรายการต้องมีตัวอักษร ไม่ใช่เลขโทรศัพท์หรือวันที่
    let name = sp.name;
    if (!LETTER.test(name) || name.replace(/[^A-Za-zก-๎]/g, '').length < 2) continue;
    if (/\d{1,2}[/:]\d{2}/.test(name) && !sp.hasDecimals) continue;
    if (sp.price <= 0 || sp.price > 100000) continue;

    // จำนวนนำหน้า: "2 x ลาเต้", "2 ลาเต้" หรือ "ลาเต้ 2 x 65.00" (ตัดราคาต่อหน่วยออก)
    let qty = 1;
    let q = name.match(/^(\d{1,2})\s*[xX×*]?\s+(.+)$/);
    if (q && Number(q[1]) > 0 && Number(q[1]) <= 30 && LETTER.test(q[2][0])) { qty = Number(q[1]); name = q[2]; }
    q = name.match(/^(.*?)\s+(\d{1,2})\s*[xX×@%*]\s*\d+(?:\.\d{1,2})?$/); // OCR มักอ่าน x เป็น %
    if (q && LETTER.test(q[1])) { qty = Number(q[2]); name = q[1]; }
    q = name.match(/^(.*?)\s+(\d+(?:\.\d{1,2})?)$/); // ราคาต่อหน่วยค้างอยู่หน้าราคารวม
    if (q && LETTER.test(q[1]) && Number(q[2]) > 0 && Math.abs(Number(q[2]) * qty - sp.price) > 0.01 && Number.isInteger(sp.price / Number(q[2]))) {
      qty = sp.price / Number(q[2]); name = q[1];
    } else if (q && LETTER.test(q[1]) && Number(q[2]) * qty === sp.price) name = q[1];
    q = name.match(/^(.*?)\s+(\d{1,2})\s*[xX×]?$/); // "Thai Tea 3" ที่ 3 คือจำนวน
    if (q && LETTER.test(q[1]) && (qty === 1 || Number(q[2]) === qty)) { qty = Number(q[2]) || qty; name = q[1]; }

    name = name.replace(/^[\s\d.)#-]+(?=[A-Za-zก-ฮ])/, '').replace(/\s+/g, ' ').trim();
    if (name.length < 2) continue;
    items.push({ name: (qty > 1 ? `${name} x${qty}` : name).slice(0, 80), price: Math.round(sp.price * 100) / 100 });
  }

  const sum = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
  // VAT แยกท้ายบิล: รวม VAT เข้าในช่อง "ค่าบริการ / ภาษี (%)" ถ้าคำนวณแล้วยอดตรงกับใบเสร็จ
  let vatAdded = false;
  if (vatPct && total && sum > 0) {
    const d = discount || 0;
    const now = sum * (1 + (servicePct || 0) / 100) - d;
    const eff = Math.round(((total + d) / sum - 1) * 10000) / 100;
    const expected = ((1 + (servicePct || 0) / 100) * (1 + vatPct / 100) - 1) * 100; // ค่าบริการแล้วคิด VAT ซ้อน
    if (Math.abs(now - total) > 0.5 && Math.abs(eff - expected) <= 0.6 && Math.abs(sum * (1 + eff / 100) - d - total) <= 0.5) { servicePct = eff; vatAdded = true; }
  }
  return {
    title,
    date: findDate(lines, opts.today),
    items,
    itemsTotal: sum,
    subtotal,
    total,
    servicePct,
    discount,
    vatPct,
    vatAdded,
    lines,
  };
}
