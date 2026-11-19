// API สำหรับเว็บ (LIFF)
import crypto from 'node:crypto';
import * as db from './db.js';
import * as line from './line.js';
import * as msg from './messages.js';
import { config, liffUrl } from './config.js';
import { HttpError, readJson, parseDataUrl } from './http.js';
import { computeShares, normalizePromptPay, round2 } from '../../shared/billing.js';
import { ensureMember } from './services.js';
import { publish, subscribe } from './events.js';

// ---------------- auth ----------------
/** ตรวจตัวตนผู้ใช้จาก LIFF ID token คืน LINE userId */
async function authUser(req) {
  if (config.devAuthUserId) return config.devAuthUserId;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'no_token', 'กรุณาเข้าสู่ระบบด้วย LINE');
  const info = await line.verifyIdToken(token);
  if (!info) throw new HttpError(401, 'invalid_token', 'การเข้าสู่ระบบหมดอายุ กรุณาปิดแล้วเปิดเว็บใหม่อีกครั้ง');
  return info.sub;
}

/** กลุ่มที่ผู้ใช้เข้าได้ (ผู้ดูแลเห็นทุกกลุ่ม) */
async function myGroups(req) {
  const userId = await authUser(req);
  const isAdmin = config.adminUserIds.includes(userId);
  const groups = isAdmin ? await db.listActiveGroups() : await db.listGroupsOfUser(userId);
  return {
    userId,
    isAdmin,
    groups: groups.map((g) => ({ key: g.access_key, name: g.name || 'กลุ่ม LINE' })).sort((a, b) => a.name.localeCompare(b.name, 'th')),
  };
}

export async function auth(req, url) {
  const key = url.searchParams.get('g');
  if (!key) throw new HttpError(400, 'no_group', 'ไม่พบรหัสกลุ่ม กรุณาเปิดเว็บจากลิงก์ที่บอทส่งในกลุ่ม LINE');
  const group = await db.getGroupByKey(key);
  if (!group) throw new HttpError(404, 'group_not_found', 'ไม่พบกลุ่มนี้ หรือบอทถูกนำออกจากกลุ่มแล้ว');

  const userId = await authUser(req);
  let me = await db.getMember(group.id, userId);
  if (!me && config.adminUserIds.includes(userId)) {
    // ผู้ดูแลที่ไม่ได้อยู่ในกลุ่ม: เข้าดูได้ในฐานะผู้ดูแล
    me = { id: '00000000-0000-0000-0000-000000000000', display_name: 'ผู้ดูแลระบบ', picture_url: null };
  }
  if (!me) {
    // ลองตรวจกับ LINE ว่าเป็นสมาชิกกลุ่มจริงหรือไม่
    try {
      await line.getGroupMemberProfile(group.line_group_id, userId);
      me = await ensureMember(group, userId);
    } catch {
      throw new HttpError(403, 'not_member', 'ไม่พบชื่อของท่านในกลุ่มนี้ กรุณาพิมพ์ข้อความใดก็ได้ในกลุ่ม LINE หนึ่งครั้ง แล้วเปิดเว็บใหม่');
    }
  }
  return { group, me };
}

const memberOut = (m) => ({
  id: m.id,
  name: m.display_name,
  pictureUrl: m.picture_url,
  promptpayId: m.promptpay_id,
  bankAccount: m.bank_account,
  accountName: m.account_name,
});

function billSummary(b) {
  const shares = b.bill_shares.filter((s) => s.member_id !== b.payer_member_id);
  return {
    id: b.id,
    title: b.title,
    date: b.bill_date,
    total: Number(b.total),
    payerId: b.payer_member_id,
    status: b.status,
    debtorCount: shares.length,
    paidCount: shares.filter((s) => s.paid_at).length,
    dueAmount: round2(shares.filter((s) => !s.paid_at).reduce((a, s) => a + Number(s.amount), 0)),
    hasReceipt: Boolean(b.receipt_path),
    itemNames: b.bill_items.map((i) => i.name),
    memberIds: b.bill_shares.map((s) => s.member_id),
  };
}

// ---------------- handlers ----------------
async function session(req, url) {
  const { group, me } = await auth(req, url);
  const members = await db.listMembers(group.id);
  return { group: { name: group.name || 'กลุ่ม LINE' }, me: memberOut(me), members: members.map(memberOut), remindTime: config.remind.time };
}

