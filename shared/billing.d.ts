export declare function round2(n: number): number;
export declare function computeShares(
  items: { price: number | string; memberIds: string[] }[],
  servicePct?: number,
  discount?: number,
): { subtotal: number; total: number; shares: Record<string, number> };
export declare function crc16(s: string): string;
export declare function normalizePromptPay(id: string | null | undefined): string | null;
export declare function promptPayPayload(id: string, amount?: number): string;
export declare function formatBaht(n: number): string;
