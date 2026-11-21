// ข้อมูลตัวอย่างสำหรับทดลองหน้าเว็บโดยไม่ต้องต่อ LINE / เซิร์ฟเวอร์ (npm run dev:mock)
// เพิ่ม ?mockError=session หรือ ?mockError=bills ใน URL เพื่อดูหน้าตาการแจ้งข้อผิดพลาด
import { computeShares, normalizePromptPay, round2 } from '../../../shared/billing.js';
import { ApiError, type Api } from './api';
import type { BillDetail, BillSummary, Member, MemberPreset, NewBillInput } from '../types';
import type { LiveEvent } from './live';

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const mockError = new URLSearchParams(location.search).get('mockError');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

function receiptSvg(title: string, items: { name: string; price: number }[], total: number) {
  const rows = items.map((it, i) =>
    `<text x="40" y="${200 + i * 44}" font-size="26">${it.name}</text><text x="560" y="${200 + i * 44}" font-size="26" text-anchor="end">${it.price.toFixed(2)}</text>`).join('');
  const h = 330 + items.length * 44;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${h}" font-family="monospace"><rect width="600" height="${h}" fill="#fffef9"/><text x="300" y="80" font-size="32" text-anchor="middle" font-weight="bold">${title}</text><text x="300" y="118" font-size="20" text-anchor="middle" fill="#777">ใบเสร็จรับเงิน (ตัวอย่าง)</text><line x1="40" y1="148" x2="560" y2="148" stroke="#999" stroke-dasharray="6"/>${rows}<line x1="40" y1="${h - 110}" x2="560" y2="${h - 110}" stroke="#999" stroke-dasharray="6"/><text x="40" y="${h - 60}" font-size="30" font-weight="bold">รวม</text><text x="560" y="${h - 60}" font-size="30" text-anchor="end" font-weight="bold">${total.toFixed(2)}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function slipSvg(from: string, to: string, amount: number, ref: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="820" font-family="sans-serif"><rect width="600" height="820" fill="#f5f8fd"/><rect width="600" height="150" fill="#1f4e8c"/><text x="300" y="92" fill="#fff" font-size="38" text-anchor="middle" font-weight="bold">โอนเงินสำเร็จ</text><text x="50" y="240" font-size="24" fill="#666">จาก</text><text x="50" y="282" font-size="32">${from}</text><text x="50" y="360" font-size="24" fill="#666">ไปยัง</text><text x="50" y="402" font-size="32">${to}</text><text x="50" y="480" font-size="24" fill="#666">จำนวนเงิน</text><text x="50" y="540" font-size="52" font-weight="bold" fill="#1f4e8c">${amount.toFixed(2)} บาท</text><text x="50" y="640" font-size="22" fill="#888">เลขอ้างอิง ${ref}</text><text x="300" y="790" font-size="20" text-anchor="middle" fill="#aaa">สลิปตัวอย่าง</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const members: Member[] = [
  { id: 'm1', name: 'มายด์', promptpayId: '0812345678' },
  { id: 'm2', name: 'Fern', promptpayId: '0898765432' },
  { id: 'm3', name: 'ต้นกล้า' },
  { id: 'm4', name: 'Bank', promptpayId: '0861112233' },
  { id: 'm5', name: 'แพรว' },
  { id: 'm6', name: 'โอ๊ต' },
];
const ME = 'm3';
const byId = (id: string) => members.find((m) => m.id === id)!;

let seq = 10;
const listeners = new Set<(e: LiveEvent) => void>();
const emit = (e: LiveEvent) => listeners.forEach((l) => l({ ...e, at: Date.now() }));

/** ใช้ทดสอบในโหมดตัวอย่าง: window.mockPayment('m4') = จำลองว่า Bank ส่งสลิปผ่าน */
(window as unknown as { mockPayment: (memberId: string) => void }).mockPayment = (memberId: string) => {
  const b = bills.find((x) => x.status !== 'cancelled' && x.shares.some((s) => s.memberId === memberId && !s.paidAt && !s.isPayer));
  if (b) payMember(b, memberId);
};

