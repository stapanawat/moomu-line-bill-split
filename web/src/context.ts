import { createContext, useContext } from 'react';
import type { Api } from './lib/api';
import type { Member, Session } from './types';

export interface AppCtx {
  api: Api;
  session: Session;
  member: (id: string) => Member | undefined;
  setMembers: (m: Member[]) => void;
  setMe: (m: Member) => void;
}

export const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('no context');
  return c;
};

export const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ กรุณาลองใหม่อีกครั้ง';
