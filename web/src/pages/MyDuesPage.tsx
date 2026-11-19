import { useEffect, useRef, useState } from 'react';
import { useApp, errorText } from '../context';
import type { SummaryRow } from '../types';
import { baht, thDate } from '../lib/format';
import { Alert, Button, Icon, Loading } from '../components/ui';
import BillDetailModal from './BillDetail';

const AUTO_CLOSE_SECONDS = 5;

/** ยอดค้างของฉัน: ถ้าไม่มียอดค้าง แจ้งแล้วกลับไปที่ LINE อัตโนมัติ */
export default function MyDuesPage({ onShowBills }: { onShowBills: () => void }) {
  const { api, session, liveTick, inClient, closeWindow } = useApp();
  const [row, setRow] = useState<SummaryRow | null | undefined>(undefined); // undefined = กำลังโหลด, null = ไม่มีค้าง
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.summary({}).then((s) => {
      if (!alive) return;
      const mine = s.rows.find((r) => r.memberId === session.me.id);
      setRow(mine && mine.due > 0.004 ? mine : null);
    }).catch((e) => alive && setError(errorText(e)));
    return () => { alive = false; };
  }, [api, session.me.id, liveTick, reload]);

  if (error) {
    return <Alert kind="error" title="ไม่สามารถตรวจสอบยอดค้างได้" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setReload((r) => r + 1)}>ลองใหม่</Button>}>{error}</Alert>;
  }
  if (row === undefined) return <Loading text="กำลังตรวจสอบยอดค้างของท่าน" />;
  if (row === null) return <NoDues inClient={inClient} closeWindow={closeWindow} onShowBills={onShowBills} paused={openId !== null} />;

  return (
    <div className="stack">
      <section className="due-hero">
        <div className="due-hero-k">ยอดค้างชำระของท่าน</div>
        <div className="due-hero-v">{baht(row.due)} <small>บาท</small></div>
        <div className="due-hero-sub">{row.dueBills.length} รายการ · กดรายการเพื่อดู QR และแนบสลิป</div>
      </section>

      <section className="card card-flush">
        <ul className="bill-list">
          {row.dueBills.map((b) => (
            <li key={b.billId}>
              <button className="bill-row" onClick={() => setOpenId(b.billId)}>
                <div className="bill-main">
                  <div className="bill-title">{b.title}</div>
                  <div className="bill-meta"><span className="muted">{thDate(b.date)} · ชำระให้ {b.payerName}</span></div>
                </div>
                <div className="bill-right">
                  <div className="bill-total text-danger">{baht(b.amount)}</div>
                  <span className="pay-link"><Icon name="qr" size={15} />ชำระเงิน</span>
                </div>
                <Icon name="chevron" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Alert kind="info" title="เมื่อโอนแล้ว">แนบสลิปในหน้ารายการ หรือส่งรูปสลิปในกลุ่ม LINE ระบบจะตรวจสอบและอัปเดตยอดให้อัตโนมัติ</Alert>
      {openId && <BillDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function NoDues({ inClient, closeWindow, onShowBills, paused }: {
  inClient: boolean; closeWindow: () => void; onShowBills: () => void; paused: boolean;
}) {
  const [left, setLeft] = useState(AUTO_CLOSE_SECONDS);
  const [cancelled, setCancelled] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // กลับไปที่ LINE อัตโนมัติ (เฉพาะเมื่อเปิดในแอป LINE)
  useEffect(() => {
    if (!inClient || cancelled || paused) return;
    timer.current = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(timer.current);
  }, [inClient, cancelled, paused]);
  useEffect(() => { if (left <= 0 && inClient && !cancelled) closeWindow(); }, [left, inClient, cancelled, closeWindow]);

  return (
    <section className="card no-dues">
      <span className="no-dues-icon"><Icon name="success" size={44} /></span>
      <h2>ไม่มียอดค้างชำระ</h2>
      <p className="muted">ท่านชำระครบทุกรายการแล้ว ขอบคุณที่ชำระตรงเวลา</p>
      <div className="no-dues-actions">
        {inClient && <Button onClick={closeWindow}>กลับไปที่ LINE</Button>}
        <Button variant="secondary" onClick={() => { setCancelled(true); onShowBills(); }}>ดูรายการบิลทั้งหมด</Button>
      </div>
      {inClient && !cancelled && left > 0 && (
        <p className="no-dues-count">
          จะกลับไปที่ LINE อัตโนมัติใน {left} วินาที
          <button className="link-btn" onClick={() => setCancelled(true)}>อยู่หน้านี้ต่อ</button>
        </p>
      )}
    </section>
  );
}
