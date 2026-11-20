import DateInput from '../components/DateInput';
import { useMemo, useRef, useState } from 'react';
import { computeShares, normalizePromptPay } from '../../../shared/billing.js';
import { useApp, errorText } from '../context';
import { ApiError } from '../lib/api';
import { baht, compressImage, todayIso } from '../lib/format';
import { Alert, Button, Field, Icon, Person } from '../components/ui';
import ParticipantPicker from '../components/ParticipantPicker';
import type { BillDetail, Member } from '../types';
import { parseReceipt } from '../../../shared/receipt.js';
import { ocrReceipt, type OcrStage } from '../lib/ocr';

type ScanState =
  | { kind: 'idle' }
  | { kind: 'busy'; stage: OcrStage; pct: number }
  | { kind: 'done'; level: 'success' | 'warning'; title: string; text: string };

interface ItemDraft { key: number; name: string; price: string; memberIds: string[] | null }
let keySeq = 1;
const newItem = (): ItemDraft => ({ key: keySeq++, name: '', price: '', memberIds: null });

/** รูปแนบ: keep = ใช้รูปเดิม (แก้ไขบิล), none = ไม่มี/นำออก, new = เลือกรูปใหม่ */
type ImageState = { kind: 'keep' } | { kind: 'none' } | { kind: 'new'; data: string };

