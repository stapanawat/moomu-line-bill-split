import DateInput from '../components/DateInput';
import { useEffect, useState } from 'react';
import { useApp, errorText } from '../context';
import type { BillSummary } from '../types';
import { baht, thDate } from '../lib/format';
import { Alert, Badge, Button, Empty, Field, Icon, Loading, Person } from '../components/ui';
import BillDetailModal from './BillDetail';

export function StatusBadge({ b }: { b: Pick<BillSummary, 'status' | 'paidCount' | 'debtorCount'> }) {
  if (b.status === 'settled' || (b.debtorCount > 0 && b.paidCount === b.debtorCount)) return <Badge kind="success">ชำระครบ</Badge>;
  if (b.paidCount > 0) return <Badge kind="warning">ชำระแล้ว {b.paidCount}/{b.debtorCount}</Badge>;
  return <Badge kind="danger">รอชำระ</Badge>;
}

export default function BillsPage() {
  const { api, session, member, liveTick } = useApp();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bills, setBills] = useState<BillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // เปิดบิลทันทีเมื่อมาจากปุ่มในการ์ดของบอท (?bill=<id>)
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(location.search).get('bill'));

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.listBills({ q: debounced, from, to })
      .then((b) => alive && setBills(b))
      .catch((e) => alive && setError(errorText(e)));
    return () => { alive = false; };
  }, [api, debounced, from, to, reload, liveTick]);

  const dateError = from && to && from > to ? 'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด' : undefined;
  const list = bills ?? [];
  const total = list.reduce((s, b) => s + b.total, 0);
  const due = list.reduce((s, b) => s + b.dueAmount, 0);

  return (
    <>
      <section className="card">
        <div className="filters">
          <Field label="ค้นหา" className="grow">
            <div className="input-icon">
              <Icon name="search" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อร้าน รายการอาหาร หรือชื่อสมาชิก" />
            </div>
          </Field>
          <Field label="ตั้งแต่วันที่" error={dateError}>
            <DateInput value={from} onChange={setFrom} placeholder="ทั้งหมด" />
          </Field>
          <Field label="ถึงวันที่">
            <DateInput value={to} onChange={setTo} placeholder="ถึงปัจจุบัน" />
          </Field>
          {(q || from || to) && (
            <Button variant="ghost" onClick={() => { setQ(''); setFrom(''); setTo(''); }}>ล้างตัวกรอง</Button>
          )}
        </div>
      </section>

      {error && (
        <Alert kind="error" title="ไม่สามารถโหลดรายการบิลได้" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setReload((r) => r + 1)}>ลองใหม่</Button>}>
          {error}
        </Alert>
      )}

      {!bills && !error && <Loading />}

      {bills && (
        <>
          <div className="stats">
            <div className="stat"><div className="stat-k">จำนวนบิล</div><div className="stat-v">{list.length}</div></div>
            <div className="stat"><div className="stat-k">ยอดรวม (บาท)</div><div className="stat-v">{baht(total)}</div></div>
            <div className="stat"><div className="stat-k">ยอดค้างชำระ (บาท)</div><div className={`stat-v ${due > 0 ? 'text-danger' : ''}`}>{baht(due)}</div></div>
          </div>

          <section className="card card-flush">
            <div className="card-head"><h2>รายการบิล</h2><span className="muted">{list.length} รายการ</span></div>
            {list.length === 0 ? (
              <Empty icon="receipt" title={q || from || to ? 'ไม่พบรายการที่ตรงกับเงื่อนไข' : 'ยังไม่มีบิลในกลุ่มนี้'}>
                {q || from || to ? 'ลองเปลี่ยนคำค้นหาหรือช่วงวันที่' : 'เริ่มต้นได้ที่เมนู "สร้างบิล"'}
              </Empty>
            ) : (
              <ul className="bill-list">
                {list.map((b) => {
                  const mine = b.memberIds.includes(session.me.id) && b.payerId !== session.me.id;
                  return (
                    <li key={b.id}>
                      <button className="bill-row" onClick={() => setOpenId(b.id)}>
                        <div className="bill-date"><span>{thDate(b.date)}</span></div>
                        <div className="bill-main">
                          <div className="bill-title">{b.title}</div>
                          <div className="bill-meta">
                            <Person member={member(b.payerId)} size={20} suffix={<span className="muted"> รับเงิน</span>} />
                            {b.hasReceipt && <span className="meta-tag"><Icon name="image" size={14} />มีใบเสร็จ</span>}
                            {mine && <span className="meta-tag meta-mine">ท่านร่วมจ่าย</span>}
                          </div>
                        </div>
                        <div className="bill-right">
                          <div className="bill-total">{baht(b.total)}</div>
                          <StatusBadge b={b} />
                        </div>
                        <Icon name="chevron" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {openId && <BillDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
