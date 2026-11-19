export interface Member {
  id: string;
  name: string;
  pictureUrl?: string | null;
  promptpayId?: string | null;
  bankAccount?: string | null;
  accountName?: string | null;
}

export interface Session {
  group: { name: string };
  me: Member;
  members: Member[];
  remindTime: string;
}

export interface BillSummary {
  id: string;
  title: string;
  date: string;
  total: number;
  payerId: string;
  status: 'open' | 'settled' | 'cancelled';
  debtorCount: number;
  paidCount: number;
  dueAmount: number;
  hasReceipt: boolean;
  itemNames: string[];
  memberIds: string[];
}

export interface BillShare {
  memberId: string;
  amount: number;
  paidAt: string | null;
  isPayer: boolean;
  slipUrl: string | null;
  transRef: string | null;
}

export interface BillDetail extends BillSummary {
  promptpayId: string | null;
  servicePct: number;
  discount: number;
  receiptUrl: string | null;
  qrUrl: string | null;
  createdAt: string;
  items: { name: string; price: number; memberIds: string[] }[];
  shares: BillShare[];
}

export interface NewBillInput {
  title: string;
  date: string;
  payerId: string;
  promptpayId: string;
  servicePct: number;
  discount: number;
  items: { name: string; price: number; memberIds: string[] }[];
  receiptImage?: string | null;
  qrImage?: string | null;
}

export interface SummaryRow {
  memberId: string;
  total: number;
  paid: number;
  due: number;
  dueBills: { billId: string; title: string; date: string; amount: number; payerName: string }[];
}

export interface SummaryBill {
  id: string;
  title: string;
  date: string;
  total: number;
  payerId: string;
  shares: { memberId: string; amount: number; paid: boolean; isPayer: boolean }[];
}

export interface Summary {
  rows: SummaryRow[];
  totals: { total: number; paid: number; due: number };
  bills: SummaryBill[];
}

export interface MemberPreset {
  id: string;
  name: string;
  memberIds: string[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
}
