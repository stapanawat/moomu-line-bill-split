import fs from 'node:fs';
const m = await import(process.cwd() + '/src/messages.js');
const url = 'https://liff.line.me/LIFF_ID?g=GROUP_KEY';
const mem = (id) => ({ id });
const card = m.menuMessage(url, { groupName: 'แก๊งคาเฟ่ฮอปปิ้ง', dues: { bills: [{ debtors: [{ member: mem('a'), amount: 162.5 }, { member: mem('b'), amount: 142.5 }] }, { debtors: [{ member: mem('a'), amount: 121 }, { member: mem('c'), amount: 132 }] }] } });
fs.writeFileSync(process.argv[2], JSON.stringify(card.contents, null, 2));
