// แจ้งเหตุการณ์แบบเรียลไทม์ไปยังเว็บ (Server-Sent Events) แยกตามกลุ่ม
// หมายเหตุ: เก็บผู้เชื่อมต่อไว้ในหน่วยความจำ ใช้ได้กับเซิร์ฟเวอร์ 1 instance (Render ค่าเริ่มต้น)
const clients = new Map(); // groupId -> Set<res>
const HEARTBEAT_MS = 25000;

/** เปิดการเชื่อมต่อ SSE ให้ผู้ใช้ในกลุ่ม */
export function subscribe(groupId, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write(`event: ready\ndata: {}\n\n`);
  const set = clients.get(groupId) || new Set();
  set.add(res);
  clients.set(groupId, set);
  const ping = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const close = () => {
    clearInterval(ping);
    set.delete(res);
    if (!set.size) clients.delete(groupId);
  };
  req.on('close', close);
  res.on('error', close);
}

/**
 * ส่งเหตุการณ์ให้ทุกคนที่เปิดเว็บของกลุ่มนี้อยู่
 * @param {string} groupId
 * @param {'payment'|'bill_created'|'members'|'presets'} type
 * @param {object} data เช่น { billIds, memberId, message }
 */
export function publish(groupId, type, data = {}) {
  const set = clients.get(groupId);
  if (!set) return 0;
  const payload = `event: ${type}\ndata: ${JSON.stringify({ type, at: Date.now(), ...data })}\n\n`;
  for (const res of set) { try { res.write(payload); } catch { /* ปิดไปแล้ว */ } }
  return set.size;
}

export const connectionCount = (groupId) => clients.get(groupId)?.size || 0;