async function listBills(req, url) {
  const { group } = await auth(req, url);
  const from = url.searchParams.get('from') || undefined;
  const to = url.searchParams.get('to') || undefined;
  const text = (url.searchParams.get('q') || '').trim().toLowerCase();
  const [bills, members] = await Promise.all([db.listBills(group.id, { from, to }), db.listMembers(group.id)]);
  const names = new Map(members.map((m) => [m.id, m.display_name]));
  let list = bills.map(billSummary);
  if (text) {
    list = list.filter((b) =>
      [b.title, ...b.itemNames, ...b.memberIds.map((id) => names.get(id) || '')].join(' ').toLowerCase().includes(text));
  }
  return { bills: list };
}

async function getBill(req, url, id) {
  const { group } = await auth(req, url);
  const b = await db.getBill(group.id, id);
  if (!b) throw new HttpError(404, 'bill_not_found', 'ไม่พบรายการนี้');
  const payIds = b.bill_shares.map((s) => s.payment_id).filter(Boolean);
  const payments = await db.listPayments(group.id, payIds);
  const payById = new Map(payments.map((p) => [p.id, p]));
  const urls = await db.signedUrls([b.receipt_path, b.qr_path, ...payments.map((p) => p.slip_path)]);
  return {
    bill: {
      ...billSummary(b),
      promptpayId: b.promptpay_id,
      servicePct: Number(b.service_pct),
      discount: Number(b.discount),
      receiptUrl: urls[b.receipt_path] || null,
      qrUrl: urls[b.qr_path] || null,
      createdAt: b.created_at,
      items: b.bill_items.sort((x, y) => x.position - y.position).map((i) => ({
        name: i.name, price: Number(i.price), memberIds: i.bill_item_shares.map((s) => s.member_id),
      })),
      shares: b.bill_shares.map((s) => {
        const p = payById.get(s.payment_id);
        return {
          memberId: s.member_id,
          amount: Number(s.amount),
          paidAt: s.paid_at,
          isPayer: s.member_id === b.payer_member_id,
          slipUrl: p ? urls[p.slip_path] || null : null,
          transRef: p?.trans_ref || null,
        };
      }),
    },
  };
}

