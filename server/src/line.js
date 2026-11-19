import crypto from 'node:crypto';
import { config } from './config.js';

const API = 'https://api.line.me';
const DATA_API = 'https://api-data.line.me';

export class LineApiError extends Error {
  constructor(status, body, path) {
    super(`LINE API ${status} ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

/** ตรวจลายเซ็น x-line-signature ของ webhook */
export function verifySignature(rawBody, signature, secret = config.line.channelSecret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  let got;
  try { got = Buffer.from(signature, 'base64'); } catch { return false; }
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

async function call(path, { method = 'GET', body, base = API } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.line.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
  if (!res.ok) throw new LineApiError(res.status, data, path);
  return data;
}

export const reply = (replyToken, messages) =>
  call('/v2/bot/message/reply', { method: 'POST', body: { replyToken, messages: [].concat(messages) } });

export const push = (to, messages) =>
  call('/v2/bot/message/push', { method: 'POST', body: { to, messages: [].concat(messages) } });

export const getGroupMemberProfile = (groupId, userId) =>
  call(`/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`);

export const getGroupSummary = (groupId) => call(`/v2/bot/group/${encodeURIComponent(groupId)}/summary`);

/** ใช้ได้เฉพาะบัญชี Verified / Premium บัญชีอื่นจะได้ 403 */
export const getGroupMemberIds = (groupId, start) =>
  call(`/v2/bot/group/${encodeURIComponent(groupId)}/members/ids${start ? `?start=${encodeURIComponent(start)}` : ''}`);

/** ดาวน์โหลดรูปที่ผู้ใช้ส่งมา */
export async function getContent(messageId) {
  const res = await fetch(`${DATA_API}/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${config.line.accessToken}` },
  });
  if (!res.ok) throw new LineApiError(res.status, await res.text(), 'content');
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

// ---------- ตรวจ ID token จาก LIFF ----------
const tokenCache = new Map(); // idToken -> { sub, name, picture, exp }

export async function verifyIdToken(idToken) {
  const hit = tokenCache.get(idToken);
  if (hit && hit.exp * 1000 > Date.now()) return hit;
  const res = await fetch(`${API}/oauth2/v2.1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: config.line.loginChannelId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.sub) return null;
  const info = { sub: data.sub, name: data.name, picture: data.picture, exp: data.exp };
  tokenCache.set(idToken, info);
  if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
  return info;
}

// ---------- ข้อความแบบมีแท็ก (textV2) ----------

/** หนีวงเล็บปีกกาในข้อความทั่วไป (textV2 ใช้ {key} เป็นตัวแทน) */
export const escV2 = (s) => String(s ?? '').replace(/\{/g, '{{').replace(/\}/g, '}}');

/**
 * ตัวช่วยประกอบข้อความ textV2
 *   const b = textV2(); b.add('สวัสดี '); b.mention(userId); b.build()
 */
export function textV2() {
  let text = '';
  let raw = '';
  const substitution = {};
  let n = 0;
  const api = {
    add(s) { text += escV2(s); raw += String(s ?? ''); return api; },
    line(s = '') { return api.add(String(s ?? '') + '\n'); },
    mention(userId, fallbackName) {
      if (!userId) return api.add('@' + (fallbackName || ''));
      raw += '@' + (fallbackName || '');
      const key = `m${n++}`;
      substitution[key] = { type: 'mention', mentionee: { type: 'user', userId } };
      text += `{${key}}`;
      return api;
    },
    get length() { return text.length; },
    build() {
      // ไม่มีการแท็ก ใช้ข้อความธรรมดา
      if (!n) return { type: 'text', text: raw.replace(/\n+$/, '') };
      return { type: 'textV2', text: text.replace(/\n+$/, ''), substitution };
    },
  };
  return api;
}
