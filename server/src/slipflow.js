// ขั้นตอนตรวจสลิปและบันทึกการชำระ ใช้ร่วมกันระหว่างสลิปที่ส่งในกลุ่ม LINE และสลิปที่แนบในเว็บ
import * as db from './db.js';
import { config } from './config.js';
import { groupDues } from './services.js';
import { verifySlip, allocate, SlipError } from './slip.js';
import { publish } from './events.js';
import { round2, formatBaht } from '../../shared/billing.js';

/**
 * @param {{ group, member, buffer:Buffer, contentType:string, onlyBillId?:string }} p
 * @returns {Promise<
 *   { status:'no_dues' } |
 *   { status:'not_slip' } |
 *   { status:'fail', reason:string, slip?:object, mine:object[] } |
 *   { status:'ok', slip:object, paid:object[], billIds:string[] }>}
 */
export async function processSlip({ group, member, buffer, contentType, onlyBillId }) {
  const dues = await groupDues(group.id);
  let mine = [];
  for (const x of dues.bills) {
    const d = x.debtors.find((d) => d.member.id === member.id);
    if (!d) continue;
    mine.push({
      bill_id: x.bill.id,
      title: x.bill.title,
      bill_date: x.bill.bill_date,
      created_at: x.bill.created_at,
      amount: d.amount,
      payee: { ...x.payer, promptpay_id: x.bill.promptpay_id || x.payer?.promptpay_id },
      payerName: x.payer?.display_name || '-',
    });
  }
  if (onlyBillId) mine = mine.filter((d) => d.bill_id === onlyBillId);
  if (!mine.length) return { status: 'no_dues' };

  let slip;
  try {
    slip = await verifySlip(buffer, contentType);
  } catch (e) {
    if (e instanceof SlipError && e.kind === 'not_slip') return { status: 'not_slip' };
    console.error('[slip] verify error', e.message);
    return { status: 'fail', reason: e instanceof SlipError ? e.kind : 'provider', mine };
  }

  if (!slip.transRef) return { status: 'fail', reason: 'not_found', slip, mine };
  if (slip.isDuplicate || (await db.getPaymentByRef(slip.transRef))) return { status: 'fail', reason: 'duplicate', slip, mine };

  const result = allocate(mine, slip, config.slip.overpayTolerance);
  if (!result.ok) return { status: 'fail', reason: result.reason, slip, mine };

  const ext = /png/.test(contentType) ? 'png' : 'jpg';
  const slipPath = `slips/${group.id}/${slip.transRef.replace(/[^\w-]/g, '')}.${ext}`;
  try {
    await db.uploadFile(slipPath, buffer, contentType);
    await db.recordPaymentRpc({
      group_id: group.id,
      member_id: member.id,
      trans_ref: slip.transRef,
      amount: slip.amount,
      slip_path: slipPath,
      provider: slip.provider,
      receiver_name: slip.receiver.name || null,
      raw: { receiver: slip.receiver, sender: slip.sender, date: slip.date },
      bill_ids: result.billIds,
    });
  } catch (e) {
    if (/duplicate_slip/.test(e.message)) return { status: 'fail', reason: 'duplicate', slip, mine };
    console.error('[slip] save error', e.message);
    return { status: 'fail', reason: 'provider', slip, mine };
  }

  publish(group.id, 'payment', {
    billIds: result.billIds,
    memberId: member.id,
    message: `${member.display_name} ชำระเงิน ${formatBaht(slip.amount)} เรียบร้อยแล้ว`,
  });

  // สถานะของทุกคนในบิลที่ชำระ (ใช้ทำการ์ดยืนยัน)
  const names = new Map((await db.listMembers(group.id)).map((m) => [m.id, m.display_name]));
  const paid = [];
  for (const id of result.billIds) {
    const d = mine.find((x) => x.bill_id === id);
    const b = await db.getBill(group.id, id).catch(() => null);
    const order = { due: 0, paid: 1, payee: 2 };
    const shares = (b?.bill_shares || [])
      .map((s) => ({
        name: names.get(s.member_id) || 'สมาชิก',
        amount: Number(s.amount),
        status: s.member_id === b.payer_member_id ? 'payee' : s.paid_at ? 'paid' : 'due',
      }))
      .sort((x, y) => order[x.status] - order[y.status]);
    paid.push({ id, title: d.title, bill_date: d.bill_date, amount: round2(d.amount), payerName: d.payerName, shares });
  }
  return { status: 'ok', slip, paid, billIds: result.billIds };
}
