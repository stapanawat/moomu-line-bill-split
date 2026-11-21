import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, assertConfig } from './config.js';
import { verifySignature } from './line.js';
import { handleEvents } from './bot.js';
import { routeApi, openEvents } from './api.js';
import { runReminders, startInternalScheduler } from './reminder.js';
import { readBody, sendJson, sendError, HttpError } from './http.js';
import { getTempFile, contentDisposition } from './tempfiles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '..', config.webDist);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.webp': 'image/webp',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  let file = path.join(webDist, rel);
  if (!file.startsWith(webDist)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(webDist, 'index.html'); // SPA
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('ยังไม่ได้ build เว็บ (web/dist)'); }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    // ---- LINE webhook ----
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const raw = await readBody(req, 1024 * 1024);
      if (!verifySignature(raw, req.headers['x-line-signature'])) {
        throw new HttpError(401, 'bad_signature', 'invalid signature');
      }
      sendJson(res, 200, { ok: true }); // ตอบ LINE ทันที แล้วค่อยประมวลผล
      const body = JSON.parse(raw.toString('utf8'));
      handleEvents(body.events || []).catch((e) => console.error('[webhook]', e));
      return;
    }

    // ---- ทวงรายวัน (เรียกจากตัวตั้งเวลาภายนอก) ----
    if (url.pathname === '/cron/remind' && (req.method === 'POST' || req.method === 'GET')) {
      const secret = req.headers['x-cron-secret'] || url.searchParams.get('secret') || '';
      if (!config.remind.cronSecret || !safeEq(secret, config.remind.cronSecret)) throw new HttpError(401, 'unauthorized', 'unauthorized');
      return sendJson(res, 200, await runReminders());
    }

    if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });

    // ---- ไฟล์ดาวน์โหลดชั่วคราว: /dl/<token>/<ชื่อไฟล์> ----
    const dl = /^\/dl\/([\w-]{16,40})(?:\/|$)/.exec(url.pathname);
    if (dl && (req.method === 'GET' || req.method === 'HEAD')) {
      const f = getTempFile(dl[1]);
      if (!f) {
        res.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('ลิงก์ดาวน์โหลดหมดอายุแล้ว กรุณากดบันทึกรูป QR ใหม่อีกครั้ง');
      }
      res.writeHead(200, {
        'Content-Type': f.contentType,
        'Content-Length': f.buffer.length,
        'Content-Disposition': contentDisposition(f.name, url.searchParams.get('view') === '1'),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(req.method === 'HEAD' ? undefined : f.buffer);
    }

    // ---- ค่าตั้งค่าที่เว็บต้องใช้ ----
    if (url.pathname === '/app-config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(`window.APP_CONFIG=${JSON.stringify({ liffId: config.line.liffId, devAuth: Boolean(config.devAuthUserId) })};`);
    }

    if (url.pathname === '/api/events' && req.method === 'GET') return await openEvents(req, res, url);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 200, await routeApi(req, url));

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    throw new HttpError(404, 'not_found', 'not found');
  } catch (e) {
    if (!res.headersSent) sendError(res, e);
  }
});

assertConfig();
server.listen(config.port, () => console.log(`[server] พร้อมใช้งานที่พอร์ต ${config.port}`));
if (config.remind.internal) startInternalScheduler();
