import { useEffect, useMemo, useState } from 'react';
import { useApp, errorText } from '../context';
import type { Summary, SummaryBill } from '../types';
import { baht, thDate } from '../lib/format';
import { Alert, Avatar, Badge, Button, Empty, Field, Icon, Loading, Person, Segmented } from '../components/ui';

type View = 'person' | 'store';

/** ชื่อร้านเดียวกันแต่พิมพ์ต่างกันเล็กน้อย (เว้นวรรค/ตัวพิมพ์) ให้รวมเป็นร้านเดียว */
const storeKey = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

export default function SummaryPage() {
  const { api, session, member, liveTick } = useApp();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [view, setView] = useState<View>('person');
  const [onlyDue, setOnlyDue] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.summary({ from, to }).then((d) => alive && setData(d)).catch((e) => alive && setError(errorText(e)));
    return () => { alive = false; };
  }, [api, from, to, reload, liveTick]);

  const name = (id: string) => member(id)?.name ?? 'ไม่ทราบชื่อ';
  const t = text.trim().toLowerCase();

  // ---------- รายคน ----------
  const people = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { memberId: string; total: number; paid: number; due: number; bills: { bill: SummaryBill; amount: number; paid: boolean }[] }>();
    for (const b of data.bills) {
      for (const s of b.shares) {
        if (s.isPayer) continue;
        const r = map.get(s.memberId) || { memberId: s.memberId, total: 0, paid: 0, due: 0, bills: [] };
        r.total += s.amount;
        if (s.paid) r.paid += s.amount; else r.due += s.amount;
        r.bills.push({ bill: b, amount: s.amount, paid: s.paid });
        map.set(s.memberId, r);
      }
    }
    return [...map.values()]
      .map((r) => ({ ...r, bills: r.bills.sort((a, b) => Number(a.paid) - Number(b.paid) || b.bill.date.localeCompare(a.bill.date)) }))
      .filter((r) => !t || name(r.memberId).toLowerCase().includes(t) || r.bills.some((x) => x.bill.title.toLowerCase().includes(t)))
      .filter((r) => !onlyDue || r.due > 0.004)
      .sort((a, b) => b.due - a.due || b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t, onlyDue]);

  // ---------- รายร้าน ----------
  const stores = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { key: string; title: string; total: number; due: number; rounds: SummaryBill[]; memberIds: Set<string> }>();
    for (const b of data.bills) {
      const k = storeKey(b.title);
      const s = map.get(k) || { key: k, title: b.title.trim(), total: 0, due: 0, rounds: [], memberIds: new Set<string>() };
      s.total += b.total;
      s.due += b.shares.filter((x) => !x.isPayer && !x.paid).reduce((a, x) => a + x.amount, 0);
      s.rounds.push(b);
      b.shares.forEach((x) => s.memberIds.add(x.memberId));
      map.set(k, s);
    }
    return [...map.values()]
      .map((s) => ({ ...s, rounds: s.rounds.sort((a, b) => b.date.localeCompare(a.date)) }))
      .filter((s) => !t || s.title.toLowerCase().includes(t) || [...s.memberIds].some((id) => name(id).toLowerCase().includes(t)))
      .filter((s) => !onlyDue || s.due > 0.004)
      .sort((a, b) => b.rounds[0].date.localeCompare(a.rounds[0].date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t, onlyDue]);

  const mine = data?.rows.find((r) => r.memberId === session.me.id);

  return (
    <div className="stack">
      <section className="card">
        <div className="filters">
          <Field label="ตั้งแต่วันที่" error={from && to && from > to ? 'วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด' : undefined}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="ถึงวันที่"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label={view === 'person' ? 'ค้นหาชื่อสมาชิกหรือร้าน' : 'ค้นหาร้านหรือชื่อสมาชิก'} className="grow">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์คำค้นหา" />
          </Field>
        </div>
      </section>

      {error && <Alert kind="error" title="ไม่สามารถโหลดสรุปยอดได้" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setReload((r) => r + 1)}>ลองใหม่</Button>}>{error}</Alert>}
      {!data && !error && <Loading />}

      {data && (
        <>
          {mine && mine.due > 0 && (
            <Alert kind="warning" title={`ท่านมียอดค้างชำระ ${baht(mine.due)} บาท`}>
              {mine.dueBills.map((b) => `${b.title} ${baht(b.amount)} บาท (ชำระให้ ${b.payerName})`).join(' / ')}
            </Alert>
          )}

          <div className="stats">
            <div className="stat"><div className="stat-k">ยอดที่ต้องชำระทั้งหมด</div><div className="stat-v">{baht(data.totals.total)}</div></div>
            <div className="stat"><div className="stat-k">ชำระแล้ว</div><div className="stat-v text-success">{baht(data.totals.paid)}</div></div>
            <div className="stat"><div className="stat-k">คงค้าง</div><div className="stat-v text-danger">{baht(data.totals.due)}</div></div>
          </div>

          <div className="view-bar">
            <Segmented<View> value={view} onChange={setView} options={[
              { value: 'person', label: 'สรุปรายคน', icon: 'list' },
              { value: 'store', label: 'สรุปรายร้าน', icon: 'receipt' },
            ]} />
            <label className="toggle">
              <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} />
              <span>แสดงเฉพาะที่ยังค้าง</span>
            </label>
          </div>

          {view === 'person' ? (
            people.length === 0 ? <section className="card"><Empty icon="chart" title="ไม่มีข้อมูลในเงื่อนไขที่เลือก" /></section> : (
              <div className="group-list">
                {people.map((r) => (
                  <details key={r.memberId} className={`group-card ${r.memberId === session.me.id ? 'is-me' : ''}`} open={r.due > 0.004}>
                    <summary className="group-head">
                      <Avatar member={member(r.memberId)} size={36} />
                      <div className="group-title">
                        <div className="group-name">{name(r.memberId)}{r.memberId === session.me.id && <span className="muted"> (ท่าน)</span>}</div>
                        <div className="group-sub">{r.bills.length} รายการ · ชำระแล้ว {baht(r.paid)} จาก {baht(r.total)}</div>
                      </div>
                      <div className="group-amount">
                        <span className="group-amount-k">คงค้าง</span>
                        <span className={r.due > 0.004 ? 'text-danger' : 'text-success'}>{r.due > 0.004 ? baht(r.due) : 'ครบแล้ว'}</span>
                      </div>
                      <span className="group-chevron"><Icon name="chevron" /></span>
                    </summary>
                    <ul className="line-list">
                      {r.bills.map(({ bill, amount, paid }) => (
                        <li key={bill.id} className="line">
                          <div className="line-main">
                            <div className="line-title">{bill.title}</div>
                            <div className="line-sub">{thDate(bill.date)} · ชำระให้ {name(bill.payerId)}</div>
                          </div>
                          <div className="line-right">
                            <div className="line-amount">{baht(amount)}</div>
                            {paid ? <Badge kind="success">ชำระแล้ว</Badge> : <Badge kind="danger">รอชำระ</Badge>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            )
          ) : (
            stores.length === 0 ? <section className="card"><Empty icon="receipt" title="ไม่มีข้อมูลในเงื่อนไขที่เลือก" /></section> : (
              <div className="group-list">
                {stores.map((s) => (
                  <details key={s.key} className="group-card" open={s.due > 0.004}>
                    <summary className="group-head">
                      <span className="store-icon"><Icon name="receipt" size={20} /></span>
                      <div className="group-title">
                        <div className="group-name">{s.title}</div>
                        <div className="group-sub">{s.rounds.length} ครั้ง · ล่าสุด {thDate(s.rounds[0].date)} · สมาชิก {s.memberIds.size} คน · ยอดรวม {baht(s.total)}</div>
                      </div>
                      <div className="group-amount">
                        <span className="group-amount-k">คงค้าง</span>
                        <span className={s.due > 0.004 ? 'text-danger' : 'text-success'}>{s.due > 0.004 ? baht(s.due) : 'ครบแล้ว'}</span>
                      </div>
                      <span className="group-chevron"><Icon name="chevron" /></span>
                    </summary>
                    {s.rounds.map((b) => {
                      const debt = b.shares.filter((x) => !x.isPayer);
                      const paidN = debt.filter((x) => x.paid).length;
                      return (
                        <div key={b.id} className="round">
                          <div className="round-head">
                            <span className="round-date"><Icon name="calendar" size={15} />{thDate(b.date, true)}</span>
                            <span className="muted">ผู้รับเงิน {name(b.payerId)} · ยอดรวม {baht(b.total)} · ชำระแล้ว {paidN}/{debt.length}</span>
                          </div>
                          <ul className="line-list">
                            {b.shares.map((x) => (
                              <li key={x.memberId} className="line line-member">
                                <div className="line-main"><Person member={member(x.memberId)} size={36} /></div>
                                <div className="line-right">
                                  <div className="line-amount">{baht(x.amount)}</div>
                                  {x.isPayer ? <Badge kind="neutral">ผู้รับเงิน</Badge> : x.paid ? <Badge kind="success">ชำระแล้ว</Badge> : <Badge kind="danger">รอชำระ</Badge>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </details>
                ))}
              </div>
            )
          )}

          <Alert kind="info" title={`ระบบจะแจ้งเตือนผู้ที่ยังไม่ชำระในกลุ่ม LINE ทุกวัน เวลา ${session.remindTime} น.`}>
            เมื่อสมาชิกส่งสลิปในกลุ่มและตรวจสอบผ่าน สถานะจะเปลี่ยนเป็น "ชำระแล้ว" โดยอัตโนมัติ
          </Alert>
        </>
      )}
    </div>
  );
}
