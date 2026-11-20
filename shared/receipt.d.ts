export interface ParsedReceipt {
  title: string | null;
  date: string | null;
  items: { name: string; price: number }[];
  itemsTotal: number;
  subtotal: number | null;
  total: number | null;
  servicePct: number | null;
  discount: number | null;
  vatPct: number | null;
  /** true = รวม VAT ที่แยกท้ายบิลเข้าใน servicePct แล้ว */
  vatAdded: boolean;
  lines: string[];
}
export declare function normalizeOcrText(text: string): string[];
export declare function findDate(lines: string[], today?: string): string | null;
export declare function parseReceipt(text: string, opts?: { today?: string }): ParsedReceipt;
