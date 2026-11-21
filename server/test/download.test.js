import { test } from 'node:test';
import assert from 'node:assert/strict';

test('ลิงก์ดาวน์โหลดชั่วคราว: ส่งไฟล์แบบ attachment พร้อมชื่อไทย และหมดอายุได้', async () => {
  process.env.PORT = String(39000 + Math.floor(Math.random() * 500));
  const { putTempFile } = await import('../src/tempfiles.js');
  await import('../src/index.js');
  await new Promise((r) => setTimeout(r, 200));
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const token = putTempFile(png, 'image/png', 'QR-ต้นกล้า-121.00.png');
  const res = await fetch(`http://127.0.0.1:${process.env.PORT}/dl/${token}/${encodeURIComponent('QR-ต้นกล้า-121.00.png')}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('content-disposition'), /^attachment; .*filename\*=UTF-8''QR-%E0%B8%95/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
  const gone = await fetch(`http://127.0.0.1:${process.env.PORT}/dl/${'x'.repeat(24)}/a.png`);
  assert.equal(gone.status, 410);
  setTimeout(() => process.exit(0), 50); // ปิดเซิร์ฟเวอร์ทดสอบ
});
