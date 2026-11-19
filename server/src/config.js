const env = process.env;

const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: Number(env.PORT || 3000),
  webDist: env.WEB_DIST || '../web/dist',
  production: env.NODE_ENV === 'production',

  line: {
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    accessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    loginChannelId: env.LINE_LOGIN_CHANNEL_ID || '',
    liffId: env.LIFF_ID || '',
  },

  supabase: {
    url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: env.SUPABASE_BUCKET || 'bill-files',
  },

  slip: {
    provider: (env.SLIP_PROVIDER || 'easyslip').toLowerCase(),
    easyslipKey: env.EASYSLIP_API_KEY || '',
    easyslipUrl: env.EASYSLIP_URL || 'https://api.easyslip.com/v2/verify/bank',
    slipokBranch: env.SLIPOK_BRANCH_ID || '',
    slipokKey: env.SLIPOK_API_KEY || '',
    overpayTolerance: Number(env.AMOUNT_OVERPAY_TOLERANCE ?? 1),
  },

  remind: {
    cronSecret: env.CRON_SECRET || '',
    internal: bool(env.ENABLE_INTERNAL_CRON),
    time: env.REMIND_TIME || '18:00',
    timezone: env.TIMEZONE || 'Asia/Bangkok',
  },

  announceNewBill: bool(env.ANNOUNCE_NEW_BILL, true),
  // LINE userId ของผู้ดูแล (คั่นด้วยจุลภาค) เห็นทุกกลุ่มที่บอทอยู่
  adminUserIds: (env.ADMIN_LINE_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  devAuthUserId: env.NODE_ENV === 'production' ? '' : env.DEV_AUTH_USER_ID || '',
};

export const liffUrl = (accessKey) =>
  `https://liff.line.me/${config.line.liffId}?g=${encodeURIComponent(accessKey)}`;

export function assertConfig() {
  const missing = [];
  if (!config.line.channelSecret) missing.push('LINE_CHANNEL_SECRET');
  if (!config.line.accessToken) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
  if (!config.line.liffId) missing.push('LIFF_ID');
  if (!config.line.loginChannelId && !config.devAuthUserId) missing.push('LINE_LOGIN_CHANNEL_ID');
  if (!config.supabase.url) missing.push('SUPABASE_URL');
  if (!config.supabase.key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) console.warn('[config] ยังไม่ได้ตั้งค่า:', missing.join(', '));
  return missing;
}
