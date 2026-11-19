// การ์ด Flex Message ของบอท (โทนทางการ ไม่ใช้อีโมจิ)
import { formatBaht } from '../../shared/billing.js';

export const COLORS = {
  green: '#06C755',
  teal: '#0E9F6E',
  amber: '#B7791F',
  red: '#C0352B',
  ink: '#1B2430',
  mute: '#6B7684',
  line: '#E3E7EC',
  paid: '#1C7A43',
  due: '#C0352B',
};

const MAX_ROWS = 15;
const money = (n) => formatBaht(n).replace(' บาท', '');
const clip = (s, n = 60) => { const t = String(s ?? '').trim() || '-'; return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export const text = (t, o = {}) => ({ type: 'text', text: clip(t, o.max || 200), wrap: true, ...omit(o, 'max') });
const omit = (o, k) => { const { [k]: _x, ...r } = o; return r; };
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents, ...o });
const sep = (margin = 'lg') => ({ type: 'separator', margin, color: COLORS.line });

function header(color, label, title, sub) {
  return box('vertical', [
    text(label, { color: '#FFFFFFCC', size: 'sm' }),
    text(title, { color: '#FFFFFF', size: 'xl', weight: 'bold', margin: 'sm', max: 80 }),
    ...(sub ? [text(sub, { color: '#FFFFFFE6', size: 'sm', margin: 'sm' })] : []),
  ], { backgroundColor: color, paddingAll: '20px' });
}

const kv = (k, v, o = {}) => box('horizontal', [
  text(k, { size: 'sm', color: COLORS.mute, flex: 4 }),
  text(v, { size: 'sm', color: COLORS.ink, align: 'end', flex: 6, weight: o.bold ? 'bold' : 'regular' }),
], { margin: o.margin || 'sm' });

/** แถวรายชื่อ: ชื่อ | ยอด | สถานะ */
function personRow(name, amount, status) {
  const st = {
    paid: { t: 'ชำระแล้ว', c: COLORS.paid },
    due: { t: 'รอชำระ', c: COLORS.due },
    payee: { t: 'ผู้รับเงิน', c: COLORS.mute },
  }[status];
  return box('horizontal', [
    text(name, { size: 'md', color: COLORS.ink, flex: 5, max: 30, gravity: 'center' }),
    text(money(amount), { size: 'md', color: COLORS.ink, weight: 'bold', align: 'end', flex: 3, gravity: 'center' }),
    ...(st ? [text(st.t, { size: 'xs', color: st.c, align: 'end', flex: 3, gravity: 'center', weight: 'bold' })] : []),
  ], { margin: 'md' });
}

function rows(list) {
  const shown = list.slice(0, MAX_ROWS).map((r) => personRow(r.name, r.amount, r.status));
  if (list.length > MAX_ROWS) shown.push(text(`และอีก ${list.length - MAX_ROWS} คน ดูทั้งหมดได้ในเว็บ`, { size: 'xs', color: COLORS.mute, margin: 'md' }));
  return shown;
}

const footer = (label, uri, color) => box('vertical', [
  { type: 'button', style: 'primary', color, height: 'sm', action: { type: 'uri', label, uri } },
], { paddingAll: '16px', paddingTop: '0px' });

const bubble = (h, body, f) => ({
  type: 'bubble', size: 'mega',
  header: h,
  body: box('vertical', body, { paddingAll: '20px' }),
  ...(f ? { footer: f } : {}),
});

export const flex = (altText, contents) => ({ type: 'flex', altText: clip(altText, 380), contents });

// ---------------- การ์ดแต่ละแบบ ----------------

/** บิลใหม่ */
export function newBillCard({ title, date, total, payerName, debtors, url }) {
  return bubble(
    header(COLORS.green, 'บันทึกบิลใหม่', title, date),
    [
      kv('ยอดรวมบิล', `${money(total)} บาท`, { bold: true, margin: 'none' }),
      kv('ผู้รับเงิน', payerName),
      sep(),
      text('ยอดที่ต้องชำระ', { size: 'sm', color: COLORS.mute, margin: 'lg' }),
      ...rows(debtors.map((d) => ({ name: d.name, amount: d.amount, status: 'due' }))),
      sep(),
      text('เมื่อโอนแล้ว กรุณาส่งรูปสลิปในกลุ่มนี้ ระบบจะตรวจสอบให้อัตโนมัติ', { size: 'xs', color: COLORS.mute, margin: 'lg' }),
    ],
    footer('ชำระเงิน / ดูใบเสร็จ', url, COLORS.green),
  );
}

