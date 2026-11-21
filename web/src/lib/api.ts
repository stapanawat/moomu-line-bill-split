import { connectLive, type LiveEvent, type LiveStatus } from './live';
import type { ApiErrorBody, BillDetail, BillSummary, Member, MemberPreset, NewBillInput, Session, Summary } from '../types';

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
  }
}

export interface Api {
  session(): Promise<Session>;
  listBills(f: { q?: string; from?: string; to?: string; scope?: 'active' | 'history' }): Promise<BillSummary[]>;
  getBill(id: string): Promise<BillDetail>;
  createBill(input: NewBillInput): Promise<{ id: string; announced: boolean }>;
  /** รูป: ไม่ส่งคีย์ = คงเดิม, null = นำออก, data URL = เปลี่ยนใหม่ */
  updateBill(id: string, input: NewBillInput): Promise<{ ok: true; financial: boolean; announced: boolean }>;
  cancelBill(id: string, reason: string): Promise<{ ok: true; announced: boolean }>;
  summary(f: { from?: string; to?: string }): Promise<Summary>;
  updatePayment(p: { promptpayId: string; bankAccount: string; accountName: string }): Promise<Member>;
  syncMembers(): Promise<{ members: Member[]; fullList: boolean }>;
  listPresets(): Promise<MemberPreset[]>;
  savePreset(p: { name: string; memberIds: string[] }): Promise<MemberPreset>;
  deletePreset(id: string): Promise<void>;
  uploadSlip(billId: string, image: string, memberId?: string): Promise<{ ok: true; amount: number; transRef: string; announced: boolean }>;
  /** ฝากรูปไว้ที่เซิร์ฟเวอร์ชั่วคราว ได้ลิงก์ https สำหรับดาวน์โหลด (ใช้ในแอป LINE ที่ดาวน์โหลดจาก blob ไม่ได้) */
  createDownload(image: string, name: string): Promise<{ url: string; name: string }>;
  /** รับเหตุการณ์เรียลไทม์ คืนฟังก์ชันสำหรับยกเลิก */
  subscribe(onEvent: (e: LiveEvent) => void, onStatus: (s: LiveStatus) => void): () => void;
}

const NETWORK_ERROR: ApiErrorBody = {
  code: 'network',
  message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง',
};

export function createHttpApi(groupKey: string, getToken: () => string | null): Api {
  async function call<T>(method: string, path: string, params: Record<string, string | undefined> = {}, body?: unknown): Promise<T> {
    const qs = new URLSearchParams({ g: groupKey });
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    let res: Response;
    try {
      const token = getToken();
      res = await fetch(`${path}?${qs}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, NETWORK_ERROR);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, data?.error ?? { code: 'server_error', message: `ระบบขัดข้อง (รหัส ${res.status}) กรุณาลองใหม่อีกครั้ง` });
    }
    return data as T;
  }

  return {
    session: () => call('GET', '/api/session'),
    listBills: async (f) => (await call<{ bills: BillSummary[] }>('GET', '/api/bills', f)).bills,
    getBill: async (id) => (await call<{ bill: BillDetail }>('GET', `/api/bills/${id}`)).bill,
    createBill: (input) => call('POST', '/api/bills', {}, input),
    updateBill: (id, input) => call('PUT', `/api/bills/${id}`, {}, input),
    cancelBill: (id, reason) => call('POST', `/api/bills/${id}/cancel`, {}, { reason }),
    summary: (f) => call('GET', '/api/summary', f),
    updatePayment: async (p) => (await call<{ me: Member }>('PUT', '/api/me/payment', {}, p)).me,
    syncMembers: () => call('POST', '/api/members/sync'),
    listPresets: async () => (await call<{ presets: MemberPreset[] }>('GET', '/api/presets')).presets,
    savePreset: async (p) => (await call<{ preset: MemberPreset }>('POST', '/api/presets', {}, p)).preset,
    deletePreset: async (id) => { await call('DELETE', `/api/presets/${id}`); },
    uploadSlip: (billId, image, memberId) => call('POST', `/api/bills/${billId}/slip`, {}, { image, memberId }),
    createDownload: (image, name) => call('POST', '/api/downloads', {}, { image, name }),
    subscribe: (onEvent, onStatus) => connectLive(groupKey, getToken, onEvent, onStatus),
  };
}

export interface MyGroups { userId: string; isAdmin: boolean; groups: { key: string; name: string }[] }

/** กลุ่มทั้งหมดที่ผู้ใช้เข้าได้ (ใช้เมื่อเปิดเว็บโดยไม่มีรหัสกลุ่ม) */
export async function fetchMyGroups(token: string | null): Promise<MyGroups> {
  let res: Response;
  try {
    res = await fetch('/api/my-groups', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? { code: 'server_error', message: `ระบบขัดข้อง (รหัส ${res.status}) กรุณาลองใหม่อีกครั้ง` });
  return data as MyGroups;
}
