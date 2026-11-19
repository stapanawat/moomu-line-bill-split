import { useEffect, useState } from 'react';
import { fetchMyGroups, type MyGroups } from '../lib/api';
import { errorText } from '../context';
import { Alert, Button, Icon, Loading } from '../components/ui';

/** หน้าเลือกกลุ่ม: แสดงเมื่อเปิดเว็บโดยไม่ได้มาจากลิงก์ในกลุ่ม LINE */
export default function GroupPicker({ getToken }: { getToken: () => string | null }) {
  const [data, setData] = useState<MyGroups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchMyGroups(getToken())
      .then((d) => {
        if (!alive) return;
        if (d.groups.length === 1 && !d.isAdmin) return open(d.groups[0].key);
        setData(d);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => { alive = false; };
  }, [getToken, attempt]);

  function open(key: string) {
    try { sessionStorage.setItem('groupKey', key); } catch { /* ignore */ }
    location.href = `${location.pathname}?g=${encodeURIComponent(key)}`;
  }

  const copyId = async () => {
    if (!data) return;
    try { await navigator.clipboard.writeText(data.userId); setCopied(true); } catch { /* ignore */ }
  };

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <span className="brand-mark"><Icon name="receipt" size={20} /></span>
            <div><div className="brand-title">ระบบหารบิล</div><div className="brand-sub">เลือกกลุ่มที่ต้องการ</div></div>
          </div>
        </div>
      </header>
      <main className="container main">
        {error && (
          <Alert kind="error" title="ไม่สามารถโหลดรายชื่อกลุ่มได้" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setAttempt((a) => a + 1)}>ลองใหม่</Button>}>{error}</Alert>
        )}
        {!data && !error && <Loading text="กำลังโหลดรายชื่อกลุ่ม" />}
        {data && (
          <>
            {data.isAdmin && <Alert kind="info" title="ท่านเข้าสู่ระบบในฐานะผู้ดูแล">แสดงทุกกลุ่มที่บอทเป็นสมาชิกอยู่</Alert>}
            {data.groups.length === 0 ? (
              <Alert kind="warning" title="ยังไม่พบกลุ่มของท่าน">
                <ol className="steps-list">
                  <li>เชิญบอทหารบิลเข้ากลุ่ม LINE ที่ต้องการ</li>
                  <li>พิมพ์ข้อความใดก็ได้ในกลุ่มนั้นหนึ่งครั้ง เพื่อให้ระบบรู้จักท่าน</li>
                  <li>กดลิงก์ที่บอทส่งในกลุ่ม หรือกลับมาที่หน้านี้แล้วกดลองใหม่</li>
                </ol>
              </Alert>
            ) : (
              <section className="card card-flush">
                <div className="card-head"><h2>กลุ่มของท่าน</h2><span className="muted">{data.groups.length} กลุ่ม</span></div>
                <ul className="bill-list">
                  {data.groups.map((g) => (
                    <li key={g.key}>
                      <button className="bill-row" onClick={() => open(g.key)}>
                        <span className="store-icon"><Icon name="list" size={20} /></span>
                        <div className="bill-main"><div className="bill-title">{g.name}</div></div>
                        <Icon name="chevron" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => setAttempt((a) => a + 1)}>โหลดรายชื่อกลุ่มอีกครั้ง</Button>
            </div>
            <section className="card">
              <h2 className="card-title">LINE User ID ของท่าน</h2>
              <p className="muted">ใช้สำหรับตั้งค่าผู้ดูแลระบบ (ADMIN_LINE_USER_IDS) บนเซิร์ฟเวอร์</p>
              <div className="save-preset">
                <input readOnly value={data.userId} onFocus={(e) => e.target.select()} />
                <Button size="sm" variant="secondary" onClick={copyId}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</Button>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
