export const baht = (n: number) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const thDate = (d: string, long = false) =>
  new Date(d.length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('th-TH', {
    day: 'numeric', month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit',
  });

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const maskPromptPay = (s?: string | null) => {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-xxx-${d.slice(-4)}`;
  if (d.length === 13) return `x-xxxx-xxxxx-${d.slice(-3, -1)}-${d.slice(-1)}`;
  return d;
};

/** ย่อรูปก่อนอัปโหลด (ด้านยาวสุด 1600px, JPEG) */
export function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('not_image'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode_failed'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(String(reader.result));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
