import { useEffect, useState } from 'react';
import { useApp, errorText } from '../context';
import { ApiError } from '../lib/api';
import type { MemberPreset } from '../types';
import { Alert, Avatar, Button, Icon } from './ui';

interface Recent { key: string; label: string; memberIds: string[] }

/** เลือกผู้ร่วมจ่าย: ชุดรายชื่อที่บันทึกไว้, รายชื่อจากบิลล่าสุด, หรือเลือกทีละคน */
export default function ParticipantPicker({ people, setPeople, payerId, error }: {
  people: string[]; setPeople: (ids: string[]) => void; payerId: string; error?: string;
}) {
  const { api, session, setMembers } = useApp();
  const known = new Set(session.members.map((m) => m.id));
  const [presets, setPresets] = useState<MemberPreset[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [manage, setManage] = useState(false);
  const [note, setNote] = useState<{ kind: 'success' | 'error' | 'info'; title: string; text?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.listPresets(), api.listBills({})])
      .then(([p, bills]) => {
        if (!alive) return;
        setPresets(p);
        // ชุดรายชื่อจากบิลล่าสุด (ไม่ซ้ำกัน สูงสุด 3 ชุด)
        const seen = new Set<string>();
        const list: Recent[] = [];
        for (const b of bills) {
          const ids = [...new Set(b.memberIds)].sort();
          const key = ids.join(',');
          if (ids.length < 2 || seen.has(key)) continue;
          seen.add(key);
          list.push({ key, label: b.title, memberIds: ids });
          if (list.length >= 3) break;
        }
        setRecent(list);
      })
      .catch((e) => alive && setLoadError(errorText(e)));
    return () => { alive = false; };
  }, [api]);

  const apply = (ids: string[], label: string) => {
    const valid = ids.filter((id) => known.has(id));
    const next = valid.includes(payerId) ? valid : [payerId, ...valid];
    setPeople(next);
    const missing = ids.length - valid.length;
    setNote({
      kind: 'info',
      title: `ใช้รายชื่อ "${label}" แล้ว (${next.length} คน)`,
      text: missing > 0 ? `มีสมาชิก ${missing} คนที่ไม่อยู่ในกลุ่มแล้ว จึงไม่ได้ถูกเลือก` : 'สามารถแตะชื่อด้านล่างเพื่อเพิ่มหรือนำออกได้',
    });
  };

  const sameAs = (ids: string[]) => {
    const a = [...new Set(ids.filter((id) => known.has(id)))].sort().join(',');
    return a === [...people].sort().join(',');
  };

  const toggle = (id: string) => {
    if (people.includes(id)) { if (id !== payerId) setPeople(people.filter((p) => p !== id)); }
    else setPeople([...people, id]);
  };

  const save = async () => {
    setSaving(true); setNote(null);
    try {
      const p = await api.savePreset({ name: name.trim(), memberIds: people });
      setPresets((list) => [...list.filter((x) => x.id !== p.id && x.name !== p.name), p].sort((a, b) => a.name.localeCompare(b.name, 'th')));
      setNote({ kind: 'success', title: `บันทึกชุดรายชื่อ "${p.name}" แล้ว`, text: 'ครั้งต่อไปแตะชื่อชุดเพื่อเลือกทุกคนในชุดได้ทันที' });
      setNaming(false); setName('');
    } catch (e) {
      const fields = e instanceof ApiError && e.fields ? Object.values(e.fields) : [];
      setNote({ kind: 'error', title: 'ไม่สามารถบันทึกชุดรายชื่อได้', text: fields.length ? fields.join(' ') : errorText(e) });
    } finally { setSaving(false); }
  };

  const remove = async (p: MemberPreset) => {
    setNote(null);
    try {
      await api.deletePreset(p.id);
      setPresets((list) => list.filter((x) => x.id !== p.id));
      setNote({ kind: 'success', title: `ลบชุดรายชื่อ "${p.name}" แล้ว` });
    } catch (e) {
      setNote({ kind: 'error', title: 'ไม่สามารถลบชุดรายชื่อได้', text: errorText(e) });
    }
  };

  const sync = async () => {
    setSyncing(true); setNote(null);
    try {
      const r = await api.syncMembers();
      setMembers(r.members);
      setNote({
        kind: 'info', title: `อัปเดตรายชื่อแล้ว (${r.members.length} คน)`,
        text: r.fullList ? undefined : 'หากยังไม่พบชื่อสมาชิกบางคน ให้สมาชิกท่านนั้นพิมพ์ข้อความใดก็ได้ในกลุ่ม LINE หนึ่งครั้ง แล้วกดอัปเดตอีกครั้ง',
      });
    } catch (e) {
      setNote({ kind: 'error', title: 'อัปเดตรายชื่อไม่สำเร็จ', text: errorText(e) });
    } finally { setSyncing(false); }
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">ผู้ร่วมจ่าย <span className="count-pill">{people.length} คน</span></h2>
        <Button variant="secondary" size="sm" icon="refresh" loading={syncing} onClick={sync}>อัปเดตรายชื่อจากกลุ่ม</Button>
      </div>

      {note && <Alert kind={note.kind} title={note.title} onClose={() => setNote(null)}>{note.text}</Alert>}
      {loadError && <Alert kind="warning" title="โหลดชุดรายชื่อไม่สำเร็จ">{loadError} ท่านยังเลือกรายชื่อทีละคนได้ตามปกติ</Alert>}

      <div className="picker-block">
        <div className="picker-label">
          <span>ชุดรายชื่อที่ใช้บ่อย</span>
          {presets.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setManage((v) => !v)}>{manage ? 'เสร็จสิ้น' : 'จัดการ'}</button>
          )}
        </div>
        {presets.length === 0 ? (
          <p className="field-hint">ยังไม่มีชุดรายชื่อ เลือกสมาชิกด้านล่างแล้วกด "บันทึกเป็นชุดรายชื่อ" เพื่อใช้ซ้ำครั้งต่อไป</p>
        ) : (
          <div className="preset-list">
            {presets.map((p) => (
              <div key={p.id} className={`preset ${sameAs(p.memberIds) ? 'on' : ''}`}>
                <button type="button" className="preset-main" onClick={() => apply(p.memberIds, p.name)} disabled={manage}>
                  <span className="preset-name">{p.name}</span>
                  <span className="preset-sub">{p.memberIds.filter((id) => known.has(id)).length} คน</span>
                </button>
                {manage && (
                  <button type="button" className="preset-del" aria-label={`ลบชุด ${p.name}`} onClick={() => remove(p)}><Icon name="trash" size={16} /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="picker-block">
          <div className="picker-label"><span>รายชื่อจากบิลล่าสุด</span></div>
          <div className="preset-list">
            {recent.map((r) => (
              <div key={r.key} className={`preset preset-recent ${sameAs(r.memberIds) ? 'on' : ''}`}>
                <button type="button" className="preset-main" onClick={() => apply(r.memberIds, r.label)}>
                  <span className="preset-name">{r.label}</span>
                  <span className="preset-sub">{r.memberIds.filter((id) => known.has(id)).length} คน</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="picker-block">
        <div className="picker-label">
          <span>เลือกทีละคน</span>
          <span className="picker-actions">
            <button type="button" className="link-btn" onClick={() => setPeople(session.members.map((m) => m.id))}>เลือกทุกคน</button>
            <button type="button" className="link-btn" onClick={() => setPeople([payerId])}>ล้างการเลือก</button>
          </span>
        </div>
        <div className="chips">
          {session.members.map((m) => (
            <button key={m.id} type="button" className={`chip ${people.includes(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id)} aria-pressed={people.includes(m.id)}>
              <Avatar member={m} size={24} /><span>{m.name}</span>
              {m.id === payerId && <span className="chip-tag">ผู้รับเงิน</span>}
            </button>
          ))}
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>

      {naming ? (
        <div className="save-preset">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ตั้งชื่อชุด เช่น แก๊งคาเฟ่" maxLength={40} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && save()} />
          <Button size="sm" loading={saving} onClick={save}>บันทึก</Button>
          <Button size="sm" variant="ghost" onClick={() => { setNaming(false); setName(''); }}>ยกเลิก</Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setNaming(true)} disabled={people.length < 2}>
          บันทึกรายชื่อที่เลือกเป็นชุดรายชื่อ
        </Button>
      )}
    </section>
  );
}