/** ยืนยันการชำระ (แสดงสถานะทุกคนในบิล) */
export function paymentCard({ title, date, payerName, amountPaid, payerOfSlip, transRef, shares, url }) {
  const debt = shares.filter((s) => s.status !== 'payee');
  const paidN = debt.filter((s) => s.status === 'paid').length;
  const done = paidN === debt.length;
  return bubble(
    header(done ? COLORS.teal : COLORS.green, done ? `${title}` : 'ยืนยันการชำระเงิน', done ? 'ชำระครบแล้ว' : `${payerOfSlip} ชำระแล้ว`, done ? date : `${money(amountPaid)} บาท ให้ ${payerName}`),
    [
      ...(done ? [] : [kv('รายการ', title, { margin: 'none' }), kv('วันที่', date)]),
      kv('เลขอ้างอิง', transRef, done ? { margin: 'none' } : {}),
      kv('ความคืบหน้า', `ชำระแล้ว ${paidN}/${debt.length} คน`, { bold: true }),
      sep(),
      ...rows(shares),
    ],
    footer('ดูรายละเอียด', url, done ? COLORS.teal : COLORS.green),
  );
}

/** ตรวจสลิปไม่ผ่าน */
export function failCard({ name, reason, slipAmount, dues = [], url }) {
  return bubble(
    header(COLORS.red, 'ตรวจสอบสลิปไม่ผ่าน', name, 'ยังไม่ได้บันทึกการชำระเงิน'),
    [
      text('สาเหตุ', { size: 'sm', color: COLORS.mute }),
      text(reason, { size: 'md', color: COLORS.ink, margin: 'sm', max: 300 }),
      ...(slipAmount != null ? [sep(), kv('ยอดในสลิป', `${money(slipAmount)} บาท`, { bold: true, margin: 'lg' })] : []),
      ...(dues.length ? [
        text('ยอดที่ค้างชำระ', { size: 'sm', color: COLORS.mute, margin: 'lg' }),
        ...dues.slice(0, 8).map((d) => kv(d.title, `${money(d.amount)} บาท`)),
      ] : []),
      sep(),
      text('กรุณาตรวจสอบแล้วส่งสลิปใหม่อีกครั้ง', { size: 'xs', color: COLORS.mute, margin: 'lg' }),
    ],
    footer('ดู QR / ยอดค้าง', url, COLORS.red),
  );
}

/** สรุปยอดค้างรวม (การ์ดแรกของข้อความทวง) */
export function reminderSummaryCard({ dateText, total, people, billCount, url }) {
  return bubble(
    header(COLORS.amber, 'แจ้งเตือนยอดค้างชำระ', `${money(total)} บาท`, `ประจำวันที่ ${dateText}`),
    [
      kv('รายการที่ค้าง', `${billCount} รายการ`, { margin: 'none' }),
      sep(),
      text('ยอดค้างรายบุคคล', { size: 'sm', color: COLORS.mute, margin: 'lg' }),
      ...rows(people.map((p) => ({ name: p.name, amount: p.amount, status: 'due' }))),
      sep(),
      text('เมื่อโอนแล้ว กรุณาส่งรูปสลิปในกลุ่มนี้ ระบบจะตรวจสอบให้อัตโนมัติ', { size: 'xs', color: COLORS.mute, margin: 'lg' }),
    ],
    footer('ชำระผ่าน QR', url, COLORS.amber),
  );
}

/** รายละเอียดยอดค้างของแต่ละบิล */
export function reminderBillCard({ title, dateText, payerName, debtors, url }) {
  const sum = debtors.reduce((a, d) => a + Number(d.amount), 0);
  return bubble(
    header(COLORS.amber, dateText, title, `ผู้รับเงิน ${payerName}`),
    [
      kv('ค้างชำระรวม', `${money(sum)} บาท`, { bold: true, margin: 'none' }),
      sep(),
      ...rows(debtors.map((d) => ({ name: d.name, amount: d.amount, status: 'due' }))),
    ],
    footer('ชำระเงิน / ดูใบเสร็จ', url, COLORS.amber),
  );
}

