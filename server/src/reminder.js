// ทวงยอดค้างวันละครั้ง
import * as db from './db.js';
import * as line from './line.js';
import { reminderMessages } from './messages.js';
import { config, liffUrl } from './config.js';
import { groupDues, toReminderInput } from './services.js';

export const localDate = (d = new Date(), tz = config.remind.timezone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export const localTime = (d = new Date(), tz = config.remind.timezone) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

/** ส่งข้อความทวงทุกกลุ่มที่มียอดค้าง (ข้ามกลุ่มที่ทวงไปแล้ววันนี้) */
export async function runReminders({ now = new Date() } = {}) {
  const runDate = localDate(now);
  const groups = await db.listActiveGroups();
  const result = { date: runDate, sent: 0, skipped: 0, failed: 0 };
  for (const g of groups) {
    try {
      const dues = await groupDues(g.id);
      if (!dues.bills.length) { result.skipped++; continue; }
      if (!(await db.claimReminder(g.id, runDate))) { result.skipped++; continue; }
      try {
        await line.push(g.line_group_id, reminderMessages(toReminderInput(dues), liffUrl(g.access_key), now.toISOString()));
        result.sent++;
      } catch (e) {
        await db.releaseReminder(g.id, runDate).catch(() => {});
        if (e.status === 403 || e.status === 404) await db.deactivateGroup(g.line_group_id).catch(() => {}); // บอทไม่อยู่ในกลุ่มแล้ว
        throw e;
      }
    } catch (e) {
      result.failed++;
      console.error('[remind] group', g.id, e.message);
    }
  }
  console.log('[remind]', JSON.stringify(result));
  return result;
}

/** ตัวตั้งเวลาภายในเซิร์ฟเวอร์ (ใช้เมื่อเซิร์ฟเวอร์เปิดตลอด) */
export function startInternalScheduler() {
  let lastRun = '';
  const tick = () => {
    const now = new Date();
    const today = localDate(now);
    if (localTime(now) === config.remind.time && lastRun !== today) {
      lastRun = today;
      runReminders({ now }).catch((e) => console.error('[remind] run failed', e));
    }
  };
  setInterval(tick, 20 * 1000).unref();
  console.log(`[remind] ตั้งเวลาทวงทุกวัน ${config.remind.time} (${config.remind.timezone})`);
}
