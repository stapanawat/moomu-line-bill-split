// เริ่มต้นระบบ: LIFF (ของจริง) หรือข้อมูลตัวอย่าง (mock)
import { createHttpApi, ApiError, type Api } from './api';

declare global {
  interface Window { APP_CONFIG?: { liffId?: string; devAuth?: boolean } }
}

export const isMock = import.meta.env.VITE_MOCK === '1';

export interface Platform {
  api: Api;
  inClient: boolean;
  closeWindow(): void;
}

function groupKeyFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  let key = params.get('g');
  // LIFF อาจส่งค่าผ่าน liff.state ระหว่างเข้าสู่ระบบ
  if (!key && params.get('liff.state')) key = new URLSearchParams(params.get('liff.state')!.replace(/^[^?]*\??/, '')).get('g');
  try {
    if (key) sessionStorage.setItem('groupKey', key);
    else key = sessionStorage.getItem('groupKey');
  } catch { /* ไม่มี storage */ }
  return key;
}

export async function initPlatform(): Promise<Platform> {
  if (isMock) {
    const { mockApi } = await import('./mock');
    return { api: mockApi, inClient: false, closeWindow: () => {} };
  }

  const cfg = window.APP_CONFIG || {};
  if (cfg.devAuth) {
    // โหมดทดสอบในเครื่อง (เซิร์ฟเวอร์ตั้ง DEV_AUTH_USER_ID)
    const key = groupKeyFromUrl();
    if (!key) throw new ApiError(400, { code: 'no_group', message: 'ไม่พบรหัสกลุ่ม กรุณาเปิดเว็บจากลิงก์ที่บอทส่งในกลุ่ม LINE' });
    return { api: createHttpApi(key, () => null), inClient: false, closeWindow: () => {} };
  }

  if (!cfg.liffId) throw new ApiError(500, { code: 'config', message: 'ระบบยังไม่ได้ตั้งค่า LIFF ID กรุณาติดต่อผู้ดูแลระบบ' });
  const { default: liff } = await import('@line/liff');
  try {
    await liff.init({ liffId: cfg.liffId });
  } catch {
    throw new ApiError(0, { code: 'liff_init', message: 'ไม่สามารถเริ่มต้นการเชื่อมต่อกับ LINE ได้ กรุณาปิดแล้วเปิดเว็บใหม่อีกครั้ง' });
  }
  const key = groupKeyFromUrl();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return new Promise<Platform>(() => {}); // กำลังพาไปหน้าเข้าสู่ระบบ
  }
  if (!key) throw new ApiError(400, { code: 'no_group', message: 'ไม่พบรหัสกลุ่ม กรุณาเปิดเว็บจากลิงก์ที่บอทส่งในกลุ่ม LINE' });
  return {
    api: createHttpApi(key, () => liff.getIDToken()),
    inClient: liff.isInClient(),
    closeWindow: () => liff.closeWindow(),
  };
}
