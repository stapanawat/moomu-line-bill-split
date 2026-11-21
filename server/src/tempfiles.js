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

// บันทึกผลการกดบันทึกรูปจากเครื่องผู้ใช้ (ไว้หาสาเหตุเมื่อบันทึกไม่ได้) เก็บ 50 รายการล่าสุด ไม่มีข้อมูลส่วนตัว
const clientLog = [];
export function addClientLog(entry) {
  clientLog.push({ at: new Date().toISOString(), ...entry });
  while (clientLog.length > 50) clientLog.shift();
}
export const getClientLog = () => clientLog.slice().reverse();
/** นับว่ามีการเปิดลิงก์ดาวน์โหลด (ใช้ดูว่าเบราว์เซอร์ภายนอกเปิดลิงก์จริงหรือไม่) */
export function noteDownloadHit(token, ua) {
  addClientLog({ event: 'dl_hit', token: token.slice(0, 6), ua: String(ua || '').slice(0, 200) });
}

/** ชื่อไฟล์สำหรับ Content-Disposition: ASCII สำรอง + UTF-8 */
export function contentDisposition(name, inline = false) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'file';
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
