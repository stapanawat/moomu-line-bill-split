import DateInput from '../components/DateInput';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { computeShares, normalizePromptPay } from '../../../shared/billing.js';
import { parseReceipt } from '../../../shared/receipt.js';
import { useApp, errorText } from '../context';
import { ApiError } from '../lib/api';
import { ocrReceipt, type OcrStage } from '../lib/ocr';
import { baht, compressImage, todayIso } from '../lib/format';
import { Alert, Avatar, Button, Field, Icon, Meter, Money, Person, memberColor } from '../components/ui';
import ParticipantPicker from '../components/ParticipantPicker';
import type { BillDetail, Member } from '../types';

interface ItemDraft { key: number; name: string; price: string; memberIds: string[] | null }
let keySeq = 1;
const newItem = (): ItemDraft => ({ key: keySeq++, name: '', price: '', memberIds: null });

/** รูปแนบ: keep = ใช้รูปเดิม (แก้ไขบิล), none = ไม่มี/นำออก, new = เลือกรูปใหม่ */
type ImageState = { kind: 'keep' } | { kind: 'none' } | { kind: 'new'; data: string };
type ScanState =
  | { kind: 'idle' }
  | { kind: 'busy'; stage: OcrStage; pct: number }
  | { kind: 'done'; level: 'success' | 'warning'; title: string; text: string };
type PayMethod = 'promptpay' | 'qr';

