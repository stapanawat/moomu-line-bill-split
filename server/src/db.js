// ตัวเชื่อม Supabase ผ่าน REST (PostgREST + Storage) ด้วย fetch ล้วน
import crypto from 'node:crypto';
import { config } from './config.js';

export class DbError extends Error {
  constructor(status, body, what) {
    const msg = body && typeof body === 'object' ? body.message || JSON.stringify(body) : String(body);
    super(`DB ${status} ${what}: ${msg}`);
    this.status = status;
    this.body = body;
  }
}

const headers = (extra = {}) => ({
  apikey: config.supabase.key,
  Authorization: `Bearer ${config.supabase.key}`,
  ...extra,
});

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${config.supabase.url}/rest/v1/${path}`, {
    method,
    headers: headers({
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new DbError(res.status, data, `${method} ${path.split('?')[0]}`);
  return data;
}

const q = (v) => encodeURIComponent(v);

// ---------------- groups ----------------
export async function getGroupByLineId(lineGroupId) {
  const rows = await rest(`groups?line_group_id=eq.${q(lineGroupId)}&select=*`);
  return rows[0] || null;
}
export async function getGroupByKey(accessKey) {
  const rows = await rest(`groups?access_key=eq.${q(accessKey)}&active=eq.true&select=*`);
  return rows[0] || null;
}
export async function upsertGroup(lineGroupId, name) {
  const existing = await getGroupByLineId(lineGroupId);
  if (existing) {
    const patch = { active: true, ...(name ? { name } : {}) };
    const rows = await rest(`groups?id=eq.${existing.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    return rows[0];
  }
  const rows = await rest('groups', {
    method: 'POST',
    body: { line_group_id: lineGroupId, name: name || null, access_key: crypto.randomBytes(12).toString('base64url') },
    prefer: 'return=representation',
  });
  return rows[0];
}
export const deactivateGroup = (lineGroupId) =>
  rest(`groups?line_group_id=eq.${q(lineGroupId)}`, { method: 'PATCH', body: { active: false } });
export const listActiveGroups = () => rest('groups?active=eq.true&select=*');
/** กลุ่มที่ผู้ใช้คนนี้เป็นสมาชิก */
export async function listGroupsOfUser(lineUserId) {
  const rows = await rest(`members?line_user_id=eq.${q(lineUserId)}&select=groups!inner(id,name,access_key,active)&groups.active=eq.true`);
  return rows.map((r) => r.groups);
}

