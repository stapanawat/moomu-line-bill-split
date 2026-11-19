export class HttpError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
}

export function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'too_large', 'ข้อมูลมีขนาดใหญ่เกินกำหนด')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; }
  catch { throw new HttpError(400, 'bad_json', 'รูปแบบข้อมูลไม่ถูกต้อง'); }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function sendError(res, err) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
  }
  console.error('[http] unexpected', err);
  return sendJson(res, 500, { error: { code: 'server_error', message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' } });
}

/** แปลง data URL เป็น { buffer, contentType } */
export function parseDataUrl(dataUrl, maxBytes = 5 * 1024 * 1024) {
  const m = /^data:(image\/(?:png|jpe?g|webp|heic|heif));base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > maxBytes) throw new HttpError(413, 'image_too_large', 'รูปภาพมีขนาดเกิน 5 MB กรุณาลดขนาดรูปแล้วลองใหม่');
  return { buffer, contentType: m[1].toLowerCase(), ext: m[1].split('/')[1].replace('jpeg', 'jpg') };
}