const STEPS = [
  { key: 'people', label: 'ผู้ร่วมบิล' },
  { key: 'receipt', label: 'ใบเสร็จ' },
  { key: 'items', label: 'รายการ' },
  { key: 'pay', label: 'รับเงิน' },
] as const;

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
  const [step, setStep] = useState(isEdit ? 1 : 0);
  const [reached, setReached] = useState(isEdit ? 3 : 0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [title, setTitle] = useState(edit?.title ?? '');
  const [date, setDate] = useState(edit?.date ?? todayIso());
  const meIsMember = session.members.some((m) => m.id === me.id);
  const [payerId, setPayerId] = useState(edit?.payerId ?? (meIsMember ? me.id : session.members[0]?.id ?? ''));
  const [promptpay, setPromptpay] = useState(edit ? edit.promptpayId ?? '' : me.promptpayId || '');
  const [payMethod, setPayMethod] = useState<PayMethod>(edit ? (edit.promptpayId ? 'promptpay' : edit.qrUrl ? 'qr' : 'promptpay') : 'promptpay');
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
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });
  const [ocrSource, setOcrSource] = useState<string | null>(null);
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
    if (!people.includes(id)) setPeopleRaw([id, ...people]);
  };
  const updateItem = (key: number, patch: Partial<ItemDraft>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const toggleItemMember = (it: ItemDraft, id: string) => {
    const cur = shareIds(it);
    updateItem(it.key, { memberIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // ---------- ใบเสร็จ + อ่านรายการอัตโนมัติ ----------
  const runScan = async (image: string) => {
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
        setScan({ kind: 'done', level: 'warning', title: 'อ่านรายการจากใบเสร็จไม่ได้', text: 'กรอกรายการเองได้ในขั้นตอนถัดไป หรือถ่ายรูปใหม่ให้ตรงและเห็นตัวอักษรชัด' + (filled.length ? ` (เติมให้แล้ว: ${filled.join(' ')})` : '') });
        return;
      }
      const est = computeShares(r.items.map((i) => ({ price: i.price, memberIds: ['x'] })), svc, disc).total;
      const mismatch = r.total != null && Math.abs(est - r.total) > 1;
      setScan(mismatch
        ? { kind: 'done', level: 'warning', title: `อ่านจากใบเสร็จแล้ว: ${filled.join(' ')}`, text: `ยอดที่คำนวณได้ ${baht(est)} ไม่ตรงกับยอดในใบเสร็จ ${baht(r.total!)} บาท กรุณาตรวจรายการในขั้นตอนถัดไป` }
        : { kind: 'done', level: 'success', title: `อ่านจากใบเสร็จแล้ว: ${filled.join(' ')}`, text: 'กรุณาตรวจชื่อรายการและราคาอีกครั้งในขั้นตอนถัดไป' });
    } catch {
      setScan({ kind: 'done', level: 'warning', title: 'อ่านรายการจากรูปไม่สำเร็จ', text: 'ยังใช้รูปนี้เป็นใบเสร็จได้ตามปกติ และกรอกรายการเองในขั้นตอนถัดไป' });
    }
  };
  const pickReceipt = async (file?: File) => {
    if (!file) return;
    try {
      const [shown, forOcr] = await Promise.all([compressImage(file), compressImage(file, 2000, 0.9)]);
      setReceipt(shown);
      setErrors(({ receiptImage: _o, ...rest }) => rest);
      setOcrSource(forOcr);
      if (!locked) void runScan(forOcr);
    } catch {
      setErrors((e) => ({ ...e, receiptImage: 'ไม่สามารถอ่านไฟล์รูปได้ กรุณาเลือกไฟล์รูปภาพ (JPG หรือ PNG)' }));
    }
  };
  const pickQr = async (file?: File) => {
    if (!file) return;
    try { setQr(await compressImage(file)); setErrors(({ qrImage: _o, promptpayId: _p, ...rest }) => rest); }
    catch { setErrors((e) => ({ ...e, qrImage: 'ไม่สามารถอ่านไฟล์รูปได้ กรุณาเลือกไฟล์รูปภาพ (JPG หรือ PNG)' })); }
  };

  // ---------- ตรวจข้อมูลทีละขั้น ----------
  const filledItems = () => items.filter((it) => it.name.trim() || it.price);
  function validateStep(s: number) {
    const f: Record<string, string> = {};
    if (s === 0 && !locked) {
      if (!payerId) f.payer = 'กรุณาเลือกผู้รับเงิน';
      if (people.length < 2) f.people = 'กรุณาเลือกผู้ร่วมบิลอย่างน้อย 2 คน (รวมผู้รับเงิน)';
    }
    if (s === 1) {
      if (!title.trim()) f.title = 'กรุณาระบุชื่อรายการหรือชื่อร้าน';
      if (!date) f.date = 'กรุณาระบุวันที่';
    }
    if (s === 2 && !locked) {
      const s2 = Number(servicePct);
      if (Number.isNaN(s2) || s2 < 0 || s2 > 100) f.servicePct = 'ค่าบริการต้องอยู่ระหว่าง 0–100%';
      if (Number(discount) < 0) f.discount = 'ส่วนลดต้องไม่ติดลบ';
      if (!filledItems().length) f.items = 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ';
      items.forEach((it, idx) => {
        if (!it.name.trim() && !it.price) return;
        if (!it.name.trim()) f[`items.${idx}.name`] = `รายการที่ ${idx + 1}: กรุณาระบุชื่อ`;
        if (!(Number(it.price) > 0)) f[`items.${idx}.price`] = `รายการที่ ${idx + 1}: ราคาต้องมากกว่า 0`;
        if (!shareIds(it).length) f[`items.${idx}.members`] = `รายการที่ ${idx + 1}: กรุณาเลือกผู้ร่วมจ่ายอย่างน้อย 1 คน`;
      });
      if (filledItems().length && calc.total <= 0 && !f.discount) f.discount = 'ยอดรวมหลังหักส่วนลดต้องมากกว่า 0';
    }
    if (s === 3 && !locked) {
      if (payMethod === 'promptpay') {
        const pp = promptpay.trim();
        if (!pp) f.promptpayId = 'กรุณาระบุเลขพร้อมเพย์ของผู้รับเงิน';
        else if (!normalizePromptPay(pp)) f.promptpayId = 'เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก';
      } else if (!qr) f.qrImage = 'กรุณาแนบรูป QR รับเงินของธนาคาร';
    }
    return f;
  }
  const goTo = (s: number) => { setErrors({}); setFormError(null); setDir(s < step ? 'back' : 'fwd'); setStep(s); scrollTop(); };
  const next = () => {
    const f = validateStep(step);
    setErrors(f);
    if (Object.keys(f).length) { scrollTop(); return; }
    const n = step + 1;
    setReached((r) => Math.max(r, n));
    goTo(n);
  };

  const submit = async () => {
    setFormError(null);
    for (let s = 0; s < STEPS.length; s++) {
      const f = validateStep(s);
      if (Object.keys(f).length) { setErrors(f); setDir('back'); setStep(s); scrollTop(); return; }
    }
    setSaving(true);
    try {
      const usePp = payMethod === 'promptpay';
      const input = {
        title: title.trim(), date, payerId, promptpayId: usePp ? promptpay.trim() : '',
        servicePct: Number(servicePct) || 0, discount: Number(discount) || 0,
        items: filledItems().map((it) => ({ name: it.name.trim(), price: Number(it.price), memberIds: shareIds(it) })),
      };
      if (edit) {
        const qrPayload = locked ? undefined : usePp ? (edit.qrUrl ? null : undefined) : payloadImage(qrState);
        const r = await api.updateBill(edit.id, { ...input, promptpayId: locked ? edit.promptpayId ?? '' : input.promptpayId, receiptImage: payloadImage(receiptState), qrImage: qrPayload });
        onCreated(r.announced, r.financial);
      } else {
        const r = await api.createBill({ ...input, receiptImage: receipt, qrImage: usePp ? null : qr });
        onCreated(r.announced);
      }
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setFormError(errorText(e));
      scrollTop();
    } finally { setSaving(false); }
  };

  const errorList = Object.values(errors);
  const payeeOptions: Member[] = session.members;
  const isLast = step === STEPS.length - 1;
  const filledCount = filledItems().length;

  const nav = (nextLabel: string, extra?: ReactNode) => (
    <div className="wizard-nav">
      {step > 0 ? <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={saving}>ย้อนกลับ</Button>
        : isEdit ? <Button variant="secondary" onClick={onCancelEdit}>ยกเลิกการแก้ไข</Button> : <span />}
      {extra}
      {isLast
        ? <Button onClick={submit} loading={saving}>{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกและแจ้งในกลุ่ม LINE'}</Button>
        : <Button onClick={next}>{nextLabel}</Button>}
    </div>
  );

  return (
    <div ref={topRef} className="stack wizard">
      <ol className="stepper" aria-label="ขั้นตอนสร้างบิล" style={{ ['--progress' as string]: `${(step / (STEPS.length - 1)) * 100}%` }}>
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === step ? 'is-current' : i < step || i <= reached ? 'is-done' : ''}>
            <button type="button" disabled={i > reached || saving} onClick={() => (i < step ? goTo(i) : i > step && i <= reached ? (Object.keys(validateStep(step)).length ? next() : goTo(i)) : undefined)}>
              <span className="step-dot">{i < step || (i <= reached && i !== step) ? <Icon name="check" size={14} /> : i + 1}</span>
              <span className="step-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      {isEdit && step === 1 && (
        locked
          ? <Alert kind="warning" title={`กำลังแก้ไขบิล "${edit!.title}"`}>มีสมาชิกชำระเงินแล้ว จึงแก้ไขได้เฉพาะชื่อรายการ วันที่ และรูปใบเสร็จ หากต้องการแก้ยอดเงินหรือรายการ กรุณายกเลิกบิลนี้แล้วสร้างใหม่</Alert>
          : <Alert kind="info" title={`กำลังแก้ไขบิล "${edit!.title}"`}>ถ้ายอดของสมาชิกเปลี่ยน ระบบจะแจ้งยอดใหม่ในกลุ่ม LINE ให้อัตโนมัติ</Alert>
      )}
      {(formError || errorList.length > 0) && (
        <Alert kind="error" title={formError && !errorList.length ? 'ไม่สามารถบันทึกรายการได้' : 'กรุณาตรวจสอบข้อมูลก่อนไปขั้นตอนถัดไป'} onClose={() => { setFormError(null); setErrors({}); }}>
          {errorList.length ? <ul className="error-list">{errorList.map((m, i) => <li key={i}>{m}</li>)}</ul> : formError}
        </Alert>
      )}

      <div key={step} className={`step-pane step-${dir}`}>
      {/* ---------- 1. ผู้ร่วมบิล ---------- */}
      {step === 0 && (
        <>
          <section className="card">
            <StepHead n={1} title="ใครร่วมบิลนี้บ้าง" sub="เลือกผู้ที่ชำระบิลไปก่อน (ผู้รับเงิน) แล้วเลือกคนหรือกลุ่มที่ร่วมหาร" />
            <Field label="ผู้รับเงิน (ผู้ที่ชำระบิลไปก่อน)" error={errors.payer}>
              <select value={payerId} onChange={(e) => changePayer(e.target.value)} disabled={locked}>
                {payeeOptions.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === me.id ? ' (ท่าน)' : ''}</option>)}
              </select>
            </Field>
          </section>
          {locked
            ? <section className="card"><p className="muted">มีสมาชิกชำระแล้ว จึงเปลี่ยนผู้ร่วมบิลไม่ได้</p><PeopleChips ids={people} payerId={payerId} /></section>
            : <ParticipantPicker people={people} setPeople={setPeople} payerId={payerId} error={errors.people} />}
          <section className="dock">
            <div className="dock-summary">
              <span className="dock-faces">{people.slice(0, 6).map((id) => <Avatar key={id} member={member(id)} size={28} ring />)}{people.length > 6 && <span className="avatar-more">+{people.length - 6}</span>}</span>
              <span><b>{people.length} คน</b> <span className="muted">ร่วมบิลนี้</span></span>
            </div>
            {nav(`ยืนยันผู้ร่วมบิล ${people.length} คน`)}
          </section>
        </>
      )}

      {/* ---------- 2. ใบเสร็จ ---------- */}
      {step === 1 && (
        <section className="card">
          <StepHead n={2} title="ใบเสร็จ" sub="แนบรูปใบเสร็จได้ ระบบจะอ่านชื่อรายการ ราคา และวันที่ให้อัตโนมัติ ไม่มีใบเสร็จก็ข้ามได้" />
          <div className={`receipt-stage ${receipt ? 'has-image' : ''}`}>
            {receipt ? (
              <figure className={`receipt-frame ${scan.kind === 'busy' ? 'is-scanning' : ''}`}>
                <div className="receipt-img"><img src={receipt} alt="รูปใบเสร็จ" />{scan.kind === 'busy' && <span className="scan-beam" aria-hidden="true" />}</div>
                <figcaption className="row-gap">
                  <label className="btn btn-secondary btn-sm"><input type="file" accept="image/*" hidden onChange={(e) => { void pickReceipt(e.target.files?.[0]); e.target.value = ''; }} /><Icon name="image" size={16} /> เปลี่ยนรูป</label>
                  {!locked && ocrSource && scan.kind !== 'busy' && <Button variant="secondary" size="sm" icon="scan" onClick={() => void runScan(ocrSource)}>อ่านอีกครั้ง</Button>}
                  <Button variant="ghost" size="sm" icon="trash" onClick={() => { setReceipt(null); setOcrSource(null); setScan({ kind: 'idle' }); }}>นำรูปออก</Button>
                </figcaption>
              </figure>
            ) : (
              <label className="upload upload-lg">
                <input type="file" accept="image/*" onChange={(e) => { void pickReceipt(e.target.files?.[0]); e.target.value = ''; }} />
                <span className="upload-glyph"><Icon name="scan" size={30} /></span>
                <span className="strong">ถ่ายรูปหรือเลือกรูปใบเสร็จ</span>
                <span className="muted small">ระบบอ่านรายการ ราคา และวันที่ให้ · สมาชิกทุกคนในกลุ่มเปิดดูได้</span>
              </label>
            )}
            {receipt && (
              <div className="recognized" aria-live="polite">
                <div className="recognized-head">
                  <span className="kicker">{scan.kind === 'busy' ? 'กำลังอ่าน' : 'อ่านได้จากใบเสร็จ'}</span>
                  {scan.kind !== 'busy' && filledCount > 0 && <span className="muted">{filledCount} รายการ</span>}
                </div>
                {scan.kind === 'busy' ? (
                  <div className="scan-progress" role="status">
                    <span>{scan.stage === 'load' ? 'กำลังเตรียมตัวอ่าน (ครั้งแรกอาจใช้เวลาสักครู่)' : `กำลังอ่านรายการ ${scan.pct}%`}</span>
                    <Meter value={scan.stage === 'load' ? 8 : Math.max(8, scan.pct)} max={100} tone="ink" label="ความคืบหน้าการอ่านใบเสร็จ" />
                    <div className="recognized-skeleton" aria-hidden="true">{[70, 52, 64].map((w) => <span key={w} className="sk sk-line" style={{ width: `${w}%` }} />)}</div>
                  </div>
                ) : filledCount > 0 ? (
                  <>
                    <ul className="ledger ledger-compact">
                      {filledItems().map((it) => (
                        <li key={it.key} className="ledger-row reveal"><span className="ledger-name">{it.name || <span className="muted">ไม่มีชื่อ</span>}</span><Money value={Number(it.price) || 0} className="ledger-amt" /></li>
                      ))}
                    </ul>
                    <dl className="ledger-foot"><div className="ledger-total"><dt>รวมก่อนปรับ</dt><dd><Money value={calc.subtotal} /></dd></div></dl>
                  </>
                ) : (
                  <p className="muted small">ยังไม่มีรายการ กรอกเองได้ในขั้นถัดไป</p>
                )}
              </div>
            )}
          </div>
          {errors.receiptImage && <span className="field-error">{errors.receiptImage}</span>}
          {scan.kind === 'done' && <Alert kind={scan.level} title={scan.title} onClose={() => setScan({ kind: 'idle' })}>{scan.text}</Alert>}
          <div className="grid-2 mt">
            <Field label="ชื่อรายการ / ชื่อร้าน" error={errors.title} className="span-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น Roast Coffee สาขานิมมาน" maxLength={120} />
            </Field>
            <Field label="วันที่" error={errors.date}>
              <DateInput value={date} onChange={setDate} clearable={false} long />
            </Field>
          </div>
          {nav(receipt ? 'ถัดไป: ตรวจรายการ' : 'ไม่มีใบเสร็จ ไปกรอกรายการ', undefined)}
        </section>
      )}

      {/* ---------- 3. รายการและราคา ---------- */}
      {step === 2 && (
        <>
          <fieldset className="card plain-fieldset" disabled={locked}>
            <StepHead n={3} title="ตรวจรายการและราคา" sub="แก้ชื่อหรือราคาได้ และแตะชื่อเพื่อเลือกว่าแต่ละรายการหารกับใคร (ค่าเริ่มต้น หารทุกคน)" />
            {receipt && (
              <details className="receipt-ref">
                <summary><Icon name="receipt" size={16} />เทียบกับใบเสร็จต้นฉบับ</summary>
                <img src={receipt} alt="รูปใบเสร็จต้นฉบับ" />
              </details>
            )}
            {locked && <span className="lock-tag">ล็อกเนื่องจากมีผู้ชำระแล้ว</span>}
            {errors.items && <p className="field-error">{errors.items}</p>}
            <ol className="items">
              {items.map((it, idx) => {
                const owners = shareIds(it);
                const everyone = owners.length === people.length;
                const each = owners.length ? (Number(it.price) || 0) / owners.length : 0;
                return (
                  <li className={`item ${errors[`items.${idx}.members`] ? 'has-error' : ''}`} key={it.key}>
                    <div className="item-row">
                      <span className="item-no" aria-hidden="true">{String(idx + 1).padStart(2, '0')}</span>
                      <Field label="รายการ" error={errors[`items.${idx}.name`]} className="grow">
                        <input value={it.name} onChange={(e) => updateItem(it.key, { name: e.target.value })} placeholder="ชื่อรายการ" />
                      </Field>
                      <Field label="ราคา (บาท)" error={errors[`items.${idx}.price`]} className="w-price">
                        <input className="input-money" type="number" inputMode="decimal" min="0" step="0.01" value={it.price} onChange={(e) => updateItem(it.key, { price: e.target.value })} placeholder="0.00" />
                      </Field>
                      <button type="button" className="icon-btn danger" aria-label={`ลบรายการที่ ${idx + 1}`} onClick={() => setItems((l) => (l.length > 1 ? l.filter((x) => x.key !== it.key) : [newItem()]))}>
                        <Icon name="trash" />
                      </button>
                    </div>
                    <div className="assign" role="group" aria-label={`ผู้ร่วมจ่ายรายการที่ ${idx + 1}`}>
                      <button type="button" className={`assign-all ${everyone ? 'on' : ''}`} aria-pressed={everyone}
                        onClick={() => updateItem(it.key, { memberIds: everyone ? [] : [...people] })}>
                        <Icon name="users" size={16} />ทุกคน
                      </button>
                      {people.map((id) => {
                        const on = owners.includes(id);
                        return (
                          <button key={id} type="button" className={`assign-person ${on ? 'on' : ''}`} aria-pressed={on}
                            style={{ ['--mc' as string]: memberColor(id) }} onClick={() => toggleItemMember(it, id)}>
                            <Avatar member={member(id)} size={22} /><span>{member(id)?.name}</span>
                          </button>
                        );
                      })}
                      {owners.length > 0 && Number(it.price) > 0 && <span className="assign-each"><Money value={each} /> /คน</span>}
                    </div>
                    {errors[`items.${idx}.members`] && <p className="field-error">{errors[`items.${idx}.members`]}</p>}
                  </li>
                );
              })}
            </ol>
            <Button variant="secondary" icon="plus" className="add-item" onClick={() => setItems((l) => [...l, newItem()])}>เพิ่มรายการ</Button>
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
            <ShareTable calc={calc} payerId={payerId} />
            {nav(`ยืนยันรายการ ${filledCount} รายการ`)}
          </section>
        </>
      )}

      {/* ---------- 4. ช่องทางรับเงิน ---------- */}
      {step === 3 && (
        <section className="card">
          <StepHead n={4} title="ช่องทางรับเงิน" sub={`ให้สมาชิกโอนเงินให้ ${member(payerId)?.name ?? 'ผู้รับเงิน'} ผ่านช่องทางที่เลือก`} />
          <div className="pay-choice" role="radiogroup" aria-label="ช่องทางรับเงิน">
            <button type="button" role="radio" aria-checked={payMethod === 'promptpay'} className={payMethod === 'promptpay' ? 'on' : ''} disabled={locked} onClick={() => setPayMethod('promptpay')}>
              <span className="radio" aria-hidden="true" /><Icon name="wallet" size={22} /><b>เลขพร้อมเพย์</b><span>ระบบสร้าง QR พร้อมยอดของแต่ละคนให้</span>
            </button>
            <button type="button" role="radio" aria-checked={payMethod === 'qr'} className={payMethod === 'qr' ? 'on' : ''} disabled={locked} onClick={() => setPayMethod('qr')}>
              <span className="radio" aria-hidden="true" /><Icon name="qr" size={22} /><b>รูป QR ธนาคาร</b><span>แนบ QR รับเงินจากแอปธนาคาร</span>
            </button>
          </div>
          {payMethod === 'promptpay' ? (
            <Field label="เลขพร้อมเพย์ของผู้รับเงิน" error={errors.promptpayId} hint="เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก">
              <input inputMode="numeric" value={promptpay} onChange={(e) => setPromptpay(e.target.value)} placeholder="0812345678" disabled={locked} />
            </Field>
          ) : (
            <div className={`field ${errors.qrImage ? 'has-error' : ''}`}>
              <span className="field-label">รูป QR รับเงิน</span>
              {qr ? (
                <div className="upload-preview">
                  <img src={qr} alt="รูป QR รับเงิน" />
                  {!locked && <Button variant="secondary" size="sm" icon="trash" onClick={() => setQr(null)}>นำรูปออก</Button>}
                </div>
              ) : (
                <label className={`upload ${locked ? 'is-disabled' : ''}`}>
                  <input type="file" accept="image/*" disabled={locked} onChange={(e) => { void pickQr(e.target.files?.[0]); e.target.value = ''; }} />
                  <Icon name="qr" size={26} /><span>แตะเพื่อเลือกรูป QR</span>
                </label>
              )}
              {errors.qrImage ? <span className="field-error">{errors.qrImage}</span> : <span className="field-hint">สมาชิกต้องกรอกยอดเงินเองเมื่อสแกน QR แบบนี้</span>}
            </div>
          )}
          <div className="ticket" aria-label="สรุปก่อนบันทึก">
            <div className="ticket-head">
              <span className="kicker">สรุปก่อนบันทึก</span>
              <b className="ticket-title">{title || 'ไม่มีชื่อรายการ'}</b>
            </div>
            <dl className="ticket-rows">
              <div><dt>ผู้รับเงิน</dt><dd>{member(payerId)?.name ?? '-'}</dd></div>
              <div><dt>ผู้ร่วมบิล</dt><dd>{people.length} คน · {filledCount} รายการ</dd></div>
              <div><dt>ใบเสร็จ</dt><dd>{receipt ? 'แนบแล้ว' : 'ไม่มี'}</dd></div>
            </dl>
            <div className="ticket-total"><span>ยอดรวมบิล</span><span className="hero-figure"><Money value={calc.total} /><small>บาท</small></span></div>
          </div>
          {nav('')}
        </section>
      )}
      </div>
    </div>
  );
}

