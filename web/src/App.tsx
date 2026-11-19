import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveStatus } from './lib/live';
import { initPlatform, isMock, type Platform } from './lib/platform';
import GroupPicker from './pages/GroupPicker';
import type { Api } from './lib/api';
import type { Member, Session } from './types';
import { Ctx, errorText, type AppCtx } from './context';
import { Alert, Avatar, Button, Icon, Loading } from './components/ui';
import BillsPage from './pages/BillsPage';
import NewBillPage from './pages/NewBillPage';
import SummaryPage from './pages/SummaryPage';
import PaymentSettings from './pages/PaymentSettings';

type Tab = 'bills' | 'new' | 'summary' | 'account';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'bills', label: 'รายการบิล', icon: 'list' },
  { id: 'new', label: 'สร้างบิล', icon: 'plus' },
  { id: 'summary', label: 'สรุปยอด', icon: 'chart' },
  { id: 'account', label: 'บัญชีรับเงิน', icon: 'wallet' },
];

export default function App() {
  const [api, setApi] = useState<Api | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [picker, setPicker] = useState<Platform | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('bills');
  const [flash, setFlash] = useState<{ title: string; text?: string } | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // รับเหตุการณ์เรียลไทม์: มีคนชำระเงิน สร้างบิล หรือรายชื่อเปลี่ยน -> โหลดข้อมูลใหม่ทันที
  useEffect(() => {
    if (!api) return;
    return api.subscribe((e) => {
      setLiveTick((t) => t + 1);
      if (e.type === 'members') api.session().then((s) => setSession(s)).catch(() => {});
      if (e.message) {
        setNotice(e.message);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 5000);
      }
    }, setLiveStatus);
  }, [api]);

  useEffect(() => {
    let alive = true;
    setFatal(null);
    (async () => {
      try {
        const p = await initPlatform();
        if (!p.api) { if (alive) setPicker(p); return; }
        const s = await p.api.session();
        if (!alive) return;
        setApi(p.api);
        setSession(s);
      } catch (e) {
        if (alive) setFatal(errorText(e));
      }
    })();
    return () => { alive = false; };
  }, [attempt]);

  const setMembers = useCallback((members: Member[]) => setSession((s) => (s ? { ...s, members } : s)), []);
  const setMe = useCallback((me: Member) => setSession((s) => (s ? { ...s, me, members: s.members.map((m) => (m.id === me.id ? me : m)) } : s)), []);

  const ctx: AppCtx | null = useMemo(() => {
    if (!api || !session) return null;
    const map = new Map(session.members.map((m) => [m.id, m]));
    return { api, session, member: (id) => map.get(id), setMembers, setMe, liveTick };
  }, [api, session, setMembers, setMe, liveTick]);

  if (fatal) {
    return (
      <div className="page-center">
        <Alert kind="error" title="ไม่สามารถเปิดหน้าเว็บได้" action={<Button variant="secondary" icon="refresh" onClick={() => setAttempt((a) => a + 1)}>ลองใหม่อีกครั้ง</Button>}>
          {fatal}
        </Alert>
      </div>
    );
  }
  if (picker) return <GroupPicker getToken={picker.getToken} />;
  if (!ctx) return <div className="page-center"><Loading text="กำลังเชื่อมต่อกับ LINE" /></div>;

  const go = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }); };

  return (
    <Ctx.Provider value={ctx}>
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <span className="brand-mark"><Icon name="receipt" size={20} /></span>
            <div>
              <div className="brand-title">ระบบหารบิล</div>
              <div className="brand-sub">{ctx.session.group.name}</div>
            </div>
          </div>
          <div className="me">
            <span className={`live live-${liveStatus}`} title={liveStatus === 'live' ? 'ข้อมูลอัปเดตอัตโนมัติ' : 'กำลังเชื่อมต่อใหม่'}>
              <span className="live-dot" />{liveStatus === 'live' ? 'อัปเดตอัตโนมัติ' : 'กำลังเชื่อมต่อ'}
            </span>
            <Avatar member={ctx.session.me} size={34} /><span className="me-name">{ctx.session.me.name}</span>
          </div>
        </div>
        <nav className="container tabs" aria-label="เมนูหลัก">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              <Icon name={t.icon} size={18} /><span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {notice && (
        <div className="live-toast" role="status">
          <Alert kind="success" title="ข้อมูลอัปเดตแล้ว" onClose={() => setNotice(null)}>{notice}</Alert>
        </div>
      )}
      <main className="container main">
        {isMock && (
          <Alert kind="info" title="โหมดข้อมูลตัวอย่าง">ข้อมูลในหน้านี้เป็นข้อมูลจำลองสำหรับทดสอบหน้าตา ไม่ได้เชื่อมต่อกับ LINE หรือฐานข้อมูล</Alert>
        )}
        {flash && tab === 'bills' && (
          <Alert kind="success" title={flash.title} onClose={() => setFlash(null)}>{flash.text}</Alert>
        )}
        {tab === 'bills' && <BillsPage />}
        {tab === 'new' && (
          <NewBillPage onCreated={(announced) => {
            setFlash({
              title: 'บันทึกรายการเรียบร้อยแล้ว',
              text: announced ? 'ระบบได้แจ้งยอดที่ต้องชำระไปยังกลุ่ม LINE แล้ว' : 'บันทึกสำเร็จ แต่ไม่สามารถส่งข้อความแจ้งในกลุ่ม LINE ได้ในขณะนี้',
            });
            go('bills');
          }} />
        )}
        {tab === 'summary' && <SummaryPage />}
        {tab === 'account' && <PaymentSettings />}
      </main>
    </Ctx.Provider>
  );
}