/** ต้อนรับเมื่อบอทเข้ากลุ่ม */
export function welcomeCard({ url, remindTime }) {
  const step = (n, t) => box('horizontal', [
    text(String(n), { size: 'sm', color: COLORS.green, weight: 'bold', flex: 1 }),
    text(t, { size: 'sm', color: COLORS.ink, flex: 12 }),
  ], { margin: 'md' });
  return bubble(
    header(COLORS.green, 'ระบบหารบิล', 'พร้อมใช้งานในกลุ่มนี้', 'บันทึกบิล ชำระผ่าน QR ตรวจสลิปอัตโนมัติ'),
    [
      text('ขั้นตอนการใช้งาน', { size: 'sm', color: COLORS.mute }),
      step(1, 'สมาชิกทุกคนพิมพ์ข้อความใดก็ได้ในกลุ่มหนึ่งครั้ง เพื่อให้ระบบรู้จัก'),
      step(2, 'ผู้ที่ชำระบิลไปก่อน เปิดเว็บเพื่อบันทึกบิลและแนบใบเสร็จ'),
      step(3, 'สมาชิกสแกน QR ในเว็บเพื่อโอนเงิน แล้วส่งรูปสลิปในกลุ่ม'),
      step(4, `ระบบแจ้งเตือนผู้ที่ยังไม่ชำระทุกวัน เวลา ${remindTime} น.`),
      sep(),
      text('พิมพ์ "moomi" เพื่อขอลิงก์ หรือ "ยอดค้าง" เพื่อดูยอดคงค้าง', { size: 'xs', color: COLORS.mute, margin: 'lg' }),
    ],
    footer('เปิดเว็บหารบิล', url, COLORS.green),
  );
}

/** เมนูหลัก (ตอบเมื่อพิมพ์ moomi) */
export function menuCard({ groupName, url, dueTotal, dueBills, duePeople, remindTime }) {
  const btn = (action, style = 'secondary') => ({
    type: 'button', style, height: 'sm', margin: 'sm',
    ...(style === 'primary' ? { color: COLORS.green } : {}),
    action,
  });
  const link = (path) => `${url}${url.includes('?') ? '&' : '?'}tab=${path}`;
  const hasDue = dueTotal > 0.004;
  return {
    type: 'bubble', size: 'mega',
    header: header(COLORS.green, 'Moomi หารบิล', groupName || 'กลุ่ม LINE', 'บันทึกบิล ชำระผ่าน QR ตรวจสลิปอัตโนมัติ'),
    body: box('vertical', [
      box('horizontal', [
        box('vertical', [
          text('ยอดค้างชำระ', { size: 'xs', color: COLORS.mute }),
          text(hasDue ? `${money(dueTotal)}` : 'ไม่มี', { size: 'xl', weight: 'bold', color: hasDue ? COLORS.due : COLORS.paid, margin: 'xs' }),
          text(hasDue ? 'บาท' : 'ทุกคนชำระครบ', { size: 'xs', color: COLORS.mute }),
        ], { flex: 1 }),
        box('vertical', [
          text('รอชำระ', { size: 'xs', color: COLORS.mute, align: 'end' }),
          text(`${dueBills} บิล`, { size: 'lg', weight: 'bold', color: COLORS.ink, align: 'end', margin: 'xs' }),
          text(`${duePeople} คน`, { size: 'xs', color: COLORS.mute, align: 'end' }),
        ], { flex: 1 }),
      ], { backgroundColor: '#F4F6F8', cornerRadius: '12px', paddingAll: '14px' }),
      text('เลือกเมนูที่ต้องการ', { size: 'sm', color: COLORS.mute, margin: 'lg' }),
    ], { paddingAll: '20px', paddingBottom: '8px' }),
    footer: box('vertical', [
      btn({ type: 'uri', label: 'ดูรายการบิล', uri: link('bills') }, 'primary'),
      btn({ type: 'message', label: 'ดูยอดค้าง', text: 'ยอดค้าง' }),
      btn({ type: 'uri', label: 'สร้างบิลใหม่', uri: link('new') }),
      btn({ type: 'uri', label: 'สรุปยอดรายคน/ร้าน', uri: link('summary') }),
      text(`แจ้งเตือนผู้ที่ยังไม่ชำระทุกวัน ${remindTime} น.`, { size: 'xxs', color: COLORS.mute, align: 'center', margin: 'md' }),
    ], { paddingAll: '16px', paddingTop: '4px' }),
  };
}
