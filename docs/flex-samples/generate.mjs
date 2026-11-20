// สร้างตัวอย่างการ์ด: cd server && node ../docs/flex-samples/generate.mjs ../docs/flex-samples
// แล้วนำไฟล์ .json ไปวางใน LINE Flex Message Simulator เพื่อดูหน้าตา
import fs from 'node:fs';
const m = await import(process.cwd() + '/src/messages.js');
const out = process.argv[2];
const mem = (n, i) => ({ line_user_id: 'U' + i, display_name: n });
const url = 'https://liff.line.me/LIFF_ID?g=GROUP_KEY';
const flexOf = (arr) => [].concat(arr).find((x) => x.type === 'flex');
const save = (name, msg) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(flexOf(msg).contents, null, 2));
save('1-welcome', m.welcomeMessage(url));
save('2-new-bill', m.newBillMessage({ id: 'b1', title: 'Roast Coffee นิมมาน', bill_date: '2026-11-19', total: 575 }, 'มายด์',
  [{ member: mem('Fern', 2), amount: 122.5 }, { member: mem('ต้นกล้า', 3), amount: 162.5 }, { member: mem('Bank', 4), amount: 142.5 }], url));
save('3-paid', m.paymentSuccessMessage(mem('ต้นกล้า', 3), { amount: 162.5, transRef: '016324153045BPM07432' }, [{ id: 'b1', title: 'Roast Coffee นิมมาน', bill_date: '2026-11-19', amount: 162.5, payerName: 'มายด์',
  shares: [{ name: 'Bank', amount: 142.5, status: 'due' }, { name: 'Fern', amount: 122.5, status: 'paid' }, { name: 'ต้นกล้า', amount: 162.5, status: 'paid' }, { name: 'มายด์', amount: 147.5, status: 'payee' }] }], url));
save('4-paid-complete', m.paymentSuccessMessage(mem('Bank', 4), { amount: 142.5, transRef: '016324153112BPM07501' }, [{ id: 'b1', title: 'Roast Coffee นิมมาน', bill_date: '2026-11-19', amount: 142.5, payerName: 'มายด์',
  shares: [{ name: 'Bank', amount: 142.5, status: 'paid' }, { name: 'Fern', amount: 122.5, status: 'paid' }, { name: 'ต้นกล้า', amount: 162.5, status: 'paid' }, { name: 'มายด์', amount: 147.5, status: 'payee' }] }], url));
save('5-slip-failed', m.paymentFailMessage(mem('Bank', 4), 'amount', { slipAmount: 100, dues: [{ title: 'Roast Coffee นิมมาน', amount: 142.5 }], url }));
save('6-reminder', m.reminderMessages([
  { id: 'b1', title: 'Roast Coffee นิมมาน', bill_date: '2026-11-19', payerName: 'มายด์', debtors: [{ member: mem('ต้นกล้า', 3), amount: 162.5 }, { member: mem('Bank', 4), amount: 142.5 }] },
  { id: 'b2', title: 'ทริปเชียงใหม่ มื้อเย็น', bill_date: '2026-11-14', payerName: 'Bank', debtors: [{ member: mem('ต้นกล้า', 3), amount: 121 }, { member: mem('Fern', 2), amount: 132 }] },
], url, '2026-11-20T11:00:00Z'));
console.log(fs.readdirSync(out).join(' '));
