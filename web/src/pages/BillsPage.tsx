import DateInput from '../components/DateInput';
import { useEffect, useState } from 'react';
import { useApp, errorText } from '../context';
import type { BillSummary } from '../types';
import { thDate } from '../lib/format';
import { Alert, Badge, Button, Empty, Field, Icon, Meter, Money, PaidTrack, Person, SkeletonRows } from '../components/ui';
import BillDetailModal from './BillDetail';

function groupByMonth(list: BillSummary[]) {
  const out: { key: string; label: string; total: number; bills: BillSummary[] }[] = [];
  for (const b of list) {
    const key = b.date.slice(0, 7);
    let g = out.find((x) => x.key === key);
    if (!g) {
      g = { key, label: new Date(`${key}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }), total: 0, bills: [] };
      out.push(g);
    }
    g.total += b.total;
    g.bills.push(b);
  }
  return out;
}

export function StatusBadge({ b }: { b: Pick<BillSummary, 'status' | 'paidCount' | 'debtorCount'> }) {
  if (b.status === 'cancelled') return <Badge kind="neutral">ยกเลิกแล้ว</Badge>;
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
  const [showDates, setShowDates] = useState(false);
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
  const filtered = Boolean(q || from || to);
  const months = groupByMonth(list);

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาร้าน รายการ หรือชื่อสมาชิก" aria-label="ค้นหา" />
        </div>
        <button type="button" className={`tool-btn ${showDates || from || to ? 'on' : ''}`} aria-expanded={showDates} onClick={() => setShowDates((v) => !v)}>
          <Icon name="calendar" /><span>ช่วงวันที่</span>{(from || to) && <span className="tool-dot" aria-label="มีตัวกรองวันที่" />}
        </button>
      </div>
      {showDates && (
        <div className="date-range reveal">
          <Field label="ตั้งแต่วันที่" error={dateError}>
            <DateInput value={from} onChange={setFrom} placeholder="ทั้งหมด" />
          </Field>
          <Field label="ถึงวันที่">
            <DateInput value={to} onChange={setTo} placeholder="ถึงปัจจุบัน" />
          </Field>
        </div>
      )}
      {filtered && (
        <div className="filter-note">
          <span>{bills ? `พบ ${list.length} บิล` : 'กำลังค้นหา'}</span>
          <button type="button" className="link-btn" onClick={() => { setQ(''); setFrom(''); setTo(''); }}>ล้างตัวกรอง</button>
        </div>
      )}

      {error && (
        <Alert kind="error" title="ไม่สามารถโหลดรายการบิลได้" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setReload((r) => r + 1)}>ลองใหม่</Button>}>
          {error}
        </Alert>
      )}

      {!bills && !error && <SkeletonRows rows={4} label="กำลังโหลดรายการบิล" />}

      {bills && (
        <>
          {list.length > 0 && (
            <section className="ledger-hero" aria-label="ภาพรวมยอด">
              <div className="ledger-hero-main">
                <span className="kicker">{due > 0.004 ? 'ยังค้างชำระในกลุ่ม' : 'ทุกบิลชำระครบแล้ว'}</span>
                <div className={`hero-figure ${due > 0.004 ? 'is-due' : 'is-clear'}`}><Money value={due} /><small>บาท</small></div>
              </div>
              <Meter value={total - due} max={total} label="สัดส่วนที่ชำระแล้ว" />
              <dl className="hero-facts">
                <div><dt>ยอดรวม{filtered ? 'ที่ค้นหา' : ''}</dt><dd><Money value={total} /></dd></div>
                <div><dt>ชำระแล้ว</dt><dd><Money value={total - due} tone="paid" /></dd></div>
                <div><dt>จำนวนบิล</dt><dd className="money">{list.length}</dd></div>
              </dl>
            </section>
          )}

          {list.length === 0 ? (
            <Empty icon="receipt" title={filtered ? 'ไม่พบรายการที่ตรงกับเงื่อนไข' : 'ยังไม่มีบิลในกลุ่มนี้'}>
              {filtered ? 'ลองเปลี่ยนคำค้นหาหรือช่วงวันที่' : 'เริ่มต้นได้ที่เมนู "สร้างบิล"'}
            </Empty>
          ) : (
            months.map((m) => (
              <section className="month" key={m.key} aria-label={m.label}>
                <header className="month-head">
                  <h2>{m.label}</h2>
                  <span className="month-meta">{m.bills.length} บิล · <Money value={m.total} /></span>
                </header>
                <ul className="bill-list">
                  {m.bills.map((b) => {
                    const mine = b.memberIds.includes(session.me.id) && b.payerId !== session.me.id;
                    const settled = b.status === 'settled' || (b.debtorCount > 0 && b.paidCount === b.debtorCount);
                    const d = new Date(`${b.date.slice(0, 10)}T00:00:00`);
                    return (
                      <li key={b.id}>
                        <button className={`bill-row ${b.status === 'cancelled' ? 'is-cancelled' : ''}`} onClick={() => setOpenId(b.id)}>
                          <span className="bill-date" aria-label={thDate(b.date, true)}>
                            <b>{d.getDate()}</b><span>{d.toLocaleDateString('th-TH', { weekday: 'short' })}</span>
                          </span>
                          <span className="bill-main">
                            <span className="bill-title">{b.title}</span>
                            <span className="bill-meta">
                              <Person member={member(b.payerId)} size={18} suffix={<span className="muted"> รับเงิน</span>} />
                              {b.hasReceipt && <span className="meta-tag" title="มีรูปใบเสร็จ"><Icon name="receipt" size={14} /><span className="sr-only">มีใบเสร็จ</span></span>}
                              {mine && <span className="meta-tag meta-mine">ท่านร่วมจ่าย</span>}
                            </span>
                          </span>
                          <span className="bill-right">
                            <Money value={b.total} className="bill-total" />
                            {b.status === 'cancelled' ? <StatusBadge b={b} /> : (
                              <span className={`bill-progress ${settled ? 'is-done' : ''}`}>
                                <PaidTrack paid={b.paidCount} total={b.debtorCount} />
                                <span>{settled ? 'ครบ' : `${b.paidCount}/${b.debtorCount}`}</span>
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      {openId && <BillDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
