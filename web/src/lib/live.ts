// รับเหตุการณ์เรียลไทม์จากเซิร์ฟเวอร์ (Server-Sent Events ผ่าน fetch เพื่อส่ง token ใน header ได้)
export interface LiveEvent {
  type: 'payment' | 'bill_created' | 'bill_updated' | 'members' | 'presets' | 'ready';
  at?: number;
  billIds?: string[];
  memberId?: string;
  message?: string;
}
export type LiveStatus = 'connecting' | 'live' | 'offline';

export function connectLive(
  groupKey: string,
  getToken: () => string | null,
  onEvent: (e: LiveEvent) => void,
  onStatus: (s: LiveStatus) => void,
): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped) return;
    onStatus('offline');
    clearTimeout(timer);
    timer = setTimeout(run, retry);
    retry = Math.min(retry * 2, 15000);
  };

  async function run() {
    if (stopped) return;
    ctrl?.abort();
    ctrl = new AbortController();
    onStatus('connecting');
    try {
      const token = getToken();
      const res = await fetch(`/api/events?g=${encodeURIComponent(groupKey)}`, {
        headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) { onStatus('offline'); return; } // สิทธิ์หมด ไม่ต้องลองซ้ำ
      if (!res.ok || !res.body) return schedule();
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let type = 'message';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trim());
          }
          if (!data.length) continue;
          let payload: LiveEvent;
          try { payload = { ...JSON.parse(data.join('\n')), type } as LiveEvent; } catch { continue; }
          if (type === 'ready') { retry = 1000; onStatus('live'); continue; }
          onEvent(payload);
        }
      }
      schedule();
    } catch {
      if (!stopped) schedule();
    }
  }

  // กลับมาที่แอปแล้วการเชื่อมต่อหลุด ให้ต่อใหม่ทันที (มือถือมักตัดการเชื่อมต่อเมื่อพักแอป)
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !stopped) { retry = 1000; clearTimeout(timer); run(); }
  };
  document.addEventListener('visibilitychange', onVisible);
  run();

  return () => {
    stopped = true;
    clearTimeout(timer);
    ctrl?.abort();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
