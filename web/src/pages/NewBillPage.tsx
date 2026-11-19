import { useMemo, useRef, useState } from 'react';
import { computeShares, normalizePromptPay } from '../../../shared/billing.js';
import { useApp, errorText } from '../context';
import { ApiError } from '../lib/api';
import { baht, compressImage, todayIso } from '../lib/format';
import { Alert, Button, Field, Icon, Person } from '../components/ui';
import ParticipantPicker from '../components/ParticipantPicker';
import type { Member } from '../types';

interface ItemDraft { key: number; name: string; price: string; memberIds: string[] | null }
let keySeq = 1;
const newItem = (): ItemDraft => ({ key: keySeq++, name: '', price: '', memberIds: null });

export default function NewBillPage({ onCreated }: { onCreated: (announced: boolean) => void }) {
  const { api, session, member } = useApp();
  const me = session.me;
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIso());
  const meIsMember = session.members.some((m) => m.id === me.id);
  const [payerId, setPayerId] = useState(meIsMember ? me.id : session.members[0]?.id ?? '');
  const [promptpay, setPromptpay] = useState(me.promptpayId || '');
  const [servicePct, setServicePct] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [people, setPeopleRaw] = useState<string[]>(payerId ? [payerId] : []);
  const setPeople = (ids: string[]) => setPeopleRaw(ids.includes(payerId) ? ids : [payerId, ...ids]);
  const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const shareIds = (it: ItemDraft) => (it.memberIds ?? people).filter((id) => people.includes(id));
  const calc = useMemo(
    () => computeShares(items.map((it) => ({ price: Number(it.price) || 0, memberIds: shareIds(it) })), Number(servicePct) || 0, Number(discount) || 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, people, servicePct, discount],
  );

  const changePayer = (id: string) => {
    setPayerId(id);
    setPromptpay(member(id)?.promptpayId || '');
    if (!people.includes(id)) setPeople([...people, id]);
  };
  const updateItem = (key: number, patch: Partial<ItemDraft>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const toggleItemMember = (it: ItemDraft, id: string) => {
    const cur = shareIds(it);
    updateItem(it.key, { memberIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  const pickImage = async (file: File | undefined, set: (s: string | null) => void, field: string) => {
    if (!file) return;
    try {
      set(await compressImage(file));
      setErrors(({ [field]: _omit, ...rest }) => rest);
    } catch {
      setErrors((e) => ({ ...e, [field]: 'ไม่สามารถอ่านไฟล์รูปได้ กรุณาเลือกไฟล์รูปภาพ (JPG หรือ PNG)' }));
    }
  };

  function validate() {
    const f: Record<string, string> = {};
    if (!title.trim()) f.title = 'กรุณาระบุชื่อรายการหรือชื่อร้าน';
    if (!date) f.date = 'กรุณาระบุวันที่';
    const pp = promptpay.trim();
    if (pp && !normalizePromptPay(pp)) f.promptpayId = 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก';
    if (!pp && !qr) f.promptpayId = 'กรุณาระบุเลขพร้อมเพย์ หรือแนบรูป QR สำหรับรับเงิน';
    if (people.length < 2) f.people = 'กรุณาเลือกผู้ร่วมจ่ายอย่างน้อย 2 คน (รวมผู้รับเงิน)';
    const s = Number(servicePct);
    if (Number.isNaN(s) || s < 0 || s > 100) f.servicePct = 'ค่าบริการต้องอยู่ระหว่าง 0–100%';
    if (Number(discount) < 0) f.discount = 'ส่วนลดต้องไม่ติดลบ';
    const filled = items.filter((it) => it.name.trim() || it.price);
    if (!filled.length) f.items = 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ';
    items.forEach((it, idx) => {
      if (!it.name.trim() && !it.price) return;
      if (!it.name.trim()) f[`items.${idx}.name`] = `รายการที่ ${idx + 1}: กรุณาระบุชื่อ`;
      if (!(Number(it.price) > 0)) f[`items.${idx}.price`] = `รายการที่ ${idx + 1}: ราคาต้องมากกว่า 0`;
      if (!shareIds(it).length) f[`items.${idx}.members`] = `รายการที่ ${idx + 1}: กรุณาเลือกผู้ร่วมจ่ายอย่างน้อย 1 คน`;
    });
    if (filled.length && calc.total <= 0 && !f.discount) f.discount = 'ยอดรวมหลังหักส่วนลดต้องมากกว่า 0';
    return f;
  }

  const submit = async () => {
    setFormError(null);
    const f = validate();
    setErrors(f);
    if (Object.keys(f).length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSaving(true);
    try {
      const filled = items.filter((it) => it.name.trim() || it.price);
      const r = await api.createBill({
        title: title.trim(), date, payerId, promptpayId: promptpay.trim(),
        servicePct: Number(servicePct) || 0, discount: Number(discount) || 0,
        items: filled.map((it) => ({ name: it.name.trim(), price: Number(it.price), memberIds: shareIds(it) })),
        receiptImage: receipt, qrImage: qr,
      });
      onCreated(r.announced);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setFormError(errorText(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setSaving(false); }
  };

  const errorList = Object.values(errors);
  const payeeOptions: Member[] = session.members;

  return (
    <div ref={topRef} className="stack">
      {(formError || errorList.length > 0) && (
        <Alert kind="error" title={formError && !errorList.length ? 'ไม่สามารถบันทึกรายการได้' : 'กรุณาตรวจสอบข้อมูลก่อนบันทึก'} onClose={() => { setFormError(null); setErrors({}); }}>
          {errorList.length ? <ul className="error-list">{errorList.map((m, i) => <li key={i}>{m}</li>)}</ul> : formError}
        </Alert>
      )}

      <section className="card">
        <h2 className="card-title">ข้อมูลบิล</h2>
        <div className="grid-2">
          <Field label="ชื่อรายการ / ชื่อร้าน" error={errors.title} className="span-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น Roast Coffee สาขานิมมาน" maxLength={120} />
          </Field>
          <Field label="วันที่" error={errors.date}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="ผู้รับเงิน (ผู้ที่ชำระบิลไปก่อน)">
            <select value={payerId} onChange={(e) => changePayer(e.target.value)}>
              {payeeOptions.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === me.id ? ' (ท่าน)' : ''}</option>)}
            </select>
          </Field>
          <Field label="เลขพร้อมเพย์ของผู้รับเงิน" error={errors.promptpayId} hint="เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก ระบบจะสร้าง QR พร้อมยอดเงินของแต่ละคนให้" className="span-2">
            <input inputMode="numeric" value={promptpay} onChange={(e) => setPromptpay(e.target.value)} placeholder="0812345678" />
          </Field>
        </div>
      </section>

      <ParticipantPicker people={people} setPeople={setPeople} payerId={payerId} error={errors.people} />

      <section className="card">
        <h2 className="card-title">รายการอาหารและเครื่องดื่ม</h2>
        {errors.items && <p className="field-error">{errors.items}</p>}
        <div className="items">
          {items.map((it, idx) => (
            <div className="item" key={it.key}>
              <div className="item-row">
                <span className="item-no">{idx + 1}</span>
                <Field label="รายการ" error={errors[`items.${idx}.name`]} className="grow">
                  <input value={it.name} onChange={(e) => updateItem(it.key, { name: e.target.value })} placeholder="ชื่อรายการ" />
                </Field>
                <Field label="ราคา (บาท)" error={errors[`items.${idx}.price`]} className="w-price">
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={it.price} onChange={(e) => updateItem(it.key, { price: e.target.value })} placeholder="0.00" />
                </Field>
                <button type="button" className="icon-btn danger" aria-label={`ลบรายการที่ ${idx + 1}`} onClick={() => setItems((l) => (l.length > 1 ? l.filter((x) => x.key !== it.key) : [newItem()]))}>
                  <Icon name="trash" />
                </button>
              </div>
              <div className="item-members">
                <span className="muted">หารกับ:</span>
                {people.map((id) => (
                  <button key={id} type="button" className={`chip chip-sm ${shareIds(it).includes(id) ? 'on' : ''}`} onClick={() => toggleItemMember(it, id)}>
                    {member(id)?.name}
                  </button>
                ))}
              </div>
              {errors[`items.${idx}.members`] && <p className="field-error">{errors[`items.${idx}.members`]}</p>}
            </div>
          ))}
        </div>
        <Button variant="secondary" icon="plus" onClick={() => setItems((l) => [...l, newItem()])}>เพิ่มรายการ</Button>
        <div className="grid-2 mt">
          <Field label="ค่าบริการ / ภาษี (%)" error={errors.servicePct}>
            <input type="number" inputMode="decimal" min="0" max="100" value={servicePct} onChange={(e) => setServicePct(e.target.value)} />
          </Field>
          <Field label="ส่วนลด (บาท)" error={errors.discount}>
            <input type="number" inputMode="decimal" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">เอกสารแนบ</h2>
        <div className="grid-2">
          <Upload label="รูปใบเสร็จ" hint="สมาชิกทุกคนในกลุ่มเปิดดูได้" value={receipt} error={errors.receiptImage}
            onPick={(f) => pickImage(f, setReceipt, 'receiptImage')} onClear={() => setReceipt(null)} />
          <Upload label="รูป QR รับเงิน (ไม่บังคับ)" hint="ใช้เมื่อไม่ต้องการให้ระบบสร้าง QR จากเลขพร้อมเพย์" value={qr} error={errors.qrImage}
            onPick={(f) => pickImage(f, setQr, 'qrImage')} onClear={() => setQr(null)} />
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">สรุปยอดที่แต่ละคนต้องชำระ</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>สมาชิก</th><th className="num">ยอด (บาท)</th></tr></thead>
            <tbody>
              {Object.entries(calc.shares).map(([id, amt]) => (
                <tr key={id}>
                  <td><Person member={member(id)} size={24} suffix={id === payerId ? <span className="muted"> (ผู้รับเงิน)</span> : null} /></td>
                  <td className="num">{baht(Number(amt))}</td>
                </tr>
              ))}
              {!Object.keys(calc.shares).length && <tr><td colSpan={2} className="muted center">กรอกรายการและราคาเพื่อดูยอดของแต่ละคน</td></tr>}
            </tbody>
            <tfoot>
              <tr><td>ราคารวมก่อนปรับ</td><td className="num">{baht(calc.subtotal)}</td></tr>
              <tr className="total-row"><td>ยอดรวมบิล</td><td className="num">{baht(calc.total)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div className="actions">
          <Button onClick={submit} loading={saving}>บันทึกและแจ้งในกลุ่ม LINE</Button>
        </div>
      </section>
    </div>
  );
}

function Upload({ label, hint, value, error, onPick, onClear }: {
  label: string; hint: string; value: string | null; error?: string; onPick: (f?: File) => void; onClear: () => void;
}) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {value ? (
        <div className="upload-preview">
          <img src={value} alt={label} />
          <Button variant="secondary" size="sm" icon="trash" onClick={onClear}>นำรูปออก</Button>
        </div>
      ) : (
        <label className="upload">
          <input type="file" accept="image/*" onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
          <Icon name="image" size={26} />
          <span>แตะเพื่อเลือกรูป</span>
        </label>
      )}
      {error ? <span className="field-error">{error}</span> : <span className="field-hint">{hint}</span>}
    </div>
  );
}