function StepHead({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="step-head">
      <span className="step-n">ขั้นที่ {n}/4</span>
      <h2 className="card-title">{title}</h2>
      <p className="muted">{sub}</p>
    </div>
  );
}

function PeopleChips({ ids, payerId }: { ids: string[]; payerId: string }) {
  const { member } = useApp();
  return (
    <div className="people-chips">
      {ids.map((id) => <Person key={id} member={member(id)} size={26} suffix={id === payerId ? <span className="muted"> (ผู้รับเงิน)</span> : null} />)}
    </div>
  );
}

function ShareTable({ calc, payerId }: { calc: ReturnType<typeof computeShares>; payerId: string }) {
  const { member } = useApp();
  const entries = Object.entries(calc.shares).map(([id, amt]) => [id, Number(amt)] as const);
  const max = Math.max(0, ...entries.map(([, a]) => a));
  return (
    <>
      <h2 className="card-title">ยอดที่แต่ละคนต้องชำระ</h2>
      {!entries.length ? <p className="muted">กรอกรายการและราคาเพื่อดูยอดของแต่ละคน</p> : (
        <ul className="split-bars">
          {entries.map(([id, amt]) => (
            <li key={id} style={{ ['--mc' as string]: memberColor(id) }}>
              <Person member={member(id)} size={24} suffix={id === payerId ? <span className="muted"> · ผู้รับเงิน</span> : null} />
              <Money value={amt} className="split-amt" />
              <span className="split-bar" aria-hidden="true"><span style={{ width: `${max ? (amt / max) * 100 : 0}%` }} /></span>
            </li>
          ))}
        </ul>
      )}
      <dl className="ledger-foot">
        <div><dt>ราคารวมก่อนปรับ</dt><dd><Money value={calc.subtotal} /></dd></div>
        <div className="ledger-total"><dt>ยอดรวมบิล</dt><dd><Money value={calc.total} /></dd></div>
      </dl>
    </>
  );
}