export default function NewBillPage({ onCreated, edit, onCancelEdit }: {
  onCreated: (announced: boolean, financial?: boolean) => void;
  /** มีค่า = โหมดแก้ไขบิล */
  edit?: BillDetail;
  onCancelEdit?: () => void;
}) {
  const { api, session, member } = useApp();
  const me = session.me;
  const isEdit = Boolean(edit);
  const locked = Boolean(edit?.hasPayments); // มีคนจ่ายแล้ว: แก้ได้แค่ชื่อ วันที่ ใบเสร็จ
  const [title, setTitle] = useState(edit?.title ?? '');
  const [date, setDate] = useState(edit?.date ?? todayIso());
  const meIsMember = session.members.some((m) => m.id === me.id);
  const [payerId, setPayerId] = useState(edit?.payerId ?? (meIsMember ? me.id : session.members[0]?.id ?? ''));
  const [promptpay, setPromptpay] = useState(edit ? edit.promptpayId ?? '' : me.promptpayId || '');
  const [servicePct, setServicePct] = useState(String(edit?.servicePct ?? 0));
  const [discount, setDiscount] = useState(String(edit?.discount ?? 0));
  const [people, setPeopleRaw] = useState<string[]>(() => {
    if (!edit) return payerId ? [payerId] : [];
    return [...new Set([edit.payerId, ...edit.items.flatMap((i) => i.memberIds)])];
  });
  const setPeople = (ids: string[]) => setPeopleRaw(ids.includes(payerId) ? ids : [payerId, ...ids]);
  const [items, setItems] = useState<ItemDraft[]>(() =>
    edit ? edit.items.map((i) => ({ key: keySeq++, name: i.name, price: String(i.price), memberIds: [...i.memberIds] })) : [newItem()]);
  const [receiptState, setReceiptState] = useState<ImageState>(edit?.receiptUrl ? { kind: 'keep' } : { kind: 'none' });
  const [qrState, setQrState] = useState<ImageState>(edit?.qrUrl ? { kind: 'keep' } : { kind: 'none' });
  const preview = (s: ImageState, url?: string | null) => (s.kind === 'new' ? s.data : s.kind === 'keep' ? url ?? null : null);
  const receipt = preview(receiptState, edit?.receiptUrl);
  const qr = preview(qrState, edit?.qrUrl);
  const setReceipt = (d: string | null) => setReceiptState(d ? { kind: 'new', data: d } : { kind: 'none' });
  const setQr = (d: string | null) => setQrState(d ? { kind: 'new', data: d } : { kind: 'none' });
  /** ค่าที่ส่งให้ API: undefined = คงเดิม, null = นำออก, string = รูปใหม่ */
  const payloadImage = (s: ImageState) => (s.kind === 'new' ? s.data : s.kind === 'none' ? null : undefined);
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

  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });
  const scanReceipt = async (file?: File) => {
    if (!file) return;
    let image: string;
    try { image = await compressImage(file, 2000, 0.9); } catch {
      setScan({ kind: 'done', level: 'warning', title: 'ไม่สามารถอ่านไฟล์รูปได้', text: 'กรุณาเลือกไฟล์รูปภาพ (JPG หรือ PNG)' });
      return;
    }
    if (!receipt) setReceipt(await compressImage(file).catch(() => image));
    setScan({ kind: 'busy', stage: 'load', pct: 0 });
    try {
      const text = await ocrReceipt(image, (stage, pct) => setScan({ kind: 'busy', stage, pct }));
      const r = parseReceipt(text, { today: todayIso() });
      const filled: string[] = [];
      if (r.items.length) {
        const fresh = r.items.map((i) => ({ key: keySeq++, name: i.name, price: String(i.price), memberIds: null }));
        setItems((list) => [...list.filter((it) => it.name.trim() || it.price.trim()), ...fresh]);
        filled.push(`${r.items.length} รายการ`);
      }
      if (r.date) { setDate(r.date); filled.push('วันที่'); }
      if (r.title && !title.trim()) { setTitle(r.title); filled.push('ชื่อร้าน'); }
      const svc = r.servicePct ?? (Number(servicePct) || 0);
      const disc = r.discount ?? (Number(discount) || 0);
      if (r.servicePct != null) { setServicePct(String(r.servicePct)); filled.push(r.vatAdded ? 'ค่าบริการและ VAT' : 'ค่าบริการ'); }
      if (r.discount != null) { setDiscount(String(r.discount)); filled.push('ส่วนลด'); }
      if (!r.items.length) {
        setScan({ kind: 'done', level: 'warning', title: 'อ่านรายการจากใบเสร็จไม่ได้', text: 'กรุณาถ่ายรูปให้ตรง เห็นตัวอักษรชัด และไม่มีเงาบัง หรือกรอกรายการเอง' + (filled.length ? ` (เติมให้แล้ว: ${filled.join(' ')})` : '') });
        return;
      }
      const est = computeShares(r.items.map((i) => ({ price: i.price, memberIds: ['x'] })), svc, disc).total;
      const mismatch = r.total != null && Math.abs(est - r.total) > 1;
      setScan(mismatch
        ? { kind: 'done', level: 'warning', title: `เติมข้อมูลจากใบเสร็จแล้ว: ${filled.join(' ')}`, text: `ยอดที่คำนวณได้ ${baht(est)} ไม่ตรงกับยอดในใบเสร็จ ${baht(r.total!)} บาท อาจมีรายการที่อ่านผิดหรือขาดไป หรือมี VAT แยก กรุณาตรวจสอบก่อนบันทึก` }
        : { kind: 'done', level: 'success', title: `เติมข้อมูลจากใบเสร็จแล้ว: ${filled.join(' ')}`, text: 'ระบบอ่านจากรูปอัตโนมัติ กรุณาตรวจชื่อรายการและราคาอีกครั้ง แล้วเลือกว่าแต่ละรายการหารกับใคร' });
    } catch {
      setScan({ kind: 'done', level: 'warning', title: 'สแกนใบเสร็จไม่สำเร็จ', text: 'โหลดตัวอ่านใบเสร็จไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ หรือกรอกรายการเอง' });
    }
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
      const input = {
        title: title.trim(), date, payerId, promptpayId: promptpay.trim(),
        servicePct: Number(servicePct) || 0, discount: Number(discount) || 0,
        items: filled.map((it) => ({ name: it.name.trim(), price: Number(it.price), memberIds: shareIds(it) })),
      };
      if (edit) {
        const r = await api.updateBill(edit.id, { ...input, receiptImage: payloadImage(receiptState), qrImage: payloadImage(qrState) });
        onCreated(r.announced, r.financial);
      } else {
        const r = await api.createBill({ ...input, receiptImage: receipt, qrImage: qr });
        onCreated(r.announced);
      }
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

      {isEdit && (
        locked
          ? <Alert kind="warning" title={`กำลังแก้ไขบิล "${edit!.title}"`}>มีสมาชิกชำระเงินแล้ว จึงแก้ไขได้เฉพาะชื่อรายการ วันที่ และรูปใบเสร็จ หากต้องการแก้ยอดเงินหรือรายการ กรุณายกเลิกบิลนี้แล้วสร้างใหม่</Alert>
          : <Alert kind="info" title={`กำลังแก้ไขบิล "${edit!.title}"`}>ถ้ายอดของสมาชิกเปลี่ยน ระบบจะแจ้งยอดใหม่ในกลุ่ม LINE ให้อัตโนมัติ</Alert>
      )}
      {!locked && (
        <section className="card scan-card">
          <div className="scan-head">
            <div>
              <h2 className="card-title">สแกนใบเสร็จ</h2>
              <p className="muted">ถ่ายรูปหรือเลือกรูปใบเสร็จ ระบบจะอ่านชื่อรายการ ราคา และวันที่มาเติมให้</p>
            </div>
            <label className={`btn btn-secondary ${scan.kind === 'busy' ? 'is-disabled' : ''}`}>
              <input type="file" accept="image/*" hidden disabled={scan.kind === 'busy'} onChange={(e) => { void scanReceipt(e.target.files?.[0]); e.target.value = ''; }} />
              <Icon name="receipt" /> {scan.kind === 'busy' ? 'กำลังอ่าน' : 'เลือกรูปใบเสร็จ'}
            </label>
          </div>
          {scan.kind === 'busy' && (
            <div className="scan-progress" role="status">
              <span>{scan.stage === 'load' ? 'กำลังเตรียมตัวอ่านใบเสร็จ (ครั้งแรกอาจใช้เวลาสักครู่)' : `กำลังอ่านใบเสร็จ ${scan.pct}%`}</span>
              <div className="bar"><div style={{ width: `${scan.stage === 'load' ? 8 : Math.max(8, scan.pct)}%` }} /></div>
            </div>
          )}
          {scan.kind === 'done' && <Alert kind={scan.level} title={scan.title} onClose={() => setScan({ kind: 'idle' })}>{scan.text}</Alert>}
        </section>
      )}

      <section className="card">
        <h2 className="card-title">ข้อมูลบิล</h2>
        <div className="grid-2">
          <Field label="ชื่อรายการ / ชื่อร้าน" error={errors.title} className="span-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น Roast Coffee สาขานิมมาน" maxLength={120} />
          </Field>
          <Field label="วันที่" error={errors.date}>
            <DateInput value={date} onChange={setDate} clearable={false} long />
          </Field>
          <Field label="ผู้รับเงิน (ผู้ที่ชำระบิลไปก่อน)">
            <select value={payerId} onChange={(e) => changePayer(e.target.value)} disabled={locked}>
              {payeeOptions.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === me.id ? ' (ท่าน)' : ''}</option>)}
            </select>
          </Field>
          <Field label="เลขพร้อมเพย์ของผู้รับเงิน" error={errors.promptpayId} hint="เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก ระบบจะสร้าง QR พร้อมยอดเงินของแต่ละคนให้" className="span-2">
            <input inputMode="numeric" value={promptpay} onChange={(e) => setPromptpay(e.target.value)} placeholder="0812345678" disabled={locked} />
          </Field>
        </div>
      </section>

      {!locked && <ParticipantPicker people={people} setPeople={setPeople} payerId={payerId} error={errors.people} />}

      <fieldset className="card plain-fieldset" disabled={locked}>
        <h2 className="card-title">รายการอาหารและเครื่องดื่ม{locked && <span className="lock-tag">ล็อกเนื่องจากมีผู้ชำระแล้ว</span>}</h2>
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
      </fieldset>

      <section className="card">
        <h2 className="card-title">เอกสารแนบ</h2>
        <div className="grid-2">
          <Upload label="รูปใบเสร็จ" hint="สมาชิกทุกคนในกลุ่มเปิดดูได้" value={receipt} error={errors.receiptImage}
            onPick={(f) => pickImage(f, setReceipt, 'receiptImage')} onClear={() => setReceipt(null)} />
          <Upload label="รูป QR รับเงิน (ไม่บังคับ)" hint="ใช้เมื่อไม่ต้องการให้ระบบสร้าง QR จากเลขพร้อมเพย์" value={qr} error={errors.qrImage}
            onPick={(f) => pickImage(f, setQr, 'qrImage')} onClear={() => setQr(null)} disabled={locked} />
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
          {isEdit && <Button variant="secondary" onClick={onCancelEdit} disabled={saving}>ยกเลิกการแก้ไข</Button>}
          <Button onClick={submit} loading={saving}>{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกและแจ้งในกลุ่ม LINE'}</Button>
        </div>
      </section>
    </div>
  );
}

function Upload({ label, hint, value, error, onPick, onClear, disabled }: {
  label: string; hint: string; value: string | null; error?: string; onPick: (f?: File) => void; onClear: () => void; disabled?: boolean;
}) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {value ? (
        <div className="upload-preview">
          <img src={value} alt={label} />
          {!disabled && <Button variant="secondary" size="sm" icon="trash" onClick={onClear}>นำรูปออก</Button>}
        </div>
      ) : (
        <label className={`upload ${disabled ? 'is-disabled' : ''}`}>
          <input type="file" accept="image/*" disabled={disabled} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
          <Icon name="image" size={26} />
          <span>แตะเพื่อเลือกรูป</span>
        </label>
      )}
      {error ? <span className="field-error">{error}</span> : <span className="field-hint">{hint}</span>}
    </div>
  );
}
