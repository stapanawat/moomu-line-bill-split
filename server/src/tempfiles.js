// ไฟล์ชั่วคราวสำหรับดาวน์โหลด (เช่น รูป QR) เก็บในหน่วยความจำ 15 นาที
// ใช้เพราะเบราว์เซอร์ในแอป LINE (Android WebView) ดาวน์โหลดไฟล์จาก blob: ไม่ได้ ต้องเป็นลิงก์ https จริง
import crypto from 'node:crypto';

const TTL_MS = 15 * 60 * 1000;
const MAX_FILES = 300;
const store = new Map(); // token -> { buffer, contentType, name, exp }

function prune(now = Date.now()) {
  for (const [k, v] of store) if (v.exp < now) store.delete(k);
  while (store.size >= MAX_FILES) store.delete(store.keys().next().value);
}

export function putTempFile(buffer, contentType, name) {
  prune();
  const token = crypto.randomBytes(18).toString('base64url');
  store.set(token, { buffer, contentType, name, exp: Date.now() + TTL_MS });
  return token;
}

export function getTempFile(token) {
  const f = store.get(token);
  if (!f) return null;
  if (f.exp < Date.now()) { store.delete(token); return null; }
  return f;
}

/** ชื่อไฟล์สำหรับ Content-Disposition: ASCII สำรอง + UTF-8 */
export function contentDisposition(name, inline = false) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'file';
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
