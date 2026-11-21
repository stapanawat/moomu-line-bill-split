// ตรวจสลิปกับผู้ให้บริการ + จับคู่สลิปกับยอดค้าง
import { config } from './config.js';
import { round2 } from '../../shared/billing.js';

export class SlipError extends Error {
  /** kind: not_slip | duplicate | not_found | shop_account | provider */
  constructor(kind, message, raw) { super(message); this.kind = kind; this.raw = raw; }
}

/**
 * ผลลัพธ์มาตรฐาน
 * @typedef {{ transRef:string, amount:number, date?:string,
 *   receiver:{ name?:string, proxyType?:string, proxyAccount?:string, bankAccount?:string },
 *   sender:{ name?:string }, isDuplicate:boolean, provider:string, raw:any }} SlipResult
 */

const pick = (...v) => v.find((x) => x !== undefined && x !== null && x !== '');

function classify(code = '', message = '') {
  const s = `${code} ${message}`.toLowerCase();
  if (/duplicate|1012/.test(s)) return 'duplicate';
  if (/qr|invalid_image|image_size|not.?slip|1005|1006|1007|1008/.test(s)) return 'not_slip';
  if (/\b1014\b/.test(s)) return 'shop_account'; // บัญชีผู้รับไม่ตรงกับบัญชีที่ผูกไว้ใน SlipOK
  if (/slip_not_found|not.?found|1010|1013/.test(s)) return 'not_found';
  return 'provider';
}

