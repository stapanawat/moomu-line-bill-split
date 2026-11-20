/**
 * OCR ใบเสร็จในเบราว์เซอร์ด้วย Tesseract.js (โอเพนซอร์ส, Apache-2.0) ภาษาไทย + อังกฤษ
 * โหลดไลบรารี ตัวประมวลผล และข้อมูลภาษาจาก CDN เมื่อกดสแกนครั้งแรกเท่านั้น (ครั้งต่อไปใช้แคชของเครื่อง)
 * ไม่ส่งรูปไปเซิร์ฟเวอร์ภายนอก และไม่ใช้หน่วยความจำของเซิร์ฟเวอร์ Render
 */
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js';

interface TesseractWorker {
  recognize(image: string | HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}
interface TesseractGlobal {
  createWorker(langs: string, oem?: number, options?: { logger?: (m: { status: string; progress: number }) => void }): Promise<TesseractWorker>;
}

let loading: Promise<TesseractGlobal> | null = null;
function loadTesseract(): Promise<TesseractGlobal> {
  const w = window as unknown as { Tesseract?: TesseractGlobal };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.async = true;
    s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error('ocr_load_failed')));
    s.onerror = () => { loading = null; s.remove(); reject(new Error('ocr_load_failed')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** เตรียมรูปให้อ่านง่าย: ขยายให้กว้างพอ แปลงเป็นขาวดำ และเพิ่มความคมชัด */
function prepare(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('decode_failed'));
    img.onload = () => {
      const scale = Math.min(2.5, Math.max(1, 1400 / img.width));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      let min = 255, max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        px[i] = g;
        if (g < min) min = g;
        if (g > max) max = g;
      }
      const range = Math.max(1, max - min);
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.max(0, Math.min(255, ((px[i] - min) / range) * 255));
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      ctx.putImageData(d, 0, 0);
      resolve(c);
    };
    img.src = src;
  });
}

export type OcrStage = 'load' | 'read';

/** อ่านข้อความจากรูป (data URL) คืนข้อความดิบ */
export async function ocrReceipt(image: string, onProgress?: (stage: OcrStage, pct: number) => void): Promise<string> {
  onProgress?.('load', 0);
  const T = await loadTesseract();
  const worker = await T.createWorker('tha+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.('read', Math.round(m.progress * 100));
      else onProgress?.('load', Math.round((m.progress || 0) * 100));
    },
  });
  try {
    const canvas = await prepare(image);
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    void worker.terminate();
  }
}