function payMember(b: BillDetail, memberId: string) {
  const s = b.shares.find((x) => x.memberId === memberId)!;
  s.paidAt = new Date().toISOString();
  s.transRef = 'MOCKLIVE' + Date.now();
  s.slipUrl = slipSvg(byId(memberId).name, byId(b.payerId).name, s.amount, s.transRef);
  const debt = b.shares.filter((x) => !x.isPayer);
  b.paidCount = debt.filter((x) => x.paidAt).length;
  b.dueAmount = round2(debt.filter((x) => !x.paidAt).reduce((a, x) => a + x.amount, 0));
  if (b.paidCount === b.debtorCount) b.status = 'settled';
  emit({ type: 'payment', billIds: [b.id], memberId, message: `${byId(memberId).name} ชำระเงิน ${s.amount.toFixed(2)} บาท เรียบร้อยแล้ว` });
  return s;
}
let presets: MemberPreset[] = [
  { id: 'p1', name: 'แก๊งคาเฟ่', memberIds: ['m1', 'm2', 'm3', 'm4'] },
  { id: 'p2', name: 'ทริปเชียงใหม่', memberIds: ['m1', 'm2', 'm3', 'm4', 'm5'] },
];
const bills: BillDetail[] = [];

function addBill(input: NewBillInput, paid: string[] = [], daysOld = 0, createdBy: string = ME): BillDetail {
  const calc = computeShares(input.items, input.servicePct, input.discount);
  const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const shares = Object.entries(calc.shares).map(([memberId, amount]) => {
    const isPayer = memberId === input.payerId;
    const isPaid = isPayer || paid.includes(memberId);
    const ref = `MOCK${seq}${memberId.toUpperCase()}`;
    return {
      memberId, amount, isPayer,
      paidAt: isPaid ? new Date().toISOString() : null,
      slipUrl: isPaid && !isPayer ? slipSvg(byId(memberId).name, byId(input.payerId).name, amount, ref) : null,
      transRef: isPaid && !isPayer ? ref : null,
    };
  });
  const debt = shares.filter((s) => !s.isPayer);
  const bill: BillDetail = {
    id, title: input.title, date: input.date, total: calc.total, payerId: input.payerId,
    status: debt.every((s) => s.paidAt) ? 'settled' : 'open',
    debtorCount: debt.length, paidCount: debt.filter((s) => s.paidAt).length,
    dueAmount: round2(debt.filter((s) => !s.paidAt).reduce((a, s) => a + s.amount, 0)),
    hasReceipt: Boolean(input.receiptImage), itemNames: input.items.map((i) => i.name),
    memberIds: shares.map((s) => s.memberId),
    promptpayId: normalizePromptPay(input.promptpayId), servicePct: input.servicePct, discount: input.discount,
    receiptUrl: input.receiptImage || null, qrUrl: input.qrImage || null,
    createdAt: new Date(Date.now() - daysOld * 864e5).toISOString(),
    createdBy, canManage: false, hasPayments: false,
    items: input.items, shares,
  };
  bills.unshift(bill);
  return bill;
}

(function seed() {
  const a = [
    { name: 'ลาเต้เย็น', price: 120, memberIds: ['m1'] }, { name: 'อเมริกาโน่', price: 95, memberIds: ['m2'] },
    { name: 'มัทฉะลาเต้', price: 135, memberIds: ['m3'] }, { name: 'ครัวซองต์', price: 110, memberIds: ['m1', 'm2', 'm3', 'm4'] },
    { name: 'ช็อกโกแลตเย็น', price: 115, memberIds: ['m4'] },
  ];
  const b = [
    { name: 'ข้าวซอยไก่ x3', price: 240, memberIds: ['m1', 'm3', 'm5'] }, { name: 'ข้าวซอยเนื้อ', price: 90, memberIds: ['m2'] },
    { name: 'ข้าวซอยหมู', price: 80, memberIds: ['m4'] }, { name: 'ไส้อั่ว', price: 150, memberIds: ['m1', 'm2', 'm3', 'm4', 'm5'] },
  ];
  const c = [
    { name: 'Eggs Benedict', price: 280, memberIds: ['m2'] }, { name: 'Pancake', price: 220, memberIds: ['m5'] },
    { name: 'Big Breakfast', price: 320, memberIds: ['m6'] }, { name: 'Cold Brew x3', price: 270, memberIds: ['m2', 'm5', 'm6'] },
  ];
  addBill({ title: 'Brunch Café Ari', date: daysAgo(6), payerId: 'm2', promptpayId: '0898765432', servicePct: 0, discount: 50, items: c, receiptImage: receiptSvg('Brunch Cafe Ari', c, 1040) }, ['m5', 'm6'], 6, 'm2');
  addBill({ title: 'ทริปเชียงใหม่ มื้อเย็น', date: daysAgo(1), payerId: 'm4', promptpayId: '0861112233', servicePct: 10, discount: 0, items: b, receiptImage: receiptSvg('Khao Soi House', b, 616) }, ['m1', 'm5'], 1, 'm4');
  // ต้นกล้า (ผู้ใช้ตัวอย่าง) บันทึกบิลนี้ให้มายด์ ซึ่งเป็นผู้รับเงิน และมี Fern ชำระแล้ว -> แก้ได้เฉพาะชื่อ/วันที่/ใบเสร็จ
  addBill({ title: 'Roast Coffee นิมมาน', date: daysAgo(0), payerId: 'm1', promptpayId: '0812345678', servicePct: 0, discount: 0, items: a, receiptImage: receiptSvg('Roast Coffee', a, 575) }, ['m2'], 0, ME);
})();