// ---------------- EasySlip ----------------
async function verifyEasySlip(buffer, contentType) {
  if (!config.slip.easyslipKey) throw new SlipError('provider', 'ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY');
  const isV1 = /\/v1\//.test(config.slip.easyslipUrl);
  const fd = new FormData();
  fd.append(isV1 ? 'file' : 'image', new Blob([buffer], { type: contentType }), 'slip.jpg');
  fd.append('checkDuplicate', 'true');
  const res = await fetch(config.slip.easyslipUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.slip.easyslipKey}` },
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  const ok = res.ok && (body.success === true || body.status === 200);
  const data = body.data || {};
  const slip = data.rawSlip || data;
  if (!ok) {
    const code = body.error?.code || body.message || '';
    const kind = classify(code, body.error?.message);
    // v1 ส่งข้อมูลสลิปเดิมกลับมาเมื่อเป็นสลิปซ้ำ
    if (kind !== 'duplicate' || !slip.transRef) throw new SlipError(kind, String(code || res.status), body);
  }
  return normalize(slip, {
    provider: 'easyslip',
    isDuplicate: Boolean(data.isDuplicate) || classify(body.error?.code || body.message) === 'duplicate',
    raw: body,
  });
}

// ---------------- SlipOK ----------------
async function verifySlipOK(buffer, contentType) {
  const { slipokBranch, slipokKey } = config.slip;
  if (!slipokBranch || !slipokKey) throw new SlipError('provider', 'ยังไม่ได้ตั้งค่า SLIPOK_BRANCH_ID / SLIPOK_API_KEY');
  const fd = new FormData();
  fd.append('files', new Blob([buffer], { type: contentType }), 'slip.jpg');
  // ไม่ส่ง log: SlipOK จะไม่บังคับให้ผู้รับเป็นบัญชีของร้าน (ระบบนี้มีผู้รับเงินหลายคน ตรวจผู้รับและสลิปซ้ำเองแล้ว)
  if (config.slip.slipokLog) fd.append('log', 'true');
  const res = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(slipokBranch)}`, {
    method: 'POST',
    headers: { 'x-authorization': slipokKey },
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  const data = body.data || {};
  if (!res.ok || body.success === false || data.success === false) {
    const kind = classify(body.code, body.message);
    if (kind !== 'duplicate' || !data.transRef) throw new SlipError(kind, String(body.code || body.message || res.status), body);
    return normalize(data, { provider: 'slipok', isDuplicate: true, raw: body });
  }
  return normalize(data, { provider: 'slipok', isDuplicate: false, raw: body });
}

/** รวมรูปแบบข้อมูลจากผู้ให้บริการต่าง ๆ ให้เป็นแบบเดียวกัน */
export function normalize(s, extra) {
  const r = s.receiver || {};
  const acc = r.account || {};
  const proxy = acc.proxy || r.proxy || {};
  const bank = acc.bank || {};
  const amount = typeof s.amount === 'object' ? s.amount?.amount : s.amount;
  return {
    transRef: String(pick(s.transRef, s.transactionId, '')),
    amount: round2(Number(amount) || 0),
    date: pick(s.date, s.transDate && `${s.transDate} ${s.transTime || ''}`.trim()),
    receiver: {
      name: pick(acc.name?.th, acc.name?.en, r.displayName, r.name, typeof acc.name === 'string' ? acc.name : undefined),
      proxyType: pick(proxy.type),
      proxyAccount: pick(proxy.account, proxy.value),
      bankAccount: pick(bank.account, typeof acc.value === 'string' ? acc.value : undefined),
    },
    sender: { name: pick(s.sender?.account?.name?.th, s.sender?.displayName, s.sender?.name) },
    ...extra,
  };
}

export async function verifySlip(buffer, contentType = 'image/jpeg') {
  if (config.slip.provider === 'slipok') return verifySlipOK(buffer, contentType);
  return verifyEasySlip(buffer, contentType);
}

// ---------------- จับคู่ผู้รับเงิน ----------------

/**
 * เทียบเลขที่ถูกปิดบางส่วน (เช่น xxx-xxx-5678, xxx-x-x3109-x) กับเลขจริง
 * ชิดขวา ตัวเลขที่มองเห็นต้องตรงทุกตัว และต้องเห็นอย่างน้อย 3 ตัว
 */
export function matchMasked(masked, actual) {
  const m = String(masked || '').toLowerCase().replace(/[^0-9x*]/g, '');
  const a = String(actual || '').replace(/\D/g, '');
  if (!m || !a) return false;
  const visible = (m.match(/\d/g) || []).length;
  if (visible < 3) return false;
  const variants = [a];
  if (/^0\d{9}$/.test(a)) variants.push('66' + a.slice(1), '0066' + a.slice(1)); // เบอร์โทรรูปแบบสากล
  return variants.some((v) => {
    if (m.length > v.length + 1) return false;
    const off = v.length - m.length;
    for (let i = 0; i < m.length; i++) {
      const c = m[i];
      if (/\d/.test(c) && v[i + off] !== c) return false;
    }
    return true;
  });
}

const normName = (s) => String(s || '').toLowerCase()
  .replace(/^(นาย|นางสาว|นาง|น\.ส\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i, '')
  .replace(/[\s.]/g, '');

/** ชื่อในสลิปมักถูกตัด เช่น "นาย มายด์ ส" — เทียบแบบต้นคำ */
export function matchName(slipName, expected) {
  const a = normName(slipName), b = normName(expected);
  if (a.length < 2 || b.length < 2) return false;
  return a.startsWith(b) || b.startsWith(a) || a.includes(b);
}

/**
 * ผู้รับในสลิปตรงกับคนรับเงินของบิลหรือไม่
 * @param {SlipResult['receiver']} rcv
 * @param {{promptpay_id?:string, bank_account?:string, account_name?:string}} payee
 * @returns {'match'|'mismatch'|'unknown'}
 */
export function receiverStatus(rcv, payee) {
  let comparable = false;
  if (rcv.proxyAccount && payee.promptpay_id) { comparable = true; if (matchMasked(rcv.proxyAccount, payee.promptpay_id)) return 'match'; }
  if (rcv.bankAccount && payee.bank_account) { comparable = true; if (matchMasked(rcv.bankAccount, payee.bank_account)) return 'match'; }
  if (rcv.name && payee.account_name) { comparable = true; if (matchName(rcv.name, payee.account_name)) return 'match'; }
  return comparable ? 'mismatch' : 'unknown';
}

/**
 * เลือกว่าสลิปนี้จ่ายบิลไหน
 * @param {{bill_id:string, amount:number, payee:object, bill_date:string, created_at?:string}[]} dues ยอดค้างของผู้ส่งสลิป
 * @param {SlipResult} slip
 * @param {number} tolerance โอนเกินได้ไม่เกินกี่บาท
 * @returns {{ ok:true, billIds:string[], dueTotal:number } | { ok:false, reason:'receiver'|'amount'|'receiver_unknown', candidates?:any[] }}
 */
export function allocate(dues, slip, tolerance = 1) {
  const statuses = dues.map((d) => ({ ...d, rs: receiverStatus(slip.receiver, d.payee) }));
  let pool = statuses.filter((d) => d.rs === 'match');
  if (!pool.length) {
    // ไม่มีข้อมูลให้เทียบผู้รับได้เลย: ยอมรับเฉพาะกรณีผู้ส่งค้างกับคนรับเงินคนเดียว
    const mismatch = statuses.some((d) => d.rs === 'mismatch');
    const unknown = statuses.filter((d) => d.rs === 'unknown');
    const payees = new Set(unknown.map((d) => d.payee.id));
    if (!mismatch && payees.size === 1) pool = unknown;
    else return { ok: false, reason: mismatch ? 'receiver' : 'receiver_unknown', candidates: statuses };
  }
  pool.sort((a, b) => String(a.bill_date).localeCompare(String(b.bill_date)) || String(a.created_at).localeCompare(String(b.created_at)));
  const fits = (due) => slip.amount >= due - 0.009 && slip.amount <= due + tolerance + 0.009;

  // 1) ตรงกับบิลเดียว (บิลเก่าก่อน)
  const single = pool.find((d) => fits(Number(d.amount)));
  if (single) return { ok: true, billIds: [single.bill_id], dueTotal: round2(single.amount) };

  // 2) ตรงกับยอดรวมของทุกบิลที่ค้างคนรับเงินคนเดียวกัน
  const byPayee = new Map();
  for (const d of pool) byPayee.set(d.payee.id, [...(byPayee.get(d.payee.id) || []), d]);
  for (const list of byPayee.values()) {
    const sum = round2(list.reduce((s, d) => s + Number(d.amount), 0));
    if (list.length > 1 && fits(sum)) return { ok: true, billIds: list.map((d) => d.bill_id), dueTotal: sum };
  }
  return { ok: false, reason: 'amount', candidates: pool };
}