// ---------------- members ----------------
export async function upsertMember(groupId, lineUserId, profile = {}) {
  const body = {
    group_id: groupId,
    line_user_id: lineUserId,
    display_name: profile.displayName || 'สมาชิก',
    picture_url: profile.pictureUrl || null,
    last_seen_at: new Date().toISOString(),
  };
  const rows = await rest('members?on_conflict=group_id,line_user_id', {
    method: 'POST',
    body,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return rows[0];
}
export async function getMember(groupId, lineUserId) {
  const rows = await rest(`members?group_id=eq.${groupId}&line_user_id=eq.${q(lineUserId)}&select=*`);
  return rows[0] || null;
}
export const listMembers = (groupId) =>
  rest(`members?group_id=eq.${groupId}&select=*&order=display_name.asc`);
export async function updateMemberPayment(memberId, { promptpay_id, bank_account, account_name }) {
  const rows = await rest(`members?id=eq.${memberId}`, {
    method: 'PATCH',
    body: { promptpay_id, bank_account, account_name },
    prefer: 'return=representation',
  });
  return rows[0];
}

// ---------------- bills ----------------
const BILL_SELECT = 'select=*,bill_items(*,bill_item_shares(member_id)),bill_shares(*)';

export function listBills(groupId, { from, to, limit = 500 } = {}) {
  let path = `bills?group_id=eq.${groupId}&status=neq.cancelled&${BILL_SELECT}&order=bill_date.desc,created_at.desc&limit=${limit}`;
  if (from) path += `&bill_date=gte.${q(from)}`;
  if (to) path += `&bill_date=lte.${q(to)}`;
  return rest(path);
}
export async function getBill(groupId, billId) {
  const rows = await rest(`bills?id=eq.${q(billId)}&group_id=eq.${groupId}&${BILL_SELECT}`);
  return rows[0] || null;
}
export const createBillRpc = (payload) => rest('rpc/create_bill', { method: 'POST', body: { p: payload } });
export const recordPaymentRpc = (payload) => rest('rpc/record_payment', { method: 'POST', body: { p: payload } });
export const updateBillRpc = (payload) => rest('rpc/update_bill', { method: 'POST', body: { p: payload } });
export const cancelBillRpc = (payload) => rest('rpc/cancel_bill', { method: 'POST', body: { p: payload } });

/** ยกเลิกบิลโดยตรง (ใช้เมื่อยังไม่มีฟังก์ชัน cancel_bill) ถ้ายังไม่มีคอลัมน์ cancelled_* จะเปลี่ยนแค่สถานะ */
export async function cancelBillDirect(billId, { cancelledBy, reason }) {
  const path = `bills?id=eq.${q(billId)}&status=neq.cancelled`;
  try {
    await rest(path, { method: 'PATCH', body: { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: cancelledBy, cancel_reason: reason || null }, prefer: 'return=minimal' });
  } catch (e) {
    if (!/PGRST204|column/i.test(e.message || '')) throw e;
    await rest(path, { method: 'PATCH', body: { status: 'cancelled' }, prefer: 'return=minimal' });
  }
}

/** ยอดค้างทั้งหมดของกลุ่ม: [{bill_id, member_id, amount, bills:{...}}] */
export const listUnpaidShares = (groupId) =>
  rest(`bill_shares?paid_at=is.null&select=*,bills!inner(id,group_id,title,bill_date,payer_member_id,promptpay_id,status,created_at)&bills.group_id=eq.${groupId}&bills.status=eq.open`);

export async function getPaymentByRef(transRef) {
  const rows = await rest(`payments?trans_ref=eq.${q(transRef)}&select=id`);
  return rows[0] || null;
}
export const listPayments = (groupId, ids) =>
  ids.length ? rest(`payments?group_id=eq.${groupId}&id=in.(${ids.map(q).join(',')})&select=id,slip_path,trans_ref,amount,created_at`) : [];

// ---------------- ชุดรายชื่อ ----------------
export const listPresets = (groupId) =>
  rest(`member_presets?group_id=eq.${groupId}&select=*&order=name.asc`);
export async function upsertPreset(groupId, name, memberIds, createdBy) {
  const rows = await rest('member_presets?on_conflict=group_id,name', {
    method: 'POST',
    body: { group_id: groupId, name, member_ids: memberIds, created_by: createdBy },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return rows[0];
}
export const deletePreset = (groupId, id) =>
  rest(`member_presets?id=eq.${q(id)}&group_id=eq.${groupId}`, { method: 'DELETE' });

// ---------------- reminders ----------------
/** คืน true ถ้าจองสิทธิ์ทวงของวันนั้นสำเร็จ (กันส่งซ้ำ) */
export async function claimReminder(groupId, runDate) {
  try {
    await rest('reminder_runs', { method: 'POST', body: { group_id: groupId, run_date: runDate } });
    return true;
  } catch (e) {
    if (e.status === 409) return false;
    throw e;
  }
}
export const releaseReminder = (groupId, runDate) =>
  rest(`reminder_runs?group_id=eq.${groupId}&run_date=eq.${runDate}`, { method: 'DELETE' });

// ---------------- storage ----------------
export async function uploadFile(path, buffer, contentType) {
  const res = await fetch(`${config.supabase.url}/storage/v1/object/${config.supabase.bucket}/${path}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true' }),
    body: buffer,
  });
  if (!res.ok) throw new DbError(res.status, await res.text(), 'upload');
  return path;
}

/** ลิงก์ชั่วคราวสำหรับเปิดดูรูป */
export async function signedUrls(paths, expiresIn = 3600) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const res = await fetch(`${config.supabase.url}/storage/v1/object/sign/${config.supabase.bucket}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn, paths: list }),
  });
  if (!res.ok) throw new DbError(res.status, await res.text(), 'sign');
  const data = await res.json();
  const out = {};
  for (const r of data) if (r.signedURL) out[r.path] = `${config.supabase.url}/storage/v1${r.signedURL}`;
  return out;
}
