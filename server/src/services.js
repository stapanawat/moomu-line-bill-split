import * as db from './db.js';
import * as line from './line.js';

const DAY = 24 * 3600 * 1000;

/** หา/สร้างกลุ่มจาก LINE groupId */
export async function ensureGroup(lineGroupId) {
  const g = await db.getGroupByLineId(lineGroupId);
  if (g && g.active) return g;
  let name = null;
  try { name = (await line.getGroupSummary(lineGroupId)).groupName; } catch { /* ไม่เป็นไร */ }
  return db.upsertGroup(lineGroupId, name);
}

/** บันทึกสมาชิก (ดึงชื่อ/รูปจาก LINE วันละครั้ง) */
export async function ensureMember(group, lineUserId) {
  const m = await db.getMember(group.id, lineUserId);
  if (m && Date.now() - new Date(m.last_seen_at).getTime() < DAY) return m;
  let profile = {};
  try { profile = await line.getGroupMemberProfile(group.line_group_id, lineUserId); } catch { /* ผู้ใช้อาจปิดการเข้าถึงโปรไฟล์ */ }
  if (!profile.displayName && m) profile = { displayName: m.display_name, pictureUrl: m.picture_url };
  return db.upsertMember(group.id, lineUserId, profile);
}

/**
 * ยอดค้างของกลุ่ม จัดกลุ่มตามบิล
 * @returns {{ members:Map, bills:{ bill, payer, debtors:{member, amount}[] }[] }}
 */
export async function groupDues(groupId) {
  const [shares, members] = await Promise.all([db.listUnpaidShares(groupId), db.listMembers(groupId)]);
  const byId = new Map(members.map((m) => [m.id, m]));
  const bills = new Map();
  for (const s of shares) {
    const bill = s.bills;
    if (s.member_id === bill.payer_member_id) continue;
    const member = byId.get(s.member_id);
    if (!member) continue;
    if (!bills.has(bill.id)) bills.set(bill.id, { bill, payer: byId.get(bill.payer_member_id), debtors: [] });
    bills.get(bill.id).debtors.push({ member, amount: Number(s.amount) });
  }
  const list = [...bills.values()].sort((a, b) =>
    String(a.bill.bill_date).localeCompare(String(b.bill.bill_date)) || String(a.bill.created_at).localeCompare(String(b.bill.created_at)));
  return { members: byId, bills: list };
}

/** แปลงเป็นรูปแบบที่ messages.reminderMessages ใช้ */
export const toReminderInput = (dues) =>
  dues.bills.map((x) => ({
    title: x.bill.title,
    bill_date: x.bill.bill_date,
    payerName: x.payer?.display_name || '-',
    debtors: x.debtors,
  }));
