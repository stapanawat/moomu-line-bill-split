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
import { processSlip } from './slipflow.js';
import { validateBill, canManageBill, billHasPayments, financialChanged } from './billrules.js';
import { formatBaht } from '../../shared/billing.js';

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
  const { group, me } = await auth(req, url);
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
      createdBy: b.created_by,
      updatedAt: b.updated_at,
      cancelledAt: b.cancelled_at,
      cancelReason: b.cancel_reason,
      canManage: b.status !== 'cancelled' && canManageBill(me, b, config.adminUserIds),
      hasPayments: billHasPayments(b),
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

  const { fields, data } = validateBill(body, memberIds);
  const { title, pp, servicePct, discount, items, calc } = data;
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

// ---------------- แก้ไข / ยกเลิกบิล (ผู้สร้างบิลหรือผู้ดูแล) ----------------
const RPC_ERRORS = {
  bill_not_editable: [409, 'bill_not_editable', 'บิลนี้ถูกยกเลิกแล้ว หรือไม่สามารถแก้ไขได้'],
  bill_has_payments: [409, 'bill_locked', 'มีสมาชิกชำระเงินแล้ว จึงแก้ไขยอดเงินหรือรายการไม่ได้ หากต้องการแก้ยอด กรุณายกเลิกบิลนี้แล้วสร้างใหม่'],
};
const isMissingFn = (e) => /PGRST202|Could not find the function|PGRST204|column .* does not exist|schema cache/i.test(e?.message || '');
function rpcError(e) {
  for (const [k, v] of Object.entries(RPC_ERRORS)) if (e.message?.includes(k)) return new HttpError(...v);
  if (isMissingFn(e)) return new HttpError(503, 'db_outdated', 'ฐานข้อมูลยังไม่ได้อัปเดตสำหรับการแก้ไขบิล ผู้ดูแลระบบกรุณารันไฟล์ supabase/migrations/003_bill_edit_cancel.sql ใน Supabase');
  console.error('[api] rpc error', e.message);
  return e;
}

async function loadManagedBill(req, url, id) {
  const ctx = await auth(req, url);
  const bill = await db.getBill(ctx.group.id, id);
  if (!bill) throw new HttpError(404, 'bill_not_found', 'ไม่พบรายการนี้');
  if (bill.status === 'cancelled') throw new HttpError(409, 'bill_not_editable', 'บิลนี้ถูกยกเลิกไปแล้ว');
  if (!canManageBill(ctx.me, bill, config.adminUserIds)) {
    throw new HttpError(403, 'forbidden', 'แก้ไขหรือยกเลิกบิลได้เฉพาะผู้ที่สร้างบิลนี้');
  }
  return { ...ctx, bill };
}

