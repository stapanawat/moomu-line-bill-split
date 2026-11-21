import { createContext, useContext } from 'react';
import type { Api } from './lib/api';
import type { BillDetail, Member, Session } from './types';

export interface AppCtx {
  api: Api;
  session: Session;
  member: (id: string) => Member | undefined;
  setMembers: (m: Member[]) => void;
  setMe: (m: Member) => void;
  /** เพิ่มขึ้นทุกครั้งที่มีเหตุการณ์จากเซิร์ฟเวอร์ ใช้เป็นตัวกระตุ้นให้หน้าโหลดข้อมูลใหม่ */
  liveTick: number;
  /** เปิดอยู่ในแอป LINE หรือไม่ (ใช้ตัดสินใจแสดงปุ่มกลับไปที่ LINE) */
  inClient: boolean;
  /** ปิดหน้าเว็บกลับไปที่แชท LINE */
  closeWindow: () => void;
  /** เปิดหน้าแก้ไขบิล */
  startEdit: (bill: BillDetail) => void;
  /** แสดงข้อความสำเร็จบนหน้ารายการบิล */
  notify: (title: string, text?: string, opts?: { sticker?: import('./components/ui').StickerName; kind?: 'success' | 'info' | 'warning' }) => void;
}

export const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('no context');
  return c;
};

export const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ กรุณาลองใหม่อีกครั้ง';