const summaryOf = (b: BillDetail) => {
  const { promptpayId, servicePct, discount, receiptUrl, qrUrl, createdAt, items, shares, createdBy, canManage, hasPayments, ...s } = b;
  void promptpayId; void servicePct; void discount; void receiptUrl; void qrUrl; void createdAt; void items; void shares; void createdBy; void canManage; void hasPayments;
  return s;
};
const active = () => bills.filter((b) => b.status !== 'cancelled');

/** สร้างบิลใหม่จากข้อมูลที่แก้ไข โดยคงสถานะการชำระของคนที่จ่ายแล้ว */
function rebuild(b: BillDetail, input: NewBillInput) {
  const paid = b.shares.filter((s) => s.paidAt && !s.isPayer).map((s) => s.memberId);
  const fresh = addBill({ ...input, receiptImage: input.receiptImage === undefined ? b.receiptUrl : input.receiptImage, qrImage: input.qrImage === undefined ? b.qrUrl : input.qrImage }, paid, 0, b.createdBy ?? ME);
  bills.splice(bills.indexOf(fresh), 1);
  Object.assign(b, { ...fresh, id: b.id, createdAt: b.createdAt, createdBy: b.createdBy, updatedAt: new Date().toISOString() });
}

export const mockApi: Api = {
  async session() {
    await wait();
    if (mockError === 'session') throw new ApiError(403, { code: 'not_member', message: 'ไม่พบชื่อของท่านในกลุ่มนี้ กรุณาพิมพ์ข้อความใดก็ได้ในกลุ่ม LINE หนึ่งครั้ง แล้วเปิดเว็บใหม่' });
    return { group: { name: 'แก๊งคาเฟ่ฮอปปิ้ง (ตัวอย่าง)' }, me: byId(ME), members: [...members], remindTime: '18:00' };
  },
  async listBills({ q, from, to, scope }) {
    await wait();
    if (mockError === 'bills') throw new ApiError(0, { code: 'network', message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง' });
    const t = (q || '').toLowerCase();
    const pool = scope === 'active' ? bills.filter((b) => b.status === 'open')
      : scope === 'history' ? bills.filter((b) => b.status !== 'open') : active();
    const myStatus = (b: BillDetail) => (b.payerId === ME ? 'payee' : !b.shares.some((s) => s.memberId === ME) ? 'none' : b.shares.find((s) => s.memberId === ME)!.paidAt ? 'paid' : 'due') as BillSummary['myStatus'];
    return pool
      .filter((b) => (!from || b.date >= from) && (!to || b.date <= to))
      .filter((b) => !t || [b.title, ...b.itemNames, ...b.memberIds.map((id) => byId(id).name)].join(' ').toLowerCase().includes(t))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((b) => ({ ...summaryOf(b), myStatus: myStatus(b) }));
  },
  async getBill(id) {
    await wait(250);
    const b = bills.find((x) => x.id === id);
    if (!b) throw new ApiError(404, { code: 'bill_not_found', message: 'ไม่พบรายการนี้' });
    const hasPayments = b.shares.some((s) => s.paidAt && !s.isPayer);
    return structuredClone({ ...b, hasPayments, canManage: b.status !== 'cancelled' && b.createdBy === ME });
  },
  async updateBill(id, input) {
    await wait(600);
    const b = bills.find((x) => x.id === id);
    if (!b || b.status === 'cancelled') throw new ApiError(409, { code: 'bill_not_editable', message: 'บิลนี้ถูกยกเลิกไปแล้ว' });
    if (b.createdBy !== ME) throw new ApiError(403, { code: 'forbidden', message: 'แก้ไขหรือยกเลิกบิลได้เฉพาะผู้ที่สร้างบิลนี้' });
    if (!input.title.trim()) throw new ApiError(400, { code: 'validation', message: 'กรุณาตรวจสอบข้อมูลให้ครบถ้วน', fields: { title: 'กรุณาระบุชื่อรายการหรือชื่อร้าน' } });
    const key = (x: { name: string; price: number; memberIds: string[] }[]) => JSON.stringify(x.map((i) => [i.name, Number(i.price), [...i.memberIds].sort()]));
    const financial = key(b.items) !== key(input.items) || b.payerId !== input.payerId || (b.promptpayId ?? '') !== (normalizePromptPay(input.promptpayId) ?? '')
      || b.servicePct !== input.servicePct || b.discount !== input.discount;
    const hasPayments = b.shares.some((s) => s.paidAt && !s.isPayer);
    if (financial && hasPayments) throw new ApiError(409, { code: 'bill_locked', message: 'มีสมาชิกชำระเงินแล้ว จึงแก้ไขยอดเงินหรือรายการไม่ได้ หากต้องการแก้ยอด กรุณายกเลิกบิลนี้แล้วสร้างใหม่' });
    if (financial) rebuild(b, input);
    else {
      Object.assign(b, { title: input.title, date: input.date, updatedAt: new Date().toISOString() });
      if (input.receiptImage !== undefined) Object.assign(b, { receiptUrl: input.receiptImage, hasReceipt: Boolean(input.receiptImage) });
    }
    emit({ type: 'bill_updated', billIds: [id], message: `${byId(ME).name} แก้ไขบิล "${input.title}"` });
    return { ok: true as const, financial, announced: financial };
  },
  async cancelBill(id, reason) {
    await wait(500);
    const b = bills.find((x) => x.id === id);
    if (!b || b.status === 'cancelled') throw new ApiError(409, { code: 'bill_not_editable', message: 'บิลนี้ถูกยกเลิกไปแล้ว' });
    if (b.createdBy !== ME) throw new ApiError(403, { code: 'forbidden', message: 'แก้ไขหรือยกเลิกบิลได้เฉพาะผู้ที่สร้างบิลนี้' });
    Object.assign(b, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: reason || null });
    emit({ type: 'bill_updated', billIds: [id], message: `${byId(ME).name} ยกเลิกบิล "${b.title}"` });
    return { ok: true as const, announced: true };
  },
  async createBill(input) {
    await wait(600);
    const fields: Record<string, string> = {};
    if (!input.title.trim()) fields.title = 'กรุณาระบุชื่อรายการหรือชื่อร้าน';
    if (!input.promptpayId && !input.qrImage) fields.promptpayId = 'กรุณาระบุเลขพร้อมเพย์ หรือแนบรูป QR สำหรับรับเงิน';
    else if (input.promptpayId && !normalizePromptPay(input.promptpayId)) fields.promptpayId = 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก';
    if (!input.items.length) fields.items = 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ';
    if (Object.keys(fields).length) throw new ApiError(400, { code: 'validation', message: 'กรุณาตรวจสอบข้อมูลให้ครบถ้วน', fields });
    const b = addBill({ ...input, receiptImage: input.receiptImage });
    emit({ type: 'bill_created', billIds: [b.id], message: `${byId(ME).name} บันทึกบิลใหม่ "${b.title}"` });
    return { id: b.id, announced: true };
  },
  async summary({ from, to }) {
    await wait();
    const per = new Map<string, { memberId: string; total: number; paid: number; due: number; dueBills: { billId: string; title: string; date: string; amount: number; payerName: string }[] }>();
    for (const b of active().filter((x) => (!from || x.date >= from) && (!to || x.date <= to))) {
      for (const s of b.shares) {
        if (s.isPayer) continue;
        const r = per.get(s.memberId) || { memberId: s.memberId, total: 0, paid: 0, due: 0, dueBills: [] };
        r.total += s.amount;
        if (s.paidAt) r.paid += s.amount;
        else { r.due += s.amount; r.dueBills.push({ billId: b.id, title: b.title, date: b.date, amount: s.amount, payerName: byId(b.payerId).name }); }
        per.set(s.memberId, r);
      }
    }
    const rows = [...per.values()].map((r) => ({ ...r, total: round2(r.total), paid: round2(r.paid), due: round2(r.due) })).sort((a, b) => b.due - a.due);
    const sum = (k: 'total' | 'paid' | 'due') => round2(rows.reduce((a, r) => a + r[k], 0));
    const list = active().filter((x) => (!from || x.date >= from) && (!to || x.date <= to)).map((b) => ({
      id: b.id, title: b.title, date: b.date, total: b.total, payerId: b.payerId,
      shares: b.shares.map((s) => ({ memberId: s.memberId, amount: s.amount, paid: Boolean(s.paidAt), isPayer: s.isPayer })),
    }));
    return { rows, totals: { total: sum('total'), paid: sum('paid'), due: sum('due') }, bills: list };
  },
  async updatePayment(p) {
    await wait();
    if (p.promptpayId && !normalizePromptPay(p.promptpayId)) {
      throw new ApiError(400, { code: 'validation', message: 'กรุณาตรวจสอบข้อมูลบัญชีรับเงิน', fields: { promptpayId: 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก' } });
    }
    const me = byId(ME);
    Object.assign(me, { promptpayId: normalizePromptPay(p.promptpayId), bankAccount: p.bankAccount || null, accountName: p.accountName || null });
    return { ...me };
  },
  async clientLog(event, info) { (window as unknown as { __clientLog?: unknown[] }).__clientLog = [...((window as unknown as { __clientLog?: unknown[] }).__clientLog || []), { event, info }]; },
  async createDownload(image, name) {
    await wait(300);
    return { url: image, name };
  },
  async uploadSlip(billId, image, memberId) {
    await wait(1200);
    const b = bills.find((x) => x.id === billId);
    const who = memberId || ME;
    const share = b?.shares.find((s) => s.memberId === who && !s.isPayer);
    if (!b || !share) throw new ApiError(400, { code: 'no_share', message: 'สมาชิกนี้ไม่มียอดที่ต้องชำระในบิลนี้' });
    if (share.paidAt) throw new ApiError(400, { code: 'already_paid', message: 'รายการนี้ชำระเรียบร้อยแล้ว' });
    if (!image) throw new ApiError(400, { code: 'validation', message: 'กรุณาแนบรูปสลิป (JPG หรือ PNG)' });
    if (new URLSearchParams(location.search).get('mockError') === 'slip') {
      throw new ApiError(400, { code: 'slip_amount', message: 'ยอดเงินในสลิปไม่ตรงกับยอดที่ค้างชำระ (ยอดในสลิป 100.00 บาท ยอดที่ต้องชำระ 162.50 บาท)' });
    }
    const s = payMember(b, who);
    return { ok: true as const, amount: s.amount, transRef: s.transRef!, announced: true };
  },
  subscribe(onEvent, onStatus) {
    listeners.add(onEvent);
    setTimeout(() => onStatus('live'), 300);
    return () => { listeners.delete(onEvent); };
  },
  async listPresets() { await wait(200); return presets.map((p) => ({ ...p })); },
  async savePreset({ name, memberIds }) {
    await wait(300);
    const fields: Record<string, string> = {};
    if (!name.trim()) fields.name = 'กรุณาตั้งชื่อชุดรายชื่อ';
    if (memberIds.length < 2) fields.memberIds = 'ชุดรายชื่อต้องมีสมาชิกอย่างน้อย 2 คน';
    if (Object.keys(fields).length) throw new ApiError(400, { code: 'validation', message: 'ไม่สามารถบันทึกชุดรายชื่อได้', fields });
    const existing = presets.find((p) => p.name === name.trim());
    if (existing) { existing.memberIds = [...memberIds]; return { ...existing }; }
    const p = { id: 'p' + Date.now(), name: name.trim(), memberIds: [...memberIds] };
    presets = [...presets, p].sort((a, b) => a.name.localeCompare(b.name, 'th'));
    return p;
  },
  async deletePreset(id) { await wait(200); presets = presets.filter((p) => p.id !== id); },
  async syncMembers() {
    await wait(700);
    if (!members.find((m) => m.id === 'm7')) members.push({ id: 'm7', name: 'Nook' });
    return { members: [...members], fullList: false };
  },
};