async function editBill(req, url, id) {
  const { group, me, bill } = await loadManagedBill(req, url, id);
  const body = await readJson(req);
  const members = await db.listMembers(group.id);
  const memberIds = new Set(members.map((m) => m.id));
  const keepQr = body.qrImage === undefined && Boolean(bill.qr_path);
  const { fields, data } = validateBill(body, memberIds, { hasQr: keepQr });
  if (Object.keys(fields).length) throw new HttpError(400, 'validation', 'กรุณาตรวจสอบข้อมูลให้ครบถ้วน', fields);

  const financial = financialChanged(bill, data);
  if (financial && billHasPayments(bill)) throw new HttpError(...RPC_ERRORS.bill_has_payments);

  // รูป: undefined = คงเดิม, null = นำออก, data URL = เปลี่ยนใหม่
  const base = `bills/${group.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const receipt = body.receiptImage ? parseDataUrl(body.receiptImage) : null;
  const qr = body.qrImage ? parseDataUrl(body.qrImage) : null;
  const receiptPath = receipt ? await db.uploadFile(`${base}-receipt.${receipt.ext}`, receipt.buffer, receipt.contentType) : null;
  const qrPath = qr ? await db.uploadFile(`${base}-qr.${qr.ext}`, qr.buffer, qr.contentType) : null;

  const { title, pp, servicePct, discount, items, calc } = data;
  try {
    await db.updateBillRpc({
      bill_id: bill.id,
      title,
      bill_date: data.date,
      set_receipt: body.receiptImage !== undefined,
      receipt_path: receiptPath,
      set_qr: body.qrImage !== undefined,
      qr_path: qrPath,
      financial,
      payer_member_id: data.payerId,
      promptpay_id: pp,
      service_pct: servicePct,
      discount,
      total: calc.total,
      items: items.map((i) => ({ name: i.name, price: i.price, member_ids: i.memberIds })),
      shares: Object.entries(calc.shares).map(([member_id, amount]) => ({ member_id, amount, paid: member_id === data.payerId })),
    });
  } catch (e) { throw rpcError(e); }

  publish(group.id, 'bill_updated', { billIds: [bill.id], message: `${me.display_name} แก้ไขบิล "${title}"` });

  // แจ้งในกลุ่มเฉพาะเมื่อยอดเงินเปลี่ยน
  let announced = false;
  if (financial && config.announceNewBill) {
    const byId = new Map(members.map((m) => [m.id, m]));
    const payer = byId.get(data.payerId);
    const debtors = Object.entries(calc.shares).filter(([mid]) => mid !== data.payerId).map(([mid, amount]) => ({ member: byId.get(mid), amount }));
    try {
      await line.push(group.line_group_id, msg.newBillMessage({ id: bill.id, title, bill_date: data.date, total: calc.total }, payer.display_name, debtors, liffUrl(group.access_key), { edited: true }));
      announced = true;
    } catch (e) { console.error('[api] announce edit failed', e.message); }
  }
  return { ok: true, financial, announced };
}

async function cancelBill(req, url, id) {
  const { group, me, bill } = await loadManagedBill(req, url, id);
  const body = await readJson(req, 16 * 1024);
  const reason = String(body.reason || '').trim().slice(0, 200);
  try {
    await db.cancelBillRpc({ bill_id: bill.id, cancelled_by: me.line_user_id ? me.id : '', reason });
  } catch (e) {
    // ฐานข้อมูลยังไม่ได้รัน migration 003 (ไม่มีฟังก์ชัน cancel_bill): ยกเลิกด้วยการเปลี่ยนสถานะโดยตรงแทน
    if (!isMissingFn(e)) throw rpcError(e);
    console.warn('[api] cancel_bill rpc missing, fallback to direct update. Please run supabase/migrations/003_bill_edit_cancel.sql');
    await db.cancelBillDirect(bill.id, { cancelledBy: me.line_user_id ? me.id : null, reason });
  }

  publish(group.id, 'bill_updated', { billIds: [bill.id], message: `${me.display_name} ยกเลิกบิล "${bill.title}"` });

  let announced = false;
  if (config.announceNewBill) {
    const byId = new Map((await db.listMembers(group.id)).map((m) => [m.id, m]));
    const debt = bill.bill_shares.filter((s) => s.member_id !== bill.payer_member_id);
    const paid = debt.filter((s) => s.paid_at).map((s) => byId.get(s.member_id)).filter(Boolean);
    const unpaid = debt.filter((s) => !s.paid_at).map((s) => byId.get(s.member_id)).filter(Boolean);
    try {
      await line.push(group.line_group_id, msg.billCancelledMessage(
        { title: bill.title, bill_date: bill.bill_date, total: Number(bill.total) },
        { byName: me.display_name, reason, payerName: byId.get(bill.payer_member_id)?.display_name || '-', paid, unpaid },
      ));
      announced = true;
    } catch (e) { console.error('[api] announce cancel failed', e.message); }
  }
  return { ok: true, announced };
}

// ---------------- แนบสลิปจากเว็บ ----------------
async function uploadSlip(req, url, billId) {
  const { group, me } = await auth(req, url);
  const body = await readJson(req);
  const bill = await db.getBill(group.id, billId);
  if (!bill) throw new HttpError(404, 'bill_not_found', 'ไม่พบรายการนี้');

  const targetId = body.memberId || me.id;
  const isAdminGuest = !me.line_user_id;
  if (targetId !== me.id && me.id !== bill.payer_member_id && !isAdminGuest) {
    throw new HttpError(403, 'forbidden', 'แนบสลิปแทนผู้อื่นได้เฉพาะผู้รับเงินของบิลนี้');
  }
  const share = bill.bill_shares.find((s) => s.member_id === targetId);
  if (!share || targetId === bill.payer_member_id) throw new HttpError(400, 'no_share', 'สมาชิกนี้ไม่มียอดที่ต้องชำระในบิลนี้');
  if (share.paid_at) throw new HttpError(400, 'already_paid', 'รายการนี้ชำระเรียบร้อยแล้ว');

  const img = parseDataUrl(body.image, 5 * 1024 * 1024);
  if (!img) throw new HttpError(400, 'validation', 'กรุณาแนบรูปสลิป (JPG หรือ PNG)', { image: 'กรุณาแนบรูปสลิป' });

  const member = (await db.listMembers(group.id)).find((m) => m.id === targetId);
  if (!member) throw new HttpError(404, 'member_not_found', 'ไม่พบสมาชิกนี้ในกลุ่ม');

  const r = await processSlip({ group, member, buffer: img.buffer, contentType: img.contentType, onlyBillId: billId });
  if (r.status === 'no_dues') throw new HttpError(400, 'already_paid', 'รายการนี้ไม่มียอดค้างชำระแล้ว');
  if (r.status === 'not_slip') {
    throw new HttpError(400, 'slip_not_slip', 'ไม่พบ QR บนรูปที่แนบ กรุณาแนบรูปสลิปฉบับเต็มที่เห็น QR ชัดเจน');
  }
  if (r.status === 'fail') {
    let message = msg.REASONS[r.reason] || msg.REASONS.provider;
    if (r.reason === 'amount' && r.slip) message += ` (ยอดในสลิป ${formatBaht(r.slip.amount)} ยอดที่ต้องชำระ ${formatBaht(share.amount)})`;
    throw new HttpError(400, `slip_${r.reason}`, message);
  }

  // แจ้งในกลุ่ม LINE ให้ทุกคนเห็น (ใช้โควตาข้อความ push)
  let announced = false;
  if (config.announceWebSlip) {
    try {
      await line.push(group.line_group_id, msg.paymentSuccessMessage(member, r.slip, r.paid, liffUrl(group.access_key)));
      announced = true;
    } catch (e) { console.error('[api] announce slip failed', e.message); }
  }
  return { ok: true, amount: r.slip.amount, transRef: r.slip.transRef, billIds: r.billIds, announced };
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
  const cm = /^\/api\/bills\/([0-9a-f-]{36})\/cancel$/i.exec(p);
  if (m === 'POST' && cm) return cancelBill(req, url, cm[1]);
  const sm = /^\/api\/bills\/([0-9a-f-]{36})\/slip$/i.exec(p);
  if (m === 'POST' && sm) return uploadSlip(req, url, sm[1]);
  const bm = /^\/api\/bills\/([0-9a-f-]{36})$/i.exec(p);
  if (m === 'GET' && bm) return getBill(req, url, bm[1]);
  if (m === 'PUT' && bm) return editBill(req, url, bm[1]);
  if (m === 'GET' && p === '/api/summary') return summary(req, url);
  if (m === 'PUT' && p === '/api/me/payment') return updatePayment(req, url);
  if (m === 'POST' && p === '/api/members/sync') return syncMembers(req, url);
  if (m === 'GET' && p === '/api/presets') return listPresets(req, url);
  if (m === 'POST' && p === '/api/presets') return savePreset(req, url);
  const pm = /^\/api\/presets\/([0-9a-f-]{36})$/i.exec(p);
  if (m === 'DELETE' && pm) return removePreset(req, url, pm[1]);
  throw new HttpError(404, 'not_found', 'ไม่พบ API นี้');
}
