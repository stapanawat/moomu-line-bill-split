import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, findDate } from '../../shared/receipt.js';

const today = '2026-11-20';

test('อ่านใบเสร็จร้านกาแฟภาษาไทย', () => {
  const r = parseReceipt(`Roast Coffee นิมมาน
  โทร 053-123456  TAX ID 0105551234567
  วันที่ 20/11/2569 เวลา 14:32
  โต๊ะ 5
  ลา เต้ เย็น          65.00
  2 x อเมริกาโน่       120.00
  ครัวซองต์ 1 @ 85     85.00
  Brownie            ๗๕.๐๐
  รวม                 345.00
  ส่วนลด              -20.00
  Service Charge 10%   32.50
  VAT 7%              22.75
  ยอดสุทธิ            357.50
  เงินสด              500.00
  เงินทอน             142.50
  ขอบคุณที่ใช้บริการ`, { today });
  assert.equal(r.title, 'Roast Coffee นิมมาน');
  assert.equal(r.date, '2026-11-20');
  assert.deepEqual(r.items, [
    { name: 'ลาเต้เย็น', price: 65 },
    { name: 'อเมริกาโน่ x2', price: 120 },
    { name: 'ครัวซองต์', price: 85 },
    { name: 'Brownie', price: 75 },
  ]);
  assert.equal(r.itemsTotal, 345);
  assert.equal(r.total, 357.5);
  assert.equal(r.servicePct, 10);
  assert.equal(r.discount, 20);
});

test('ใบเสร็จภาษาอังกฤษ ราคาต่อหน่วยกับราคารวม', () => {
  const r = parseReceipt(`KHAO SOI HOUSE
Date: 2026-11-19 19:05
Khao Soi Chicken 2 x 80.00 160.00
Sai Ua 120
Thai Tea 3 45.00 135.00
Subtotal 415.00
Total 415.00`, { today });
  assert.equal(r.date, '2026-11-19');
  assert.deepEqual(r.items, [
    { name: 'Khao Soi Chicken x2', price: 160 },
    { name: 'Sai Ua', price: 120 },
    { name: 'Thai Tea x3', price: 135 },
  ]);
  assert.equal(r.subtotal, 415);
  assert.equal(r.total, 415);
});

test('รูปแบบวันที่', () => {
  assert.equal(findDate(['20 พ.ย. 69'], today), '2026-11-20');
  assert.equal(findDate(['18 Nov 2026'], today), '2026-11-18');
  assert.equal(findDate(['01-11-26'], today), '2026-11-01');
  assert.equal(findDate(['31/02/2026'], today), null);
  assert.equal(findDate(['05/12/2030'], today), null);
});

test('ข้อความจาก Tesseract จริง: OCR อ่านสระผิดบางตัวก็ยังจับยอดรวมได้', () => {
  const r = parseReceipt(`ร้านกาแฟบ้านสวน

โทร 053-123456

วันที่ 20/11/2569 14:32

ลาเต้เย็น                               65.00
2x อเมริกาโน่               120.00
ชาไทยปั่น                             55.00
ครัวซองต์เนยสด                       85.00
เค้กช็อกโกแลต                        95.00
รวม                                  420.00
ส่วนลด                                -20.00
ยอดสุหธิ                              400.00
เงินสด                                500.00
เงินทอน                              100.00
ขอบคุณที่ใช้บริการ`, { today });
  assert.equal(r.items.length, 5);
  assert.equal(r.itemsTotal, 420);
  assert.equal(r.discount, 20);
  assert.equal(r.total, 400);
});

test('VAT แยก วันที่ภาษาไทยมีเวลา และ OCR อ่าน x เป็น %', () => {
  const r = parseReceipt(`Bangkok Bistro

TAX ID 0105551234567

20 พ.ย. 69 12:10

ผัดไทยกุ้งสด                            150.00
ต้มยํากุ้ง                                220.00
ข้าวสวย 2 % 15.00                     30.00
Coke Zero                                45.00
ยอดรวม                                445.00
VAT 7%                                  31.15
ยอดชําระ                               476.15`, { today });
  assert.equal(r.date, '2026-11-20');
  assert.deepEqual(r.items, [
    { name: 'ผัดไทยกุ้งสด', price: 150 },
    { name: 'ต้มยำกุ้ง', price: 220 },
    { name: 'ข้าวสวย x2', price: 30 },
    { name: 'Coke Zero', price: 45 },
  ]);
  assert.equal(r.total, 476.15);
  assert.equal(r.servicePct, 7);
  assert.equal(r.vatAdded, true);
});

test('รูปไม่ชัด: จุดทศนิยมหาย และวรรณยุกต์หาย', () => {
  const r = parseReceipt(`ร้านกาแฟบ้านสวน
โต๊ะ 5
ลาเดต้เย็น                                  65.00
2x อเมริกาโน                            120 00
ครัวซองด์เนยสด                         85 00
รวม                                     270.00
สวนลดสมาชิก                           -20 00
ยอดสุทธิ                                 250 00
เงินสด                                   500 00`, { today });
  assert.deepEqual(r.items.map((i) => i.price), [65, 120, 85]);
  assert.equal(r.discount, 20);
  assert.equal(r.total, 250);
});