async function createBill(req, url) {
  const { group, me } = await auth(req, url);
  const body = await readJson(req);
  const members = await db.listMembers(group.id);
  const memberIds = new Set(members.map((m) => m.id));

  const fields = {};
  const title = String(body.title || '').trim();
  if (!title) fields.title = 'กรุณาระบุชื่อรายการหรือชื่อร้าน';
  else if (title.length > 120) fields.title = 'ชื่อรายการยาวเกิน 120 ตัวอักษร';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) fields.date = 'กรุณาระบุวันที่';
  if (!memberIds.has(body.payerId)) fields.payerId = 'กรุณาเลือกผู้รับเงิน';
  const pp = body.promptpayId ? normalizePromptPay(body.promptpayId) : null;
  if (body.promptpayId && !pp) fields.promptpayId = 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก';
  if (!pp && !body.qrImage) fields.promptpayId = fields.promptpayId || 'กรุณาระบุเลขพร้อมเพย์ หรือแนบรูป QR สำหรับรับเงิน';
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
  if (Object.keys(fields).length) throw new HttpError(400, 'validation', 'กรุณาตรวจสอบข้อมูลให้ครบถ้วน', fields);

  const receipt = parseDataUrl(body.receiptImage);
  const qr = parseDataUrl(body.qrImage);
  const base = `bills/${group.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const receiptPath = receipt ? await db.uploadFile(`${base}-receipt.${receipt.ext}`, receipt.buffer, receipt.contentType) : null;
  const qrPath = qr ? await db.uploadFile(`${base}-qr.${qr.ext}`, qr.buffer, qr.contentType) : null;

  const billId = await db.createBillRpc({
    group_id: group.id,
    title,
    bill_date: body.date,
    payer_member_id: body.payerId,
    promptpay_id: pp,
    service_pct: servicePct,
    discount,
    total: calc.total,
    receipt_path: receiptPath,
    qr_path: qrPath,
    created_by: me.line_user_id ? me.id : null,
    items: items.map((i) => ({ name: i.name, price: i.price, member_ids: i.memberIds })),
    shares: Object.entries(calc.shares).map(([member_id, amount]) => ({ member_id, amount, paid: member_id === body.payerId })),
  });

  // จำเลขพร้อมเพย์ไว้ใช้ครั้งต่อไป
  const payer = members.find((m) => m.id === body.payerId);
  if (pp && payer && !payer.promptpay_id) {
    await db.updateMemberPayment(payer.id, { promptpay_id: pp, bank_account: payer.bank_account, account_name: payer.account_name }).catch(() => {});
  }

  publish(group.id, 'bill_created', { billIds: [billId], message: `${me.display_name} บันทึกบิลใหม่ "${title}"` });

  let announced = false;
  if (config.announceNewBill) {
    const byId = new Map(members.map((m) => [m.id, m]));
    const debtors = Object.entries(calc.shares).filter(([id]) => id !== body.payerId).map(([id, amount]) => ({ member: byId.get(id), amount }));
    try {
      await line.push(group.line_group_id, msg.newBillMessage({ id: billId, title, bill_date: body.date, total: calc.total }, payer.display_name, debtors, liffUrl(group.access_key)));
      announced = true;
    } catch (e) { console.error('[api] announce failed', e.message); }
  }
  return { id: billId, announced };
}

async function summary(req, url) {
  const { group } = await auth(req, url);
  const from = url.searchParams.get('from') || undefined;
  const to = url.searchParams.get('to') || undefined;
  const [bills, members] = await Promise.all([db.listBills(group.id, { from, to }), db.listMembers(group.id)]);
  const names = new Map(members.map((m) => [m.id, m.display_name]));
  const per = new Map();
  for (const b of bills) {
    for (const s of b.bill_shares) {
      if (s.member_id === b.payer_member_id) continue;
      const row = per.get(s.member_id) || { memberId: s.member_id, total: 0, paid: 0, due: 0, dueBills: [] };
      const amt = Number(s.amount);
      row.total += amt;
      if (s.paid_at) row.paid += amt;
      else { row.due += amt; row.dueBills.push({ billId: b.id, title: b.title, date: b.bill_date, amount: amt, payerName: names.get(b.payer_member_id) || '-' }); }
      per.set(s.member_id, row);
    }
  }
  const rows = [...per.values()].map((r) => ({ ...r, total: round2(r.total), paid: round2(r.paid), due: round2(r.due) }))
    .sort((a, b) => b.due - a.due || b.total - a.total);
  const sum = (k) => round2(rows.reduce((a, r) => a + r[k], 0));
  // รายบิล สำหรับสรุปแบบจัดกลุ่ม (รายคน / รายร้าน)
  const billList = bills.map((b) => ({
    id: b.id,
    title: b.title,
    date: b.bill_date,
    total: Number(b.total),
    payerId: b.payer_member_id,
    shares: b.bill_shares.map((s) => ({ memberId: s.member_id, amount: Number(s.amount), paid: Boolean(s.paid_at), isPayer: s.member_id === b.payer_member_id })),
  }));
  return { rows, totals: { total: sum('total'), paid: sum('paid'), due: sum('due') }, bills: billList };
}

async function updatePayment(req, url) {
  const { me } = await auth(req, url);
  if (!me.line_user_id) throw new HttpError(403, 'admin_guest', 'ผู้ดูแลที่ไม่ได้เป็นสมาชิกของกลุ่มนี้ ไม่สามารถตั้งบัญชีรับเงินได้');
  const body = await readJson(req, 64 * 1024);
  const fields = {};
  const pp = body.promptpayId ? normalizePromptPay(body.promptpayId) : null;
  if (body.promptpayId && !pp) fields.promptpayId = 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก';
  const bank = String(body.bankAccount || '').replace(/\D/g, '');
  if (bank && (bank.length < 10 || bank.length > 15)) fields.bankAccount = 'เลขบัญชีธนาคารไม่ถูกต้อง';
  const name = String(body.accountName || '').trim().slice(0, 100);
  if (Object.keys(fields).length) throw new HttpError(400, 'validation', 'กรุณาตรวจสอบข้อมูลบัญชีรับเงิน', fields);
  const m = await db.updateMemberPayment(me.id, { promptpay_id: pp, bank_account: bank || null, account_name: name || null });
  publish(me.group_id, 'members', {});
  return { me: memberOut(m) };
}

async function syncMembers(req, url) {
  const { group } = await auth(req, url);
  let fullList = false;
  try {
    let start;
    do {
      const r = await line.getGroupMemberIds(group.line_group_id, start);
      for (const uid of r.memberIds || []) await ensureMember(group, uid).catch(() => {});
      start = r.next;
    } while (start);
    fullList = true;
  } catch {
    // บัญชีทั่วไปเรียกรายชื่อทั้งกลุ่มไม่ได้ อัปเดตเฉพาะคนที่รู้จักแล้ว
    const known = await db.listMembers(group.id);
    for (const m of known) {
      try {
        const p = await line.getGroupMemberProfile(group.line_group_id, m.line_user_id);
        await db.upsertMember(group.id, m.line_user_id, p);
      } catch { /* อาจออกจากกลุ่มแล้ว */ }
    }
  }
  const members = await db.listMembers(group.id);
  publish(group.id, 'members', {});
  return { members: members.map(memberOut), fullList };
}

// ---------------- ชุดรายชื่อที่ใช้บ่อย ----------------
const presetOut = (p) => ({ id: p.id, name: p.name, memberIds: p.member_ids });

async function listPresets(req, url) {
  const { group } = await auth(req, url);
  return { presets: (await db.listPresets(group.id)).map(presetOut) };
}

async function savePreset(req, url) {
  const { group, me } = await auth(req, url);
  const body = await readJson(req, 64 * 1024);
  const name = String(body.name || '').trim();
  const members = await db.listMembers(group.id);
  const valid = new Set(members.map((m) => m.id));
  const ids = [...new Set(Array.isArray(body.memberIds) ? body.memberIds : [])].filter((id) => valid.has(id));
  const fields = {};
  if (!name) fields.name = 'กรุณาตั้งชื่อชุดรายชื่อ';
  else if (name.length > 40) fields.name = 'ชื่อชุดรายชื่อยาวเกิน 40 ตัวอักษร';
  if (ids.length < 2) fields.memberIds = 'ชุดรายชื่อต้องมีสมาชิกอย่างน้อย 2 คน';
  if (Object.keys(fields).length) throw new HttpError(400, 'validation', 'ไม่สามารถบันทึกชุดรายชื่อได้', fields);
  const preset = presetOut(await db.upsertPreset(group.id, name, ids, me.id));
  publish(group.id, 'presets', {});
  return { preset };
}

async function removePreset(req, url, id) {
  const { group } = await auth(req, url);
  await db.deletePreset(group.id, id);
  publish(group.id, 'presets', {});
  return { ok: true };
}

/** เปิดสตรีมเหตุการณ์ของกลุ่ม (ตอบเองโดยไม่ผ่าน sendJson) */
export async function openEvents(req, res, url) {
  const { group } = await auth(req, url);
  subscribe(group.id, req, res);
}

/** คืน true ถ้าจัดการ request แล้ว */
export async function routeApi(req, url) {
  const p = url.pathname;
  const m = req.method;
  if (m === 'GET' && p === '/api/my-groups') return myGroups(req);
  if (m === 'GET' && p === '/api/session') return session(req, url);
  if (m === 'GET' && p === '/api/bills') return listBills(req, url);
  if (m === 'POST' && p === '/api/bills') return createBill(req, url);
  const bm = /^\/api\/bills\/([0-9a-f-]{36})$/i.exec(p);
  if (m === 'GET' && bm) return getBill(req, url, bm[1]);
  if (m === 'GET' && p === '/api/summary') return summary(req, url);
  if (m === 'PUT' && p === '/api/me/payment') return updatePayment(req, url);
  if (m === 'POST' && p === '/api/members/sync') return syncMembers(req, url);
  if (m === 'GET' && p === '/api/presets') return listPresets(req, url);
  if (m === 'POST' && p === '/api/presets') return savePreset(req, url);
  const pm = /^\/api\/presets\/([0-9a-f-]{36})$/i.exec(p);
  if (m === 'DELETE' && pm) return removePreset(req, url, pm[1]);
  throw new HttpError(404, 'not_found', 'ไม่พบ API นี้');
}
